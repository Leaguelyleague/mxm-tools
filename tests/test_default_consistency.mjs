// Consistent defaults. assistant.js and auto-continue.js hydrated with
// `!== false` (default ON) but their onChanged used `=== true` — a real
// asymmetry: an event with newValue undefined (e.g.
// chrome.storage.local.remove(), "return to default") would make
// `enabled=false` via onChanged even though the hydration says the default is
// ON. Now both use `!== false` in both places.
//
// auto-continue.js: end-to-end behavior (a real remove() -> does it keep
// clicking Continue?). assistant.js: its flow depends on detecting /tool by
// the real URL (not drivable from a chrome-extension:// page) — verified with
// a source assert, the same pattern the rest of the suite uses for what is
// not drivable in isolation.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-defaults-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// ── assistant.js: source assert (flow not drivable in isolation, depends on
//    the real location.pathname) ──
const asSrc = fs.readFileSync(path.join(EXT, "assistant.js"), "utf8");
ok(asSrc.includes("d.autoCloseAssistant !== false"), "assistant.js: hydration uses !== false");
ok(asSrc.includes("changes.autoCloseAssistant.newValue !== false") && !asSrc.includes("changes.autoCloseAssistant.newValue === true"),
  "assistant.js: onChanged uses !== false (NO longer === true) — same semantics as the hydration");
ok(!asSrc.includes("default OFF"), "assistant.js: no comments saying 'default OFF' (the real default is ON)");

const acSrcCheck = fs.readFileSync(path.join(EXT, "auto-continue.js"), "utf8");
ok(acSrcCheck.includes("d.autoContinueThanks !== false"), "auto-continue.js: hydration uses !== false");
ok(acSrcCheck.includes("c.autoContinueThanks.newValue !== false") && !acSrcCheck.includes("c.autoContinueThanks.newValue === true"),
  "auto-continue.js: onChanged uses !== false (NO longer === true)");
ok(!acSrcCheck.includes("default\nOFF") && !acSrcCheck.includes("default OFF"), "auto-continue.js: no comments saying 'default OFF'");

const popupSrc = fs.readFileSync(path.join(EXT, "popup.js"), "utf8");
// Only the 3 toggles of THIS item (autoAssistant/contributorAutoCheck/
// autoContinue) — buttonsMovable is ANOTHER toggle, legitimately OFF by
// default, not touched here.
ok(popupSrc.includes('// Auto-close the Assistant panel when a task opens (default ON'),
  "popup.js: autoAssistant comment says 'default ON'");
ok(popupSrc.includes('// Auto-check the last contributor when the task opens (default ON'),
  "popup.js: contributorAutoCheck comment says 'default ON'");
ok(popupSrc.includes('// Auto-click "Continue" on the "Thanks..." banner (default ON'),
  "popup.js: autoContinue comment says 'default ON'");
ok(popupSrc.includes("buttonsMovable === true; // default OFF"),
  "buttonsMovable (ANOTHER toggle, legitimately OFF) stays intact — not over-touched");

// ── auto-continue.js: end-to-end behavior with a real remove() ──
const h = await ctx.newPage();
h.on("pageerror", (e) => errs.push("pe: " + e.message));
h.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(300);
// Start OFF so the scenario is observable (if the bug were still alive,
// "returning to the default" would end up false, indistinguishable from
// starting OFF).
await h.evaluate(() => new Promise((r) => chrome.storage.local.set({ autoContinueThanks: false }, r)));
await h.evaluate(() => { document.body.innerHTML = ""; });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-log.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/auto-continue.js` });
await h.waitForTimeout(300); // hydrate enabled=false

// A real remove(): fires onChanged with an ABSENT newValue (undefined) — the
// exact "return to default" scenario the old bug broke.
await h.evaluate(() => new Promise((r) => chrome.storage.local.remove("autoContinueThanks", r)));
await h.waitForTimeout(200);

await h.evaluate(() => {
  const title = document.createElement("div"); title.setAttribute("dir", "auto");
  title.textContent = "Thanks for your contribution!"; document.body.appendChild(title);
  const btn = document.createElement("div"); btn.setAttribute("tabindex", "0"); btn.textContent = "Continue";
  btn.style.cssText = "position:fixed;top:200px;left:200px;width:100px;height:30px";
  btn.addEventListener("click", () => btn.setAttribute("data-clicked", "1"));
  document.body.appendChild(btn);
});
await h.waitForTimeout(500);
const clickedAfterRemove = await h.evaluate(() => document.querySelector('[tabindex]')?.hasAttribute("data-clicked"));
ok(clickedAfterRemove === true,
  "after remove() (newValue undefined), enabled returns to the real default ON -> STILL clicks Continue");

if (errs.length) { console.log("errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
