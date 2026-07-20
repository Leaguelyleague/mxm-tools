// Items 14/15 (core): validates against a synthetic DOM of the editor the
// REAL functions in mxm-core.js used by doOpenWeb and doResetSync.
//  - openTrackPage(): opens ⋯→"Track info", reads the <a href="/lyrics/…"> from
//    the Title row, normalizes it to https, opens a tab and returns { ok, url }.
//  - gotoSection("Time-sync") + clickHeaderMenuItem("Restart sync"): the reset
//    mechanism (switching tabs + clicking the ⋯ item).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-ti-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;

const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => {
  document.body.innerHTML = ""; document.documentElement.style.margin = "0";
  const mk = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.firstElementChild; };
  const dots = mk('<div id="dots" tabindex="0" style="position:fixed;top:20px;left:1120px;width:32px;height:32px"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 12c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm10-2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>');
  // Header ⓘ button (openTrackPage's primary i18n-proof anchor via INFO_PATH_PREFIX).
  const info = mk('<div id="info" tabindex="0" style="position:fixed;top:20px;left:1080px;width:32px;height:32px"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2z"/></svg></div>');
  const menu = mk('<div id="menu" style="display:none;position:fixed;top:60px;left:1000px"><div class="mi rs" tabindex="0" style="padding:6px"><div dir="auto">Restart sync</div></div></div>');
  const modal = mk('<div id="modal" style="display:none;position:fixed;inset:0"><div style="padding:8px"><div dir="auto">Title</div><a href="//www.musixmatch.com/lyrics/92991472/277786211" style="display:block">open</a></div><div id="closex"><svg viewBox="0 0 24 24"><path d="M18.295,7.115L13.41,12l4.885,4.885"/></svg></div></div>');
  const tsync = mk('<div id="tsync" tabindex="0" style="position:fixed;top:300px;left:20px;width:70px;height:30px">Time-sync</div>');
  for (const el of [dots, info, menu, modal, tsync]) document.body.appendChild(el);
  dots.addEventListener("click", () => { menu.style.display = "block"; });
  info.addEventListener("click", () => { modal.style.display = "block"; });
  menu.querySelector(".mi.rs").addEventListener("click", () => { window.__restart = true; });
  tsync.addEventListener("click", () => { window.__tsync = true; });
  window.__opened = null; window.open = (u) => { window.__opened = u; return {}; };
});
await p.addScriptTag({ url: `chrome-extension://${extId}/studio-strings.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-log.js` });
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
await p.waitForTimeout(200);
console.log("MXMCore ready:", await p.evaluate(() => typeof window.MXMCore));

// ── openTrackPage (item 14) ──
const EXPECT = "https://www.musixmatch.com/lyrics/92991472/277786211";
const res = await p.evaluate(() => window.MXMCore.openTrackPage());
const opened = await p.evaluate(() => window.__opened);
ok(res && res.ok === true, "openTrackPage returns { ok:true } → " + JSON.stringify(res));
ok(res && res.url === EXPECT, "url normalized (// → https) → " + (res && res.url));
ok(opened === EXPECT, "opened the tab with that url → " + opened);

// ── reset: gotoSection + clickHeaderMenuItem (item 15) ──
await p.evaluate(() => { window.__restart = false; window.__tsync = false; document.getElementById("menu").style.display = "none"; document.getElementById("modal").style.display = "none"; });
const goRes = await p.evaluate(() => window.MXMCore.gotoSection("Time-sync"));
const tsyncClicked = await p.evaluate(() => window.__tsync);
ok(goRes === true && tsyncClicked === true, "gotoSection('Time-sync') clicks the tab");
const clickRes = await p.evaluate(() => window.MXMCore.clickHeaderMenuItem("restart_sync"));
const restartClicked = await p.evaluate(() => window.__restart);
ok(clickRes === true && restartClicked === true, "clickHeaderMenuItem('Restart sync') opens ⋯ and clicks the item");

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
