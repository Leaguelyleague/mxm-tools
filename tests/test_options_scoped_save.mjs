// Scoped storage.sync writes. Before, save() rewrote the 16 sync keys ON
// EVERY save, regardless of which one changed — using the DOM's current
// values. In multi-device this is a real bug: if ANOTHER device updates a key
// (e.g. curatorName) while this options page stays open with its old
// snapshot, touching ANY field here would clobber that external change with
// the DOM's stale value. Now save() compares against the last known read and
// sends ONLY what changed.
// Also: visible error handling in #status if storage.sync.set fails.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-optsave-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
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
p.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });

// Initial seed (what "was already there" before opening options.html).
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => new Promise((r) => chrome.storage.sync.set({
  gem_url: "https://gemini.google.com/gem/AAA", curatorName: "Original",
}, r)));
await p.reload();
await p.waitForTimeout(600);

// ── Spy on chrome.storage.sync.set: count calls and capture which keys each
//    one carries, WITHOUT changing its real behavior. ──
await p.evaluate(() => {
  window.__syncSetCalls = [];
  const real = chrome.storage.sync.set.bind(chrome.storage.sync);
  chrome.storage.sync.set = (obj, cb) => { window.__syncSetCalls.push(Object.keys(obj).sort()); return real(obj, cb); };
});

// ── Change a SINGLE field (gem_url) and wait for the auto-save (400ms debounce) ──
await p.fill("#gem_url", "https://gemini.google.com/gem/BBB");
await p.dispatchEvent("#gem_url", "change");
await p.waitForTimeout(700);

const calls = await p.evaluate(() => window.__syncSetCalls);
ok(calls.length === 1, `only one field touched -> a SINGLE chrome.storage.sync.set() (there were ${calls.length})`);
ok(calls[0] && calls[0].length === 1 && calls[0][0] === "gem_url",
  "that set() carries ONLY the key that changed (gem_url), not all 16 -> " + JSON.stringify(calls[0]));

// ── Simulate ANOTHER device: changes curatorName outside this page, AFTER
//    options.html already loaded its snapshot. ──
await p.evaluate(() => new Promise((r) => chrome.storage.sync.set({ curatorName: "FromAnotherDevice" }, r)));
await p.waitForTimeout(100);

// Touch an UNRELATED field (num_candidates) on THIS page: with the old bug,
// this would rewrite curatorName with the DOM's stale "Original" value.
await p.fill("#num_candidates", "7");
await p.dispatchEvent("#num_candidates", "change");
await p.waitForTimeout(700);

const curatorAfter = await p.evaluate(() => new Promise((r) => chrome.storage.sync.get("curatorName", (d) => r(d.curatorName))));
ok(curatorAfter === "FromAnotherDevice",
  "the change from ANOTHER device is NOT clobbered when saving an unrelated field on this page -> ended up: " + curatorAfter);

// ── storage.sync.set failure: #status shows the error, not "Saved ✓" ──
await p.evaluate(() => {
  chrome.storage.sync.set = (_obj, _cb) => { throw new Error("quota exceeded (simulated)"); };
});
await p.fill("#curatorName", "Another Name");
await p.dispatchEvent("#curatorName", "change");
await p.waitForTimeout(700);
const statusState = await p.evaluate(() => ({ text: document.getElementById("status").textContent, hasErrorClass: document.getElementById("status").classList.contains("error") }));
ok(statusState.hasErrorClass, "when the save fails, #status gets the .error class");
ok(statusState.text && statusState.text !== "Saved ✓", "when the save fails, the text does NOT say 'Saved ✓' -> " + JSON.stringify(statusState.text));

if (errs.length) { console.log("page errors:", errs.slice(0, 5)); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
