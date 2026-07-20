// Batch 13 · item 3b: word counter HUD in black & white, sensitive to system
// mode (prefers-color-scheme inside the shadow). Numbers in currentColor (no blue).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-hud-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

const h = await ctx.newPage();
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("pe: " + e.message); });
await h.emulateMedia({ colorScheme: "light" });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(500);
// text selection in a textarea (getSelectedText reads it)
await h.evaluate(() => {
  document.body.innerHTML = "";
  const ta = document.createElement("textarea"); ta.id = "t"; ta.value = "hello world several words";
  document.body.appendChild(ta); ta.focus(); ta.setSelectionRange(0, ta.value.length);
});
await h.addScriptTag({ url: `chrome-extension://${extId}/word-counter.js` });
await h.waitForTimeout(300);

// trigger the HUD with a double ⌘A (synthetic; the selection is already set)
const triggerHud = () => h.evaluate(() => {
  const t = document.getElementById("t"); t.focus(); t.setSelectionRange(0, t.value.length);
  const ev = () => new KeyboardEvent("keydown", { key: "a", code: "KeyA", metaKey: true, bubbles: true });
  document.dispatchEvent(ev()); document.dispatchEvent(ev());
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
});
await triggerHud();

const readColors = () => h.evaluate(() => {
  const host = document.getElementById("mxm-word-counter-hud");
  if (!host || !host.shadowRoot) return null;
  const box = host.shadowRoot.querySelector(".box");
  const num = host.shadowRoot.querySelector(".num");
  const gs = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
  return { shown: box.classList.contains("show"), bg: gs(box, "background-color"), color: gs(box, "color"), numColor: gs(num, "color") };
});

let c = await readColors();
ok(c && c.shown, "HUD shows after the double ⌘A");
ok(c.bg === "rgb(255, 255, 255)", "light: white background → " + c.bg);
ok(c.color === "rgb(17, 17, 17)", "light: near-black text → " + c.color);
ok(c.numColor === c.color, "light: numbers in currentColor (= text color, no blue) → " + c.numColor);
ok(c.numColor !== "rgb(79, 140, 255)", "numbers are NOT the old blue #4f8cff");

// switch to dark mode → the media query inside the shadow re-applies
await h.emulateMedia({ colorScheme: "dark" });
await h.waitForTimeout(150);
c = await readColors();
ok(c.bg === "rgb(26, 26, 26)", "dark: background #1a1a1a → " + c.bg);
ok(c.color === "rgb(255, 255, 255)", "dark: white text → " + c.color);
ok(c.numColor === "rgb(255, 255, 255)", "dark: numbers in currentColor (white) → " + c.numColor);

// source-check: no blue, uses currentColor and a media query
const wcSrc = fs.readFileSync(path.join(EXT, "word-counter.js"), "utf8");
ok(!wcSrc.includes("#4f8cff"), "word-counter.js no longer has the blue #4f8cff");
ok(/\.num\{[^}]*color:currentColor/.test(wcSrc) && wcSrc.includes("@media (prefers-color-scheme: dark)"), "uses currentColor + prefers-color-scheme media query");

ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
