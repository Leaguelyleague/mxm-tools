// Batch 12 · item 2: right-click on a card's ⋯, configurable action
// (dotsRightClickAction: "none" | "highlight" | "gem"), handled by mxm_menu.js.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-dots-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const h = await ctx.newPage();
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("pe: " + e.message); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(700);

// start with "highlight" (default), auto-mark active, gem active
await h.evaluate(() => new Promise((r) => chrome.storage.local.set({
  dotsRightClickAction: "highlight", hlAutoMarkOpened: true, songToGemEnabled: true, openedSongs: [],
}, r)));

// DOM: a card with META + title + artist + a ⋯ button (the 3-dots path)
await h.evaluate(() => {
  const DOTS = "M8 12c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z";
  document.body.innerHTML = "";
  const card = document.createElement("div");
  card.style.cssText = "height:80px;display:flex;align-items:center;gap:12px;border:1px solid #ccc;margin:6px;padding:8px";
  const meta = document.createElement("div"); meta.className = "r-dd0y9b";
  const t = document.createElement("div"); t.className = "r-1inkyih r-1kfrs79"; t.textContent = "Come Together";
  const a = document.createElement("div"); a.className = "r-a023e6"; a.textContent = "The Beatles";
  meta.append(t, a);
  const dots = document.createElement("div"); dots.id = "dots"; dots.setAttribute("tabindex", "0");
  dots.style.cssText = "width:40px;height:40px";
  dots.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="${DOTS}"/></svg>`;
  card.append(meta, dots); document.body.appendChild(card);
  // mocks of the globals mxm_menu.js uses (Phase 5: mxm_menu.js now
  // destructures the card selectors + DOTS_PATH_PREFIXES from MXMCore).
  window.MXMCore = {
    songKey: (s, aa) => (s || "").toLowerCase().trim() + " — " + (aa || "").toLowerCase().trim(),
    CARD_TITLE_SEL: ".r-1inkyih.r-1kfrs79",
    CARD_META_SEL: ".r-dd0y9b",
    CARD_ARTIST_SEL: ":scope > div.r-a023e6",
    CLICKABLE_SEL: '[tabindex], button, [class*="r-1otgn73"]',
    DOTS_PATH_PREFIXES: ["M8 12c0 1.1-.9 2-2 2"],
  };
  window.MXMButtons = { showToast() {} };
  window.MXMI18n = { t: () => "" };
  window.__sent = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (msg, cb) => { window.__sent.push(msg); if (typeof cb === "function") cb(); };
});
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm_menu.js` });
await h.waitForTimeout(400);

const rightClickDots = async () => {
  await h.evaluate(() => {
    const p = document.querySelector("#dots svg path");
    p.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await h.waitForTimeout(300);
};
const openedLen = () => h.evaluate(() => new Promise((r) => chrome.storage.local.get("openedSongs", (v) => r((v.openedSongs || []).length))));
const setAction = async (val) => { await h.evaluate((v) => new Promise((r) => chrome.storage.local.set({ dotsRightClickAction: v }, r)), val); await h.waitForTimeout(250); };

// 1) highlight: toggles openedSongs
await rightClickDots();
ok((await openedLen()) === 1, "highlight: marks the song (openedSongs=1)");
await rightClickDots();
ok((await openedLen()) === 0, "highlight: second click unmarks it (openedSongs=0)");

// 2) gem: fires RUN_QUERY, does not toggle openedSongs
await setAction("gem");
await rightClickDots();
const sent = await h.evaluate(() => window.__sent.slice());
ok(sent.some((m) => m && m.type === "RUN_QUERY" && /come together/i.test(m.query)), "gem: sends RUN_QUERY with the song");
ok((await openedLen()) === 0, "gem: does not toggle openedSongs");

// 3) none: does nothing
await setAction("none");
await h.evaluate(() => { window.__sent.length = 0; });
await rightClickDots();
const sent2 = await h.evaluate(() => window.__sent.slice());
ok(sent2.length === 0, "none: sends nothing");
ok((await openedLen()) === 0, "none: does not toggle openedSongs");

ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
