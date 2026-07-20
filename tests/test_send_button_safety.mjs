// Safer findSendButton. It used to match ANY clickable with text "Send" at
// top<90, even if it was INSIDE a fixed overlay (modal/dropdown) — a wrong
// click here would send a real contribution. Now it excludes candidates
// inside an overlay (core.findFixedOverlay). Also, onSaveSend's 1st
// confirmation click now VALIDATES the target (warns right away if there is
// no Send, does not wait for the 2nd click) and highlights it with a visible
// outline on the real page.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-sendsafe-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

const h = await ctx.newPage();
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("pe: " + e.message); });
h.on("console", (m) => { if (m.type() === "error" && !/setting .value./.test(m.text())) errs.push("con: " + m.text()); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(700);

await h.evaluate(() => {
  document.body.innerHTML = "";
  // REAL header Send (top<90).
  const realSend = document.createElement("div");
  realSend.id = "real-send"; realSend.setAttribute("tabindex", "0"); realSend.textContent = "Send";
  realSend.style.cssText = "position:fixed;top:20px;left:900px;width:60px;height:30px";
  document.body.appendChild(realSend);
  // "Send" INSIDE a full-viewport fixed overlay (simulates a modal/dropdown
  // with a menu item that happens to say "Send" and ends up at top<90 before
  // the real one exists) — must NOT match.
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;";
  document.body.appendChild(overlay);
  const fakeSend = document.createElement("div");
  fakeSend.id = "fake-send-in-overlay"; fakeSend.setAttribute("tabindex", "0"); fakeSend.textContent = "Send";
  fakeSend.style.cssText = "position:fixed;top:10px;left:100px;width:60px;height:30px";
  overlay.appendChild(fakeSend);

  const lyr = document.createElement("textarea"); lyr.id = "lyr"; lyr.value = "a line"; document.body.appendChild(lyr);

  window.__toasts = [];
  window.MXMButtons = { showToast: (e, m) => window.__toasts.push(m), showBubble() {}, hideBubble() {} };
  window.MXMI18n = { t: (k) => k };
  window.MXMCore = {
    CLICKABLE_SEL: '[tabindex], button, [class*="r-1otgn73"]',
    findFixedOverlay(node) {
      for (let e = node; e && e !== document.body; e = e.parentElement) {
        if (getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().width >= window.innerWidth * 0.9) return e;
      }
      return null;
    },
    isTaskEditorPage: () => true, isOnTranscript: () => true, ensureTranscript: async () => true,
    getTranscriptTextarea: () => document.getElementById("lyr"), getSongInfo: () => ({ song: "S", artist: "A" }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fireClickFull: (el) => { window.__clicked = el.id; },
    songKey: (s, a) => `${s} — ${a}`.toLowerCase(),
  };
});

await h.addScriptTag({ url: `chrome-extension://${extId}/save-lyrics.js` });
await h.waitForTimeout(150);

// ── Overlay present: findSendButton (via onSaveSend's 1st click) must find
//    the REAL one, ignore the overlay's ghost, and highlight it. ──
await h.evaluate(() => window.MXMSave.onSaveSend(null));
await h.waitForTimeout(100);
const highlighted = await h.evaluate(() => {
  const real = document.getElementById("real-send");
  const fake = document.getElementById("fake-send-in-overlay");
  return { realOutline: real.style.outline, fakeOutline: fake.style.outline };
});
// The browser normalizes #4FB477 -> rgb(79, 180, 119) when reading
// .style.outline; do not hardcode the color format, just that an outline
// EXISTS (previously empty).
ok(!!highlighted.realOutline && highlighted.realOutline.includes("3px"), "highlights the REAL Send on the 1st confirmation click → " + highlighted.realOutline);
ok(!highlighted.fakeOutline, "the Send INSIDE the overlay is NOT highlighted (did not match)");

// ── 2nd click: must click the REAL one, never the overlay's ──
await h.evaluate(() => window.MXMSave.onSaveSend(null));
await h.waitForTimeout(200);
const clicked = await h.evaluate(() => window.__clicked);
ok(clicked === "real-send", "the 2nd click presses the REAL Send (not the overlay's) → clicked=" + clicked);

// ── With no visible Send: the 1st click warns right away, does not wait for the 2nd ──
await h.evaluate(() => {
  document.body.innerHTML = "";
  const lyr = document.createElement("textarea"); lyr.id = "lyr"; lyr.value = "x"; document.body.appendChild(lyr);
  window.__toasts = [];
});
await h.evaluate(() => window.MXMSave.onSaveSend(null));
const toastsNoSend = await h.evaluate(() => window.__toasts);
ok(toastsNoSend.includes("toast.saveSendNoBtn"), "with no visible Send, the 1st click warns RIGHT AWAY (fail-fast) → " + JSON.stringify(toastsNoSend));

if (errs.length) { console.log("errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
