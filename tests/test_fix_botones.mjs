// HOTFIX: the buttons' click lives in onPointerUp — verify that with
// buttonsMovable OFF (default) the click WORKS and the button does not move;
// with ON, the drag moves it and does not click. + the contributor label
// centered between the player bar and the lowest button.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-fx-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const p = await ctx.newPage();
// options.js runs over a body the test emptied → its hydration error is an artifact
p.on("pageerror", (e) => { if (!/setting 'value'/.test(e.message)) fails.push("pageerror: " + e.message); });
await p.setViewportSize({ width: 1200, height: 800 });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => {
  document.body.innerHTML = "";
  // synthetic player bar (full-width, lower half, with a slider)
  const bar = document.createElement("div");
  bar.id = "playerbar";
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:64px;background:#eee";
  const slider = document.createElement("div"); slider.setAttribute("role", "slider");
  bar.appendChild(slider); document.body.appendChild(bar);
});
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/btn-anims.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-buttons.js` });
await p.waitForTimeout(400);

// register a test button and measure AFTER it settles into the stack
await p.evaluate(() => {
  window.__clicks = 0;
  window.MXMButtons.register({
    key: "probe", icon: "<svg width='20' height='20'></svg>", color: "#fff", iconColor: "#333",
    stackIndex: 0, label: "Probe", onClick: () => { window.__clicks++; },
  });
});
await p.waitForTimeout(500);
const r0 = await p.evaluate(() => {
  const r = window.MXMButtons.get("probe").el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top };
});

const pdown = (x, y) => p.evaluate(([x, y]) => {
  const el = window.MXMButtons.get("probe").el;
  el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
}, [x, y]);
const pmove = (x, y) => p.evaluate(([x, y]) => {
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
}, [x, y]);
const pup = () => p.evaluate(() => {
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
});

// 1) plain click with movable OFF (default) → onClick fires
await pdown(r0.x, r0.y); await pup(); await p.waitForTimeout(100);
ok((await p.evaluate(() => window.__clicks)) === 1, "FIX: click works with fixed buttons (movable OFF)");

// 2) press + drag with movable OFF → does NOT move and the click STILL fires on release
await pdown(r0.x, r0.y); await pmove(r0.x + 60, r0.y + 40); await pup(); await p.waitForTimeout(100);
const afterFixed = await p.evaluate(() => {
  const e = window.MXMButtons.get("probe");
  const r = e.el.getBoundingClientRect();
  return { left: r.left, top: r.top, clicks: window.__clicks, style: e.el.getAttribute("style"), wasDragged: e.wasDragged, dragged: e.dragged };
});
ok(afterFixed.left === r0.left && afterFixed.top === r0.top, "movable OFF: the button does NOT move on drag");
ok(afterFixed.clicks === 2, "movable OFF: the gesture still ends in a click");

// 3) movable ON → the drag moves it and does NOT click
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ buttonsMovable: true }, r)));
await p.waitForTimeout(300);
await pdown(r0.x, r0.y); await pmove(r0.x - 80, r0.y - 50); await pup(); await p.waitForTimeout(200);
const afterMov = await p.evaluate(() => {
  const r = window.MXMButtons.get("probe").el.getBoundingClientRect();
  return { left: r.left, top: r.top, clicks: window.__clicks };
});
ok(afterMov.left !== r0.left || afterMov.top !== r0.top, "movable ON: the drag moves the button");
ok(afterMov.clicks === 2, "movable ON: the drag does not fire a click");
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ buttonsMovable: false }, r)));

// 4) label centered between the lowest button and the bar
const lab = await p.evaluate(() => {
  window.MXMButtons.setContributorLabel("Jess Beauty", "Last contributor");
  const host = document.getElementById("mxm-st-buttons-host");
  const cl = host.shadowRoot.querySelector(".cl");
  const r = cl.getBoundingClientRect();
  let btnBottom = -Infinity;
  const el = window.MXMButtons.get("probe").el.getBoundingClientRect();
  btnBottom = Math.max(btnBottom, el.bottom);
  const barTop = document.getElementById("playerbar").getBoundingClientRect().top;
  return { center: r.top + r.height / 2, mid: (btnBottom + barTop) / 2, btnBottom, barTop };
});
ok(Math.abs(lab.center - lab.mid) <= 2, `label centered in the gap (center=${lab.center.toFixed(1)} vs mid=${lab.mid.toFixed(1)})`);

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
