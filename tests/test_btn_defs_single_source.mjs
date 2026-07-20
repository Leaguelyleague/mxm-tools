// Single button registry. buttons-mxm.js (DEFS/GROUPS/DEFAULT_OFF) and
// popup.js (BTNS/POPUP_GROUPS/BTN_DEFAULT_OFF) used to EACH keep their own
// copy of the order/opensTab/default-off/groups — the same risk btn-colors.js
// had already solved for the colors: adding a new button and updating one
// list without the other. Now both derive from btn-defs.js (window.MXMBtnDefs).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

// ── Source lock: neither buttons-mxm.js nor popup.js declares its own
//    metadata array/object anymore — both read MXMBtnDefs ──
const btnsSrc = fs.readFileSync(path.join(EXT, "buttons-mxm.js"), "utf8");
const popupSrc = fs.readFileSync(path.join(EXT, "popup.js"), "utf8");
const defsSrc = fs.readFileSync(path.join(EXT, "btn-defs.js"), "utf8");
ok(btnsSrc.includes("MXMBtnDefs.ORDER.map"), "buttons-mxm.js builds DEFS from MXMBtnDefs.ORDER");
ok(btnsSrc.includes("new Set(MXMBtnDefs.DEFAULT_OFF)"), "buttons-mxm.js takes DEFAULT_OFF from MXMBtnDefs");
ok(btnsSrc.includes("Object.entries(MXMBtnDefs.GROUPS)"), "buttons-mxm.js builds GROUPS from MXMBtnDefs.GROUPS");
ok(popupSrc.includes("window.MXMBtnDefs.ORDER.map"), "popup.js builds BTNS from MXMBtnDefs.ORDER");
ok(popupSrc.includes("new Set(window.MXMBtnDefs.DEFAULT_OFF)"), "popup.js takes BTN_DEFAULT_OFF from MXMBtnDefs");
ok(popupSrc.includes("POPUP_GROUPS = window.MXMBtnDefs.GROUPS"), "popup.js takes POPUP_GROUPS from MXMBtnDefs.GROUPS (same reference)");
ok(defsSrc.includes("window.MXMBtnDefs = { ORDER, OPENS_TAB, DEFAULT_OFF, GROUPS }"), "btn-defs.js exposes the full shape");

// ── manifest.json + popup.html load btn-defs.js BEFORE their consumers ──
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const musixmatchGroup = manifest.content_scripts[0];
const iDefs = musixmatchGroup.js.indexOf("btn-defs.js");
const iBtns = musixmatchGroup.js.indexOf("buttons-mxm.js");
ok(iDefs >= 0 && iDefs < iBtns, "manifest.json: btn-defs.js loads before buttons-mxm.js in the musixmatch group");
const popupHtml = fs.readFileSync(path.join(EXT, "popup.html"), "utf8");
const popupScripts = [...popupHtml.matchAll(/<script src="([^"]+)">/g)].map((m) => m[1]);
ok(popupScripts.indexOf("btn-defs.js") >= 0 && popupScripts.indexOf("btn-defs.js") < popupScripts.indexOf("popup.js"),
  "popup.html: btn-defs.js loads before popup.js");

// ── Real behavior: load ONLY btn-defs.js + popup.js (without buttons-mxm.js,
//    which does not run on popup.html) and confirm BTNS/POPUP_GROUPS/
//    BTN_DEFAULT_OFF end up EXACTLY matching what btn-defs.js defines — the
//    real "single source" guarantee, not just source text. ──
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-btndefs-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pe: " + e.message));
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.waitForTimeout(700); // popup.js already ran with the page's real load

const check = await p.evaluate(() => {
  const defs = window.MXMBtnDefs;
  return {
    order: defs.ORDER,
    // BTNS/POPUP_GROUPS/BTN_DEFAULT_OFF are popup.js top-level variables, not
    // exported — read indirectly via the observable effect: the button order
    // rendered in the popup (data-key of each .row) must match 1:1 with
    // MXMBtnDefs.ORDER (grouped or not).
    renderedKeys: Array.from(document.querySelectorAll("#buttons-list [data-key]")).map((el) => el.dataset.key),
  };
});
// Grouped ones (cluster members) do not have their own .row with a visible
// individual data-key except inside the .blk-group block — filter only by
// presence, not by exact index (a cluster's internal order may differ from
// the global ORDER, but ALL keys must be present).
const missing = check.order.filter((k) => !check.renderedKeys.includes(k));
ok(missing.length === 0, `ALL ${check.order.length} MXMBtnDefs.ORDER keys are rendered in the popup` + (missing.length ? ` (missing: ${missing.join(",")})` : ""));

if (errs.length) { console.log("errors:", errs.slice(0, 5)); fails.push("page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
