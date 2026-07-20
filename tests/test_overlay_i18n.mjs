// overlay.js is translatable. It used to have 5 HARDCODED Spanish strings
// (the only content script that did not go through MXMI18n) — a user with
// Studio in another language always saw the candidate picker in Spanish. Now
// it uses t("overlay.*") like the rest of the extension, and background.js
// (showOverlay) injects i18n-strings-content.js + mxm-i18n.js BEFORE
// overlay.js (before it only injected overlay.css + overlay.js).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-overlay-i18n-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// ── Source lock: no hardcoded Spanish, everything via t() ──
const src = fs.readFileSync(path.join(EXT, "overlay.js"), "utf8");
ok(!src.includes("Elegí el video"), "overlay.js: no hardcoded 'Elegí el video'");
ok(!src.includes("Ver todos los resultados en YouTube"), "overlay.js: no hardcoded YouTube button text");
ok(!src.includes("Búsqueda: <b"), "overlay.js: no hardcoded 'Búsqueda:' in the template");
for (const k of ["overlay.ariaLabel", "overlay.title", "overlay.close", "overlay.searchLabel", "overlay.seeAllYoutube"]) {
  ok(src.includes(`t("${k}")`), `overlay.js: uses t("${k}")`);
}

// ── Source lock: showOverlay injects i18n BEFORE overlay.js ──
const bg = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
const i = bg.indexOf("async function showOverlay");
const showOverlaySlice = bg.slice(i, i + 800);
ok(/files:\s*\["i18n-strings-content\.js",\s*"mxm-i18n\.js",\s*"overlay\.js"\]/.test(showOverlaySlice),
  "background.js: showOverlay injects i18n-strings-content.js + mxm-i18n.js BEFORE overlay.js, in a single executeScript");

// ── The overlay. prefix is in the content-scripts subset, across the 26 languages ──
const assemble = fs.readFileSync(path.join(EXT, "tools/assemble-i18n.mjs"), "utf8");
ok(assemble.includes('"overlay."'), "tools/assemble-i18n.mjs: overlay. is in CONTENT_PREFIXES");
const subset = new Function("window", fs.readFileSync(path.join(EXT, "i18n-strings-content.js"), "utf8") + "\nreturn window;")({}).MXM_STRINGS;
const langs = Object.keys(subset);
ok(langs.length === 26 && langs.every((l) => "overlay.ariaLabel" in subset[l] && "overlay.seeAllYoutube" in subset[l]),
  `overlay.* present in all ${langs.length} subset languages`);

// ── Real behavior: renders in SPANISH with the real strings ──
// chrome.runtime.onMessage does not expose a way to "fire" a synthetic event
// from the page (it is not a DOM CustomEvent); the listener registration is
// intercepted (same pattern as test_spa_dispatcher.mjs with setInterval) and
// invoked directly — this exercises the REAL render() without inventing a
// messaging mechanism Chrome does not offer.
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pe: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ uiLangAuto: false, uiLang: "es" }, r)));
await p.evaluate(() => { document.body.innerHTML = ""; });
await p.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings-content.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await p.waitForTimeout(200); // MXMI18n hydrates uiLang from storage asynchronously

await p.evaluate(() => {
  window.__capturedListener = null;
  const orig = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  chrome.runtime.onMessage.addListener = (cb) => { window.__capturedListener = cb; return orig(cb); };
});
await p.addScriptTag({ url: `chrome-extension://${extId}/overlay.js` });
await p.waitForTimeout(100);

const result = await p.evaluate(() => {
  window.__capturedListener({
    type: "SHOW_CANDIDATES",
    query: "Café Tacvba Eres",
    candidates: [{ title: "Café Tacvba - Eres", channel: "Café Tacvba", duration: "3:45", score: 92, thumbnail: "x.jpg", url: "https://youtube.com/x" }],
  });
  const panel = document.querySelector(".s2g-panel");
  return panel ? {
    ariaLabel: panel.getAttribute("aria-label"),
    title: document.querySelector(".s2g-title")?.textContent,
    close: document.querySelector(".s2g-x")?.title,
    qlabel: document.querySelector(".s2g-qlabel")?.textContent,
    ytBtn: document.querySelector(".s2g-yt")?.textContent,
  } : null;
});

ok(!!result, "the real render() generated the panel (.s2g-panel exists after the message)");
if (result) {
  ok(result.ariaLabel === "Elegí el video", "aria-label in Spanish -> " + result.ariaLabel);
  ok(result.title === "🎵 Elegí el video para enviar al Gem", "title in Spanish -> " + result.title);
  ok(result.close === "Cerrar (Esc)", "close button in Spanish -> " + result.close);
  ok(result.qlabel === "Búsqueda:", "search label in Spanish -> " + result.qlabel);
  ok(result.ytBtn === "🔎 Ver todos los resultados en YouTube", "YouTube button in Spanish -> " + result.ytBtn);
}

if (errs.length) { console.log("page errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
