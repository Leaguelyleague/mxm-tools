// Batch 13 · item 1: "auto" language as the 1st dropdown option (not a switch).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-la-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const getStore = (p, keys) => p.evaluate((k) => new Promise((r) => chrome.storage.local.get(k, r)), keys);

// ── POPUP ──
const p = await ctx.newPage();
p.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("popup: " + e.message); });
// clean state: no uiLang/uiLangAuto → default auto ON
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.evaluate(() => new Promise((r) => chrome.storage.local.remove(["uiLang", "uiLangAuto"], r)));
await p.reload(); await p.waitForTimeout(700);

const langHtml = await p.evaluate(() => {
  const sel = document.getElementById("lang-select");
  return { hasCheckbox: !!document.getElementById("lang-auto"), firstVal: sel.options[0].value, firstText: sel.options[0].textContent, value: sel.value, disabled: sel.disabled, count: sel.options.length };
});
ok(!langHtml.hasCheckbox, "the lang-auto checkbox is gone");
ok(langHtml.firstVal === "auto", "1st select option = 'auto'");
ok(/studio/i.test(langHtml.firstText), "the reworded auto label mentions Studio → " + langHtml.firstText);
ok(langHtml.count === 27, "select has auto + 26 languages = 27 options → " + langHtml.count);
ok(langHtml.value === "auto" && !langHtml.disabled, "default: 'auto' selected and select NOT disabled");

// pick a language → turns auto off + saves uiLang
await p.evaluate(() => { const s = document.getElementById("lang-select"); s.value = "es"; s.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(400);
let st = await getStore(p, ["uiLang", "uiLangAuto"]);
ok(st.uiLang === "es" && st.uiLangAuto === false, "picking 'es' → uiLang=es, uiLangAuto=false");
ok((await p.evaluate(() => document.getElementById("lang-select").value)) === "es", "select shows 'es' after picking it");

// switch back to "auto" → turns auto on
await p.evaluate(() => { const s = document.getElementById("lang-select"); s.value = "auto"; s.dispatchEvent(new Event("change", { bubbles: true })); });
await p.waitForTimeout(400);
st = await getStore(p, ["uiLangAuto"]);
ok(st.uiLangAuto === true, "picking 'auto' → uiLangAuto=true");
ok((await p.evaluate(() => document.getElementById("lang-select").value)) === "auto", "select goes back to 'auto'");

// persistence: reload and check it stays on auto
await p.reload(); await p.waitForTimeout(600);
ok((await p.evaluate(() => document.getElementById("lang-select").value)) === "auto", "persistence: stays on 'auto' after reload");

// ── OPTIONS ──
const o = await ctx.newPage();
o.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("options: " + e.message); });
await o.goto(`chrome-extension://${extId}/options.html`);
await o.evaluate(() => new Promise((r) => chrome.storage.local.set({ uiLang: "de", uiLangAuto: false }, r)));
await o.reload(); await o.waitForTimeout(700);
const oHtml = await o.evaluate(() => {
  const sel = document.getElementById("lang-select");
  return { hasCheckbox: !!document.getElementById("lang-auto"), firstVal: sel.options[0].value, value: sel.value, disabled: sel.disabled };
});
ok(!oHtml.hasCheckbox, "options: no lang-auto checkbox");
ok(oHtml.firstVal === "auto", "options: 1st option = 'auto'");
ok(oHtml.value === "de" && !oHtml.disabled, "options: with uiLangAuto=false it shows the saved language (de), not disabled");

ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
