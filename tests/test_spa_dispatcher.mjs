// Single SPA dispatcher + timers that pause with no buttons.
//
// A) MXMCore.onNavigate(cb): before, 4 files (buttons-mxm/compare/
//    highlighter/assistant) each ran their own 500ms observer+interval
//    detecting URL changes. Now there is a single one in mxm-core; the 4
//    subscribe. Test: 2 subscribers, one real URL change fires BOTH exactly
//    once (not once per 500ms poll).
//
// B) mxm-buttons.js: the repositioning timers (maybeRestack,
//    positionContribLabel, 700ms each) ran ALWAYS, even on pages with no
//    floating button. Now they start with the first register() and stop
//    when the last button is removed. Test: spying on setInterval/
//    clearInterval, zero 700ms timers before registering, 2 on registering
//    the first button, 0 again on removing it.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

// about:blank has a NULL origin: history.pushState throws SecurityError there.
// The loaded extension + our own page (real origin) are used to simulate SPA
// navigation with pushState, the same way Studio does.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-spadisp-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;

// ── A) onNavigate: single dispatcher ──
{
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.evaluate(() => { document.body.innerHTML = ""; }); // clear options' DOM before injecting mxm-core
  await page.addScriptTag({ url: `chrome-extension://${extId}/mxm-log.js` });
  await page.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
  await page.evaluate(() => history.pushState({}, "", "/inicio")); // real location.href before subscribing

  const result = await page.evaluate(() => new Promise((resolve) => {
    let calls1 = 0, calls2 = 0;
    window.MXMCore.onNavigate(() => { calls1++; });
    window.MXMCore.onNavigate(() => { calls2++; });
    history.pushState({}, "", "/otra-pagina");
    // Wait more than one interval cycle (500ms) to confirm it does NOT fire
    // again on every poll with no real URL change.
    setTimeout(() => resolve({ calls1, calls2, href: location.href }), 1300);
  }));
  ok(result.href.endsWith("/otra-pagina"), "location.href reflected the pushState");
  ok(result.calls1 === 1, `subscriber 1 fired exactly 1 time (not per poll) -> ${result.calls1}`);
  ok(result.calls2 === 1, `subscriber 2 fired exactly 1 time -> ${result.calls2}`);
  await page.close();
}

// ── Source lock: the 4 files use onNavigate, none reimplements its own
//    500ms observer+interval ──
for (const f of ["buttons-mxm.js", "compare.js", "highlighter.js", "assistant.js"]) {
  const src = fs.readFileSync(path.join(EXT, f), "utf8");
  ok(/core\.onNavigate\(/.test(src), `${f}: uses core.onNavigate`);
  ok(!/setInterval\(checkUrl, 500\)/.test(src), `${f}: does NOT reimplement its own setInterval(checkUrl, 500)`);
}
const coreSrc = fs.readFileSync(path.join(EXT, "mxm-core.js"), "utf8");
ok(coreSrc.includes("function onNavigate(cb)"), "mxm-core.js defines onNavigate");
ok(/window\.MXMCore = \{[\s\S]*?onNavigate,/.test(coreSrc), "mxm-core.js exposes onNavigate on window.MXMCore");

// ── B) mxm-buttons.js timers pause with no buttons ──
{
  const page = await ctx.newPage();
  const loadErrs = [];
  page.on("pageerror", (e) => loadErrs.push(e.message));
  await page.goto("about:blank");
  await page.evaluate(() => {
    window.__timers700 = new Set();
    const origSet = window.setInterval.bind(window);
    const origClear = window.clearInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => {
      const id = origSet(fn, ms, ...rest);
      if (ms === 700) window.__timers700.add(id);
      return id;
    };
    window.clearInterval = (id) => { window.__timers700.delete(id); return origClear(id); };
    // minimal mocks mxm-buttons.js needs in its own module scope.
    // NOTE: Chromium ALREADY defines window.chrome (native stub {loadTimes,csi,app}
    // on EVERY page, even about:blank) — must MERGE, not replace with `||`
    // (that would never overwrite anything because window.chrome is already truthy).
    window.chrome = window.chrome || {};
    window.chrome.storage = { local: { get: (_k, cb) => cb({}), set: () => {} }, onChanged: { addListener: () => {} } };
    window.chrome.runtime = window.chrome.runtime || {};
  });
  await page.addScriptTag({ path: path.join(EXT, "mxm-buttons.js") });
  await page.waitForTimeout(100);
  if (loadErrs.length) console.log("errors loading mxm-buttons.js:", loadErrs);

  const before = await page.evaluate(() => window.__timers700.size);
  ok(before === 0, `before registering any button: 0 700ms timers (was ${before})`);

  await page.evaluate(() => window.MXMButtons.register({
    key: "test", icon: "<svg></svg>", color: "#fff", stackIndex: 0, onClick: () => {},
  }));
  await page.waitForTimeout(100);
  const afterRegister = await page.evaluate(() => window.__timers700.size);
  ok(afterRegister === 2, `after registering the 1st button: 2 700ms timers (maybeRestack + positionContribLabel) -> ${afterRegister}`);

  await page.evaluate(() => window.MXMButtons.remove("test"));
  await page.waitForTimeout(100);
  const afterRemove = await page.evaluate(() => window.__timers700.size);
  ok(afterRemove === 0, `after removing the last button: 0 timers again (stopped) -> ${afterRemove}`);
  await page.close();
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
await ctx.close();
process.exit(fails.length ? 1 : 0);
