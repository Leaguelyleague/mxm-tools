#!/usr/bin/env node
// =============================================================================
// pack.mjs — Builds dist/mxm-tools-vX.Y.Z.zip for distribution. The version
// comes from manifest.json.
//
// Excludes everything not needed to load the extension: tools/ (dev, node-only),
// docs/, tests/ (Playwright suite), .git*/.github/ (the repo is never shipped),
// CHANGELOG.md, node_modules/, package.json/package-lock.json (dev tooling),
// .DS_Store.
//
// Usage: node tools/pack.mjs
// =============================================================================
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { chromium } from "playwright";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXCLUDE_TOP = new Set([
  "tools", "docs", "tests", ".git", ".github", ".gitignore", "node_modules",
  "CHANGELOG.md", "package.json", "package-lock.json", ".DS_Store", "dist",
]);

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
if (!version) { console.error("manifest.json sin version"); process.exit(1); }

const distDir = path.join(root, "dist");
const zipName = `mxm-tools-v${version}.zip`;
const zipPath = path.join(distDir, zipName);

mkdirSync(distDir, { recursive: true });
if (existsSync(zipPath)) rmSync(zipPath);

// Lista de entradas de primer nivel a incluir (todo lo NO excluido).
const entries = readdirSync(root).filter((e) => !EXCLUDE_TOP.has(e));
console.log("Empaquetando:", entries.join(", "));

// zip del sistema: -r recursivo, -X sin metadata extendida de macOS
// (resource forks/._*), -x patrones extra de exclusión por si algo se cuela
// dentro de un directorio incluido (p.ej. .DS_Store anidados).
execFileSync("zip", ["-r", "-X", zipPath, ...entries, "-x", "*.DS_Store", "-x", "*/.DS_Store"], {
  cwd: root,
  stdio: "inherit",
});

console.log("\nEscrito:", zipPath);

// ── Verificación: el zip contiene un manifest.json válido y CADA archivo que
//    el manifest + las páginas HTML referencian existe adentro. ──
const listing = execFileSync("unzip", ["-Z1", zipPath], { cwd: root }).toString().split("\n").filter(Boolean);
const listed = new Set(listing);
console.log(`Verificando ${listing.length} entradas...`);

if (!listed.has("manifest.json")) { console.error("FALTA manifest.json en el zip"); process.exit(1); }

const referenced = new Set(["manifest.json"]);
for (const g of manifest.content_scripts || []) for (const f of g.js) referenced.add(f);
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
if (manifest.options_ui?.page) referenced.add(manifest.options_ui.page);
for (const wa of manifest.web_accessible_resources || []) for (const f of wa.resources) referenced.add(f);
for (const size in manifest.icons || {}) referenced.add(manifest.icons[size]);
if (manifest.action?.default_icon) for (const size in manifest.action.default_icon) referenced.add(manifest.action.default_icon[size]);

// Scripts referenciados dentro de popup.html/options.html/info.html/diff.html
// (<script src="...">) — no viven en el manifest, pero si faltan la extensión
// no carga esas páginas.
for (const html of ["popup.html", "options.html", "info.html", "diff.html"]) {
  if (!referenced.has(html)) continue;
  const src = readFileSync(path.join(root, html), "utf8");
  for (const m of src.matchAll(/<script src="([^"]+)">/g)) referenced.add(m[1]);
  for (const m of src.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) referenced.add(m[1]);
}

const missing = [...referenced].filter((f) => !listed.has(f));
if (missing.length) {
  console.error("FALTAN en el zip archivos que la extensión referencia:", missing);
  process.exit(1);
}
console.log(`OK: los ${referenced.size} archivos referenciados por manifest.json + las páginas HTML están en el zip.`);

// ── Verificación real: descomprimir el zip tal cual le quedaría a un
//    especialista y cargarlo como extensión de verdad (no solo listar
//    nombres de archivo — confirma que Chrome lo acepta y arranca sin error). ──
const extractDir = mkdtempSync(path.join(os.tmpdir(), "mxm-pack-extract-"));
execFileSync("unzip", ["-q", zipPath, "-d", extractDir], { cwd: root });

const userDataDir = mkdtempSync(path.join(os.tmpdir(), "mxm-pack-profile-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${extractDir}`, `--load-extension=${extractDir}`],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null);
if (!sw) { console.error("FALTA: el service worker no arrancó (manifest inválido para Chrome)"); process.exit(1); }
const extId = new URL(sw.url()).host;

const errs = [];
const popup = await ctx.newPage();
popup.on("pageerror", (e) => errs.push("popup: " + e.message));
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(600);
const tabCount = await popup.evaluate(() => document.querySelectorAll(".tabs button").length);
if (tabCount !== 3) { console.error(`FALTA: el popup no tiene 3 pestañas (tiene ${tabCount})`); process.exit(1); }

const options = await ctx.newPage();
options.on("pageerror", (e) => errs.push("options: " + e.message));
await options.goto(`chrome-extension://${extId}/options.html`);
await options.waitForTimeout(600);
const hasGemUrl = await options.evaluate(() => !!document.getElementById("gem_url"));
if (!hasGemUrl) { console.error("FALTA: options.html no cargó el formulario"); process.exit(1); }

if (errs.length) { console.error("ERRORES de página al cargar el paquete real:", errs); process.exit(1); }

await ctx.close();
rmSync(extractDir, { recursive: true, force: true });
rmSync(userDataDir, { recursive: true, force: true });
console.log("OK: el paquete descomprimido carga como extensión real (SW arriba, popup 3 pestañas, options con formulario, 0 errores).");
