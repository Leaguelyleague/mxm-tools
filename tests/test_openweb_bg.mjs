// Batch 13 · item 2: "open on the web" with a background-tab option (default ON).
// core.openTrackPage({background}) asks the background page for the tab (openTab) instead
// of window.open; without opts it keeps window.open (slackInvite/contribProfile).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-ow-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// ── Source-checks of the wiring ──
const bm = fs.readFileSync(path.join(EXT, "buttons-mxm.js"), "utf8");
const bd = fs.readFileSync(path.join(EXT, "btn-defs.js"), "utf8"); // Phase 5: OPENS_TAB lives here, not in popup.js
ok(/getTabConfig\("openWeb"\)/.test(bm) && /openTrackPage\(\{ background: cfg\.background \}\)/.test(bm), "doOpenWeb passes its tab config to openTrackPage");
ok(/resolve\(\{ background: cfg\.background !== false \}\)/.test(bm), "getTabConfig defaults background=true");
ok(/openWeb: true/.test(bd), "btn-defs.js marks openWeb with OPENS_TAB:true (popup shows the ▶)");
ok(/slackInvitePending[\s\S]*?core\.openTrackPage\(\);/.test(bm) && /goProfilePending[\s\S]*?core\.openTrackPage\(\);/.test(bm), "slackInvite and contribProfile call openTrackPage() with no args (window.open, unchanged)");

// ── Real routing of core.openTrackPage ──
const h = await ctx.newPage();
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("pe: " + e.message); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(500);
await h.evaluate(() => {
  const INFO = "M12 2C6.486 2 2 6.486 2 12 12.514 22 12 22 17.514 22 22 17.514 22 12";
  document.body.innerHTML = "";
  // header ⓘ button (findInfoButton matches it by the INFO path)
  const info = document.createElement("div"); info.setAttribute("tabindex", "0");
  info.style.cssText = "position:fixed;top:10px;left:400px;width:30px;height:30px";
  info.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="${INFO}"/></svg>`;
  document.body.appendChild(info);
  // modal: "Title" label + the lyrics link
  const title = document.createElement("div"); title.setAttribute("dir", "auto"); title.textContent = "Title";
  const a = document.createElement("a"); a.href = "//www.musixmatch.com/lyrics/111/222"; a.textContent = "web";
  document.body.append(title, a);
  // spies
  window.__opened = []; window.__origOpen = window.open; window.open = (u) => { window.__opened.push(u); return null; };
  window.__sent = [];
  chrome.runtime.sendMessage = (msg, cb) => { window.__sent.push(msg); if (typeof cb === "function") cb(); };
});
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
await h.waitForTimeout(200);

const run = async (opts) => h.evaluate(async (o) => {
  window.__opened.length = 0; window.__sent.length = 0;
  const res = await window.MXMCore.openTrackPage(o);
  return { res, opened: window.__opened.slice(), sent: window.__sent.slice() };
}, opts);

// background tab (openWeb default)
let r = await run({ background: true });
ok(r.res && r.res.ok && /lyrics\/111\/222/.test(r.res.url || ""), "openTrackPage({bg:true}) returns ok + url");
ok(r.sent.some((m) => m && m.action === "openTab" && m.background === true) && r.opened.length === 0, "{bg:true}: asks for openTab background=true, NOT window.open");

// foreground
r = await run({ background: false });
ok(r.sent.some((m) => m && m.action === "openTab" && m.background === false) && r.opened.length === 0, "{bg:false}: asks for openTab background=false");

// no opts: historical window.open behavior (slackInvite/contribProfile)
r = await run(undefined);
ok(r.opened.length === 1 && !r.sent.some((m) => m && m.action === "openTab"), "no opts: uses window.open (historical), not openTab");

ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
