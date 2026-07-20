// Batch 12 · item 6: transformToUpperFirst (used by splitLine) capitalizes the
// first real LETTER, skipping opening marks ( ¿ ¡ " '. Tests the REAL function
// extracted from unir-lineas.js's source.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-split-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
// The real function, extracted from source with fs (extension pages have CSP
// with no unsafe-eval; about:blank does not).
const uniSrc = fs.readFileSync(path.join(EXT, "unir-lineas.js"), "utf8");
const fnMatch = uniSrc.match(/function transformToUpperFirst\(text\) \{[\s\S]*?\n  \}/);
const p = await ctx.newPage();
await p.goto("about:blank");

const r = await p.evaluate((fnSrc) => {
  if (!fnSrc) return { error: "could not find transformToUpperFirst" };
  const f = new Function(fnSrc + "; return transformToUpperFirst;")();
  return {
    // Spanish opening punctuation (¿ ¡) is the real thing being tested here.
    paren: f("(hola mundo)"),
    quest: f("¿que tal"),
    excl: f("¡vamos"),
    quote: f('"citado'),
    plain: f("normal texto"),
    already: f("(Ya bien"),
    empty: f("   "),
  };
}, fnMatch ? fnMatch[0] : null);
ok(!r.error, "extracted the real function → " + (r.error || "ok"));
ok(r.paren === "(Hola mundo)", "'(hola mundo)' → '(Hola mundo)' → " + r.paren);
ok(r.quest === "¿Que tal", "'¿que tal' → '¿Que tal' → " + r.quest);
ok(r.excl === "¡Vamos", "'¡vamos' → '¡Vamos' → " + r.excl);
ok(r.quote === '"Citado', "'\"citado' → '\"Citado' → " + r.quote);
ok(r.plain === "Normal texto", "no leading mark: 'normal texto' → 'Normal texto' → " + r.plain);
ok(r.already === "(Ya bien", "already-capitalized text is left alone → " + r.already);
ok(r.empty === "", "spaces only → empty string");

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
