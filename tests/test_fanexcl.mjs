// Batch 10: only ONE group fanned out at a time. We register two anchors with
// members and verify that opening the 2nd closes the 1st.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-fx2-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const p = await ctx.newPage();
p.on("pageerror", (e) => { if (!/setting 'value'/.test(e.message)) fails.push("pageerror: " + e.message); });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => { document.body.innerHTML = ""; });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/btn-anims.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-buttons.js` });
await p.waitForTimeout(300);

// register two groups (anchor + members)
await p.evaluate(() => {
  const B = window.MXMButtons;
  const reg = (key, members, stackIndex) => {
    B.register({ key, icon: "<svg width='20' height='20'></svg>", color: "#fff", iconColor: "#333",
      stackIndex, label: key, groupMembers: members, onClick: () => B.toggleGroup(key) });
    for (const m of members) B.register({ key: m, icon: "<svg width='20' height='20'></svg>", color: "#fff", iconColor: "#333", groupMemberOf: key, groupIndex: members.indexOf(m), label: m });
  };
  reg("gA", ["a1", "a2"], 0);
  reg("gB", ["b1", "b2"], 1);
});
await p.waitForTimeout(400);

const fanned = () => p.evaluate(() => {
  const B = window.MXMButtons;
  return { gA: !!B.get("gA").el && B.get("gA")._fanned === true ? true : !!(B.get("gA")._fanned),
           gB: !!(B.get("gB")._fanned) };
});
// open A
await p.evaluate(() => window.MXMButtons.toggleGroup("gA")); await p.waitForTimeout(150);
let s = await p.evaluate(() => ({ a: window.MXMButtons.get("gA")._fanned === true, b: window.MXMButtons.get("gB")._fanned === true }));
ok(s.a && !s.b, "opened A: A fanned out, B closed");
// open B → A must close
await p.evaluate(() => window.MXMButtons.toggleGroup("gB")); await p.waitForTimeout(150);
s = await p.evaluate(() => ({ a: window.MXMButtons.get("gA")._fanned === true, b: window.MXMButtons.get("gB")._fanned === true }));
ok(!s.a && s.b, "opened B: A closed, B fanned out (only one at a time)");
// open A again → B closes
await p.evaluate(() => window.MXMButtons.get("gA")._groupOpen()); await p.waitForTimeout(150);
s = await p.evaluate(() => ({ a: window.MXMButtons.get("gA")._fanned === true, b: window.MXMButtons.get("gB")._fanned === true }));
ok(s.a && !s.b, "via _groupOpen (hover) also closes the other");

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
