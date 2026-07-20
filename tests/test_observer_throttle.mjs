// Cheap observers. auto-continue.js and highlighter.js reacted to EVERY DOM
// mutation (Studio mutates constantly: typing, animations, SPA) by calling
// expensive functions — auto-continue scanned ALL of the document's
// div[dir=auto]/span; highlighter serialized document.body.textContent IN
// FULL (including the entire lyrics) on every mutation. Now both throttle at
// 300ms.
//
// auto-continue.js: end-to-end behavior (its `enabled` gate is observable).
// highlighter.js: its state (curOpenKey) is internal, with no real flow
// accessible without the whole onEnterEditor cycle — verified with a SOURCE
// assert (same pattern already used by test_savesend_order.mjs and other
// suites for structural locks), not a test hook added to production.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-throttle-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// ── highlighter.js: source lock (throttle + early-exit) ──
const hlSrc = fs.readFileSync(path.join(EXT, "highlighter.js"), "utf8");
const iObs = hlSrc.indexOf("const completionObserver = new MutationObserver");
const iEarly = hlSrc.indexOf("if (!curOpenKey || curCompleted || completionTimer) return;");
const iTimer = hlSrc.indexOf("completionTimer = setTimeout(", iObs);
ok(iObs > 0 && iEarly > iObs && iTimer > iEarly, "highlighter: completionObserver early-exits BEFORE scheduling the timeout");
ok(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,80}completionTimer = null;[\s\S]{0,300}document\.body\.textContent/.test(hlSrc),
  "highlighter: document.body.textContent (expensive) stays INSIDE the setTimeout, not in the observer's direct callback");

// ── auto-continue.js: end-to-end behavior ──
const h = await ctx.newPage();
h.on("pageerror", (e) => errs.push("pe: " + e.message));
h.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(300);
await h.evaluate(() => new Promise((r) => chrome.storage.local.set({ autoContinueThanks: true }, r)));
await h.evaluate(() => { document.body.innerHTML = ""; });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-log.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
// Spy on findByText (the expensive one) counting real invocations, without
// changing its behavior — wraps mxm-core.js's real function.
await h.evaluate(() => {
  window.__findByTextCalls = 0;
  const real = window.MXMCore.findByText;
  window.MXMCore.findByText = (m) => { window.__findByTextCalls++; return real(m); };
});
await h.addScriptTag({ url: `chrome-extension://${extId}/auto-continue.js` });
await h.waitForTimeout(300); // let `enabled` hydrate from storage.local

// Burst of mutations IN SEPARATE TICKS (not one single synchronous batch — a
// single synchronous batch would be coalesced by MutationObserver itself
// anyway; here real typing is simulated, one mutation per tick over ~300ms).
for (let i = 0; i < 12; i++) {
  await h.evaluate((n) => {
    const d = document.createElement("div");
    d.textContent = "mutation " + n;
    document.body.appendChild(d);
  }, i);
  await h.waitForTimeout(25);
}
const callsAfterBurst = await h.evaluate(() => window.__findByTextCalls);
ok(callsAfterBurst >= 1 && callsAfterBurst <= 3, `12 mutations in a burst -> findByText called ${callsAfterBurst} times (throttled, NOT 12)`);

// Now for real: the real banner appears -> it must detect it and click
// "Continue" (not "Learn more", which is an <a>) despite the throttle.
await h.evaluate(() => {
  // findByText (mxm-core.js) only looks for div[dir="auto"] or span.
  const title = document.createElement("div"); title.setAttribute("dir", "auto");
  title.textContent = "Thanks for your contribution!"; document.body.appendChild(title);
  const learnMore = document.createElement("a"); learnMore.textContent = "Learn more"; document.body.appendChild(learnMore);
  const btn = document.createElement("div"); btn.setAttribute("tabindex", "0"); btn.textContent = "Continue";
  btn.style.cssText = "position:fixed;top:200px;left:200px;width:100px;height:30px";
  btn.addEventListener("click", () => btn.setAttribute("data-clicked", "1"));
  document.body.appendChild(btn);
});
await h.waitForTimeout(500); // > the 300ms throttle
const clicked = await h.evaluate(() => document.querySelector('[tabindex]')?.hasAttribute("data-clicked"));
ok(clicked === true, "despite the throttle, it STILL detects the real banner and clicks Continue");

if (errs.length) { console.log("errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
