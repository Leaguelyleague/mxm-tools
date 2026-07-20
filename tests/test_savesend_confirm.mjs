// Save & Send with double-click confirmation.
//  - 1st click: does NOT send, shows the warning.
//  - 2nd click within 3s: sends (fireClickFull on the Send).
//  - if >3s pass, the 2nd click asks for confirmation again (does not send).
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

const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => { if (!/setting 'value'/.test(e.message)) errs.push(e.message); });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => {
  document.body.innerHTML = "";
  // synthetic real Send button (the one the extension clicks on confirm)
  const send = document.createElement("div");
  send.setAttribute("data-send", "1"); send.setAttribute("tabindex", "0");
  send.style.cssText = "position:fixed;top:16px;right:24px;width:88px;height:34px";
  const leaf = document.createElement("div"); leaf.textContent = "Send"; send.appendChild(leaf);
  document.body.appendChild(send);
  window.__sends = 0;
  send.addEventListener("click", () => { window.__sends++; });
  // core/ui stubs used by save-lyrics
  window.__toasts = [];
  window.MXMCore = {
    isTaskEditorPage: () => true, CLICKABLE_SEL: "[data-send]",
    getTranscriptTextarea: () => ({ value: "LYRIC" }), isOnTranscript: () => true, ensureTranscript: async () => true,
    getSongInfo: () => ({ song: "x", artist: "y" }), songKey: () => "k",
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fireClickFull: (el) => el.click(),
    findFixedOverlay: () => null, // findSendButton now uses this
  };
  window.MXMButtons = { showToast: (_e, msg) => { window.__toasts.push(msg); }, showBubble: () => {}, hideBubble: () => {} };
  window.MXMI18n = { t: (k) => (k === "toast.saveSendConfirm" ? "CONFIRM-MSG" : k) };
  // The real doSave would try to download; we intercept via MXMSave below.
});
await p.evaluate(() => new Promise((r) => {
  const s = "LYRIC"; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  chrome.storage.local.set({ "savedLyric:k": { h, len: s.length } }, r);
}));
await p.addScriptTag({ url: `chrome-extension://${extId}/save-lyrics.js` });
await p.waitForTimeout(300);
// We do not force doSave to "succeed" without downloading anything real by
// patching onSaveSend; the real doSave fires a download via a runtime message
// and may fail in this DOM, so we measure behavior via TOASTS and sends:
const clickSS = () => p.evaluate(() => window.MXMSave.onSaveSend(null));

// 1st click → warning, no send
await clickSS(); await p.waitForTimeout(200);
let st = await p.evaluate(() => ({ toasts: window.__toasts.slice(), sends: window.__sends }));
ok(st.toasts[st.toasts.length - 1] === "CONFIRM-MSG", "1st click shows the confirmation warning");
ok(st.sends === 0, "1st click does NOT send");

// 2nd click within the window → sends (wait for doSave+sleep to resolve)
await clickSS(); await p.waitForTimeout(1200);
st = await p.evaluate(() => ({ toasts: window.__toasts.slice(), sends: window.__sends }));
ok(st.sends === 1, "2nd click (within 3s) sends → sends=" + st.sends);

// isolated third click → asks for confirmation again (does not send)
await clickSS(); await p.waitForTimeout(200);
st = await p.evaluate(() => ({ toasts: window.__toasts.slice(), sends: window.__sends }));
ok(st.sends === 1 && st.toasts[st.toasts.length - 1] === "CONFIRM-MSG", "a new click asks for confirmation again");

// let the confirmation armed above expire; then click + >3s + click → does NOT send
await p.waitForTimeout(3200);
await clickSS(); await p.waitForTimeout(3200); await clickSS(); await p.waitForTimeout(300);
st = await p.evaluate(() => ({ sends: window.__sends }));
ok(st.sends === 1, "with >3s between clicks it does NOT send (expired window)");

ok(errs.length === 0, "no page errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
