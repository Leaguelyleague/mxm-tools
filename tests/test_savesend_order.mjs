// Batch 12 · item 11: Save & Send downloads ONLY after the "Thanks for your
// contribution" banner. New order: capture lyrics → set up observer → click
// Send → wait for Thanks → only then download. Tests the real onSaveSend
// (window.MXMSave) with a mocked MXMCore and a mock DOM of the banner.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-ss-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// Source-check of the new order (guarantees the code still follows that flow).
const src = fs.readFileSync(path.join(EXT, "save-lyrics.js"), "utf8");
const iCapture = src.indexOf("const lyrics = getLyricsText()");
const iWatch = src.indexOf("watchForThanks()");
const iSend = src.indexOf("core.fireClickFull(send)");
const iWait = src.indexOf("await waitThanks(15000)");
const iPersist = src.lastIndexOf("await persistLyrics(song, artist, lyrics, null)");
ok(iCapture > 0 && iWatch > iCapture && iSend > iWatch && iWait > iSend && iPersist > iWait,
  "source order: capture → observer → Send → wait for Thanks → persist");
ok(src.includes('toast.saveSendNoThanks'), "uses the saveSendNoThanks toast when the banner does not appear");

const h = await ctx.newPage();
// Ignore the benign options.js error when it empties its DOM before its
// load() finishes (sets .value on elements already removed).
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("pe: " + e.message); });
h.on("console", (m) => { if (m.type() === "error" && !/setting .value./.test(m.text())) errs.push("con: " + m.text()); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(700);

// DOM + mocks BEFORE loading save-lyrics.js (the IIFE captures MXMCore/MXMButtons on the fly).
await h.evaluate(() => {
  document.body.innerHTML = "";
  const lyr = document.createElement("textarea"); lyr.id = "lyr"; lyr.value = "line one\nline two\nline three"; document.body.appendChild(lyr);
  const send = document.createElement("div"); send.id = "send"; send.setAttribute("tabindex", "0");
  send.textContent = "Send"; send.style.cssText = "position:fixed;top:20px;left:100px;width:60px;height:30px";
  document.body.appendChild(send);

  window.__downloads = [];
  const origSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg && msg.action === "download") { window.__downloads.push(msg); if (cb) cb({ success: true }); return; }
    if (cb) cb();
  };
  window.__toasts = [];
  window.MXMButtons = { showToast: (e, m) => window.__toasts.push(m), showBubble() {}, hideBubble() {} };
  window.MXMI18n = { t: (k) => k };
  window.MXMCore = {
    CLICKABLE_SEL: '[tabindex], button, [class*="r-1otgn73"]',
    isTaskEditorPage: () => true,
    isOnTranscript: () => true,
    ensureTranscript: async () => true,
    getTranscriptTextarea: () => document.getElementById("lyr"),
    getSongInfo: () => ({ song: "Come Together", artist: "The Beatles" }),
    songKey: (s, a) => (s + " — " + a).toLowerCase(),
    fireClickFull: (el) => { el.setAttribute("data-sent", "1"); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    findFixedOverlay: () => null, // Phase 3: findSendButton now uses it
  };
});
await h.addScriptTag({ url: `chrome-extension://${extId}/save-lyrics.js` });
await h.waitForTimeout(200);

// 1st click: only confirms (does not send, does not download).
await h.evaluate(() => window.MXMSave.onSaveSend(null));
await h.waitForTimeout(200);
let st = await h.evaluate(() => ({ sent: !!document.getElementById("send").getAttribute("data-sent"), dl: window.__downloads.length }));
ok(!st.sent && st.dl === 0, "1st click: does not send or download (only confirms)");

// 2nd click within the window: captures, clicks Send, and WAITS for the banner.
await h.evaluate(() => { window.__p = window.MXMSave.onSaveSend(null); });
await h.waitForTimeout(500);
st = await h.evaluate(() => ({ sent: !!document.getElementById("send").getAttribute("data-sent"), dl: window.__downloads.length }));
ok(st.sent, "2nd click: clicked Send");
ok(st.dl === 0, "did NOT download yet (waiting for the Thanks banner)");

// The banner appears → must trigger the download with the captured lyrics.
await h.evaluate(() => {
  const b = document.createElement("div"); b.textContent = "Thanks for your contribution!"; document.body.appendChild(b);
});
await h.waitForTimeout(600);
st = await h.evaluate(() => ({ dl: window.__downloads.length, name: (window.__downloads[0] || {}).filename, text: (window.__downloads[0] || {}).text, toasts: window.__toasts.slice() }));
ok(st.dl === 1, "after the Thanks banner: it downloaded (1 download)");
ok(st.name === "Come Together - The Beatles", "downloaded with the correct name → " + st.name);
ok(st.text === "line one\nline two\nline three", "downloaded the lyrics captured BEFORE Send");
ok(!st.toasts.includes("toast.saveSendNoThanks"), "did not show the 'unconfirmed' notice");

ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
