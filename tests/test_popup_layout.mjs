// Batch 9: delimited blocks + "Shortcut:", no color/shape, saveSend floating
// only, fixed buttons + drag toggle, Typeforms 1-4, curator profile,
// opened-songs list.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-shots9-")); // diagnostic screenshots, not asserted
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-l9-"));
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
// seed: opened songs for the list
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({
  openedSongs: ["song one — artist one", "song two — artist two", "song three — artist three"],
}, r)));
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.setViewportSize({ width: 400, height: 900 });
await p.waitForTimeout(900);

// ── Functions: blocks + Shortcut: ──
ok(await p.evaluate(() => document.querySelectorAll("#functions-list .blk").length) >= 12, "each function in its own block (.blk)");
const scLabels = await p.evaluate(() => Array.from(document.querySelectorAll("#functions-list .sc-label")).map((e) => e.textContent));
ok(scLabels.length >= 9 && scLabels.every((s) => s === "Shortcut:"), "'Shortcut:' label on every shortcut → " + scLabels[0]);
await p.screenshot({ path: `${SHOTS}/popup-functions.png`, fullPage: true });

// ── Buttons: no color/shape, movable, typeforms, profile, normal saveSend ──
await p.click('[data-tab="buttons"]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => !document.getElementById("btn-color-mode") && !document.getElementById("btn-shape")), "color and shape options removed");
ok(await p.evaluate(() => !!document.getElementById("btn-movable")), "draggable-buttons toggle present");
await p.evaluate(() => document.getElementById("btn-movable").click()); await p.waitForTimeout(300);
ok((await p.evaluate(() => new Promise((r) => chrome.storage.local.get("buttonsMovable", (v) => r(v.buttonsMovable))))) === true, "movable ON persists (buttonsMovable=true)");
await p.evaluate(() => document.getElementById("btn-movable").click()); await p.waitForTimeout(200);

const keys = await p.evaluate(() => Array.from(document.querySelectorAll("#buttons-list .row[data-key]")).map((r) => r.dataset.key));
ok(["typeform1", "typeform2", "typeform3", "typeform4"].every((k) => keys.includes(k)), "Typeform 1-4 rows present");
ok(keys.includes("contribProfile"), "'Go to curator profile' row present");
ok(!keys.includes("slackInvite"), "slackInvite row removed");
ok(await p.evaluate(() => document.querySelectorAll("#buttons-list .blk").length) >= 12, "buttons in blocks (.blk, incl. clusters)");
const ssRow = await p.evaluate(() => {
  const r = document.querySelector('#buttons-list .row[data-key="saveSend"]');
  return r ? { trigger: !!r.querySelector(".trigger"), toggle: !!r.querySelector(".switch") } : null;
});
ok(ssRow && ssRow.toggle && !ssRow.trigger, "saveSend: toggle yes, ▶ no (do not send test tasks)");
ok(await p.evaluate(() => !document.querySelector("#buttons-list .row-label .dot")), "no color dots");
await p.screenshot({ path: `${SHOTS}/popup-buttons.png`, fullPage: true });

// ── Highlighter: opened-songs list ──
await p.click('[data-tab="highlighter"]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll("#hl-opened .songline").length) === 3, "3 rows in the opened-songs list");
ok(await p.evaluate(() => {
  const tx = document.querySelector("#hl-opened .songline-tx");
  return tx && getComputedStyle(tx).userSelect === "text";
}), "list text is selectable (user-select: text)");
ok(await p.evaluate(() => !document.querySelector("#hl-opened .hl-chip")), "no chips/bubbles in the opened list");
// collapse/expand
await p.click("#hl-opened .songlist-head"); await p.waitForTimeout(200);
ok(await p.evaluate(() => !document.querySelector("#hl-opened .songlist")), "header collapses the list");
await p.click("#hl-opened .songlist-head"); await p.waitForTimeout(200);
ok(await p.evaluate(() => !!document.querySelector("#hl-opened .songlist")), "...and expands it again");
// remove a row
await p.evaluate(() => document.querySelector("#hl-opened .songline-x").click()); await p.waitForTimeout(300);
ok((await p.evaluate(() => new Promise((r) => chrome.storage.local.get("openedSongs", (v) => r(v.openedSongs.length))))) === 2, "the × removes the row");
await p.screenshot({ path: `${SHOTS}/popup-highlighter.png`, fullPage: true });

// ── Sources (content-script source checks) ──
const srcs = await p.evaluate(async () => {
  const get = async (f) => await (await fetch(chrome.runtime.getURL(f))).text();
  return {
    btns: await get("buttons-mxm.js"),
    defs: await get("btn-defs.js"), // Phase 5: group membership lives here, not in buttons-mxm.js
    save: await get("save-lyrics.js"),
    lyrics: await get("mxm-lyrics.js"),
    mbtns: await get("mxm-buttons.js"),
  };
});
ok(srcs.defs.includes("typeformGroup") && srcs.defs.includes('typeformGroup: ["typeform1", "typeform2", "typeform3", "typeform4"]'), "Typeforms group in btn-defs.js");
ok(srcs.defs.includes('contribGroup: ["contributorName", "contribProfile"]'), "contributor group (show + profile) in btn-defs.js");
ok(srcs.btns.includes("contribGroup: contributorOutlineIcon"), "buttons-mxm.js maps the contribGroup anchor icon");
ok(!srcs.save.includes("SS_BG") && !srcs.save.includes("positionSsBtn"), "Send overlay removed from save-lyrics");
ok(srcs.lyrics.includes("goProfilePending") && srcs.lyrics.includes("location.href = contrib.url"), "mxm-lyrics navigates to the profile with a pending flag");
ok(srcs.mbtns.includes("if (!movable) return") && srcs.mbtns.includes("buttonsMovable"), "drag gated by buttonsMovable");
ok(srcs.btns.includes("M19 17V5a2 2 0 0 0-2-2H4"), "scroll icon (Lucide scroll) on Typeforms");

ok(errs.length === 0, "zero console/page errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
