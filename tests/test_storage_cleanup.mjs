// Storage cleanup. It used to run only on install/update and only touched
// baseline:*/meta:* — savedLyric:* (Save dedup) grew unbounded forever. Now
// there is a daily chrome.alarms (besides the onInstalled trigger) and
// savedLyric:* is also cleaned by age (>30 days, new ts field in the
// signature). Tests the REAL path: fires the real alarm (short delay, allowed
// on unpacked extensions) and lets background.js's real listener run the
// cleanup — no test backdoors in production code.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-cleanup-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });

// The manifest declares the "alarms" permission (otherwise chrome.alarms is undefined).
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
ok(manifest.permissions.includes("alarms"), "manifest.json declares the \"alarms\" permission");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const seed = {
  "baseline:old": { text: "x", song: "s", artist: "a", ts: now - 31 * DAY },   // old -> deleted
  "meta:old": { contributor: "c" },                                            // goes with baseline:old
  "baseline:fresh": { text: "x", song: "s", artist: "a", ts: now - 10 * DAY }, // fresh -> survives
  "meta:fresh": { contributor: "c" },
  "savedLyric:old song — old artist": { h: 1, len: 10, ts: now - 31 * DAY },   // old -> deleted
  "savedLyric:fresh song — fresh artist": { h: 2, len: 20, ts: now - 5 * DAY },// fresh -> survives
  "uiLang": "es", // normal key, unrelated to the cleanup -> never touched
};
await sw.evaluate((s) => chrome.storage.local.set(s), seed);

// Fire the REAL daily alarm with a minimal delay (allowed on unpacked
// extensions) to exercise the listener exactly as it runs in production.
await sw.evaluate(() => chrome.alarms.create("mxm-daily-cleanup", { delayInMinutes: 0.01 })); // ~0.6s

// Wait for the alarm to fire and the cleanup to run (poll the real storage).
let after = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  after = await sw.evaluate(() => chrome.storage.local.get(null));
  if (!("baseline:old" in after)) break; // already cleaned up
}

ok(!("baseline:old" in after), "baseline:old (31 days) was deleted");
ok(!("meta:old" in after), "meta:old (goes with the old baseline) was deleted");
ok("baseline:fresh" in after, "baseline:fresh (10 days) SURVIVES");
ok("meta:fresh" in after, "meta:fresh SURVIVES");
ok(!("savedLyric:old song — old artist" in after), "old savedLyric:* (31 days) was deleted");
ok("savedLyric:fresh song — fresh artist" in after, "fresh savedLyric:* (5 days) SURVIVES");
ok(after.uiLang === "es", "a normal key unrelated to the cleanup is not touched");

await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
