// Batch 10: instrumental + Enter, default shortcuts ⌥K/⌥J/⌥Y, findReplace+resetSync
// ON by default, per-group clusters in the popup with an individual switch.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-shots10-")); // diagnostic screenshot, not asserted
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-l10-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("popup: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("popup console: " + m.text()); });
await p.setViewportSize({ width: 400, height: 900 });
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.waitForTimeout(900);

// ── New default shortcuts ──
const defs = await p.evaluate(() => ({
  unir: window.MXMShortcuts.DEFAULTS.unir.code,
  split: window.MXMShortcuts.DEFAULTS.split.code,
  instrumental: window.MXMShortcuts.DEFAULTS.instrumental.code,
}));
ok(defs.unir === "KeyJ", "join lines default = ⌥J → " + defs.unir);
ok(defs.split === "KeyK", "split lines default = ⌥K → " + defs.split);
ok(defs.instrumental === "KeyY", "instrumental default = ⌥Y → " + defs.instrumental);
// and they show up like that in the Functions tab
const scTexts = await p.evaluate(() => Array.from(document.querySelectorAll("#functions-list .sc-key")).map((e) => e.textContent));
ok(scTexts.some((s) => s.includes("K")) && scTexts.some((s) => s.includes("J")) && scTexts.some((s) => s.includes("Y")), "the popup shows the new shortcuts");

// ── Buttons: findReplace/resetSync ON by default + clusters ──
await p.click('[data-tab="buttons"]'); await p.waitForTimeout(300);
const onState = await p.evaluate(() => {
  const get = (k) => document.querySelector(`#buttons-list .row[data-key="${k}"] .switch input`)?.checked;
  return { findReplace: get("findReplace"), resetSync: get("resetSync"), save: get("save"), copy: get("copy") };
});
ok(onState.findReplace === true && onState.resetSync === true, "findReplace and resetSync ON by default");
ok(onState.save === false && onState.copy === false, "save and copy remain opt-in (off)");

const clusters = await p.evaluate(() => Array.from(document.querySelectorAll("#buttons-list .blk-group")).map((g) => ({
  group: g.dataset.group,
  name: g.querySelector(".group-name").textContent,
  members: Array.from(g.querySelectorAll(".row.group-member")).map((r) => r.dataset.key),
  hasSwitch: !!g.querySelector(".group-head .switch input"),
})));
ok(clusters.length === 4, "4 clusters in the list → " + clusters.map((c) => c.group).join(","));
const byG = Object.fromEntries(clusters.map((c) => [c.group, c]));
ok(byG.gemGroup && byG.gemGroup.members.join(",") === "gem,gemReview", "gems cluster with its members");
ok(byG.streamGroup && byG.streamGroup.members.length === 4, "streaming cluster with 4 members");
ok(byG.typeformGroup && byG.typeformGroup.members.join(",") === "typeform1,typeform2,typeform3,typeform4", "Typeforms 1-4 cluster");
ok(byG.contribGroup && byG.contribGroup.members.join(",") === "contributorName,contribProfile", "contributor cluster (show + profile)");
ok(clusters.every((c) => c.hasSwitch), "every cluster has its grouping switch");
ok(await p.evaluate(() => !document.getElementById("btn-group")), "global grouping switch removed");

// individual toggle: turn off streaming grouping → persists
await p.evaluate(() => document.querySelector('#buttons-list .blk-group[data-group="streamGroup"] .group-head .switch input').click());
await p.waitForTimeout(300);
const gcfg = await p.evaluate(() => new Promise((r) => chrome.storage.local.get("groupButtonsBy", (v) => r(v.groupButtonsBy))));
ok(gcfg && gcfg.streamGroup === false, "turning off the streaming cluster persists (groupButtonsBy.streamGroup=false)");
ok((await p.evaluate(() => new Promise((r) => chrome.storage.local.get("groupButtonsBy", (v) => r(v.groupButtonsBy.gemGroup))))) === undefined, "the other groups are left untouched");
await p.screenshot({ path: `${SHOTS}/popup-buttons-clusters.png`, fullPage: true });

// ── Sources ──
const srcs = await p.evaluate(async () => {
  const get = async (f) => await (await fetch(chrome.runtime.getURL(f))).text();
  return { inst: await get("instrumental.js"), btns: await get("buttons-mxm.js"), defs: await get("btn-defs.js") };
});
ok(srcs.inst.includes('INSERT_TEXT + "\\n"'), "instrumental inserts with Enter (empty line below)");
ok(srcs.btns.includes("groupButtonsBy") && srcs.btns.includes("const groupOn = (ak)"), "engine: per-group grouping with a legacy default");
// Phase 5: DEFAULT_OFF lives in btn-defs.js, not buttons-mxm.js.
ok(srcs.defs.includes('DEFAULT_OFF = ["save", "copy"]'), "engine: DEFAULT_OFF only save+copy");

ok(errs.length === 0, "zero console/page errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
