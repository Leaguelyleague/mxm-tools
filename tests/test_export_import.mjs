// COMPLETE export/import. Before, 19 real storage.local keys were missing
// (unirParens*/wrap*Enabled+Upper, autoCloseAssistant, autoContinueThanks,
// contributorAutoCheck, contributorFixedLabel, btnOrder, groupButtons,
// groupButtonsBy, floatingButtonsOn, buttonsMovable, btnAnimation, savePath)
// — anyone exporting and importing on a new install lost almost the whole
// Buttons tab and several Functions toggles. Also btnPos:<key> (dragged
// positions, dynamic prefix) was never exported. This test: 1) seeds storage
// with those keys + a btnPos:*, exports and verifies ALL come out in the
// file; 2) clears storage, imports that same file, and verifies ALL come back
// with their exact value (round-trip).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-expimp-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  acceptDownloads: true,
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

// Previously considered "low value" (recently added to LOCAL_KEYS) — the
// fixture covers ALL the ones that were missing + a couple that already
// worked, as a control that the export keeps carrying the usual ones.
const PREVIOUSLY_MISSING = {
  unirParensEnabled: false, unirParensUpper: true,
  wrapParensEnabled: false, wrapParensUpper: true,
  wrapQuestionEnabled: false, wrapQuestionUpper: true,
  wrapExclaimEnabled: false, wrapExclaimUpper: true,
  autoCloseAssistant: true, autoContinueThanks: false,
  contributorAutoCheck: false, contributorFixedLabel: false,
  btnOrder: ["saveSend", "copy", "gem"],
  groupButtons: false,
  groupButtonsBy: { gemGroup: false, streamGroup: true },
  floatingButtonsOn: false, buttonsMovable: true,
  btnAnimation: "meteorShower", savePath: "MyLyrics/2026",
};
const CONTROL = { unirEnabled: false, hlEnabled: false }; // already in LOCAL_KEYS

await p.goto(`chrome-extension://${extId}/options.html`);
await p.waitForTimeout(400);

// Seed: the previously missing ones + control + a synthetic btnPos:*.
await p.evaluate(({ missing, control }) => new Promise((r) => {
  chrome.storage.local.set({ ...missing, ...control, "btnPos:gem": { left: 111, top: 222 } }, r);
}), { missing: PREVIOUSLY_MISSING, control: CONTROL });

// ── Export: intercept the download and read the JSON ──
const [download] = await Promise.all([
  p.waitForEvent("download"),
  p.click("#export"),
]);
const dlPath = await download.path();
const exported = JSON.parse(fs.readFileSync(dlPath, "utf8"));

ok(exported.app === "mxm-tools", "the exported file has the correct app id");
ok(exported.version === 2, "format version bumped to 2 (was 1)");

let allMissingPresent = true, badVal = null;
for (const [k, v] of Object.entries(PREVIOUSLY_MISSING)) {
  const got = exported.local[k];
  if (JSON.stringify(got) !== JSON.stringify(v)) { allMissingPresent = false; badVal = `${k}: expected ${JSON.stringify(v)}, exported ${JSON.stringify(got)}`; }
}
ok(allMissingPresent, "the 19 previously missing keys DO come out in the export with their value" + (badVal ? " (failed: " + badVal + ")" : ""));

let controlOk = true;
for (const [k, v] of Object.entries(CONTROL)) if (exported.local[k] !== v) controlOk = false;
ok(controlOk, "the keys that already worked (control) still come out");

ok(JSON.stringify(exported.local["btnPos:gem"]) === JSON.stringify({ left: 111, top: 222 }),
  "btnPos:<key> (dynamic prefix) comes out in the export");

// ── Import: clear storage.local, import the exported file, verify ──
await p.evaluate(() => new Promise((r) => chrome.storage.local.clear(r)));
const stillGoodBefore = await p.evaluate(() => new Promise((r) => chrome.storage.local.get("unirParensEnabled", (d) => r(d.unirParensEnabled))));
ok(stillGoodBefore === undefined, "storage.local was really cleared before importing (sanity check)");

// Simulate picking the file: setInputFiles + reload options to re-wire the
// listeners (doImport is already hooked to #import-file 'change').
await p.setInputFiles("#import-file", dlPath);
await p.waitForTimeout(500);

const restored = await p.evaluate((keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  [...Object.keys(PREVIOUSLY_MISSING), ...Object.keys(CONTROL), "btnPos:gem"]);

let roundTripOk = true, badKey = null;
for (const [k, v] of Object.entries({ ...PREVIOUSLY_MISSING, ...CONTROL, "btnPos:gem": { left: 111, top: 222 } })) {
  if (JSON.stringify(restored[k]) !== JSON.stringify(v)) { roundTripOk = false; badKey = `${k}: expected ${JSON.stringify(v)}, ended up ${JSON.stringify(restored[k])}`; }
}
ok(roundTripOk, "ROUND-TRIP: after export→clear→import, ALL keys come back with their exact value" + (badKey ? " (failed: " + badKey + ")" : ""));

if (errs.length) { console.log("page errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
