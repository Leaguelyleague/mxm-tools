// Design revert + highlighter without lists + master switch + icons +
// LyricsBackups + "gray screen" fix. Validates popup, options and
// highlighter.js against synthetic DOM.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-l8-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// ── POPUP ──
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("popup: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("popup console: " + m.text()); });
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.waitForTimeout(900);

ok(await p.evaluate(() => !document.documentElement.dataset.theme), "no data-theme (redesign reverted)");
ok(await p.evaluate(() => !document.getElementById("hl-lists") && !document.getElementById("hl-add")), "highlighter list UI removed");
ok(await p.evaluate(() => !!document.getElementById("btn-master")), "master switch present");
// highlighter tab: automark + opened-songs list remain
await p.click('[data-tab="highlighter"]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => !!document.getElementById("hl-automark") && !!document.querySelector("#hl-opened .hl-additem")), "automark + opened-songs list remain");
// master switch persists
await p.click('[data-tab="buttons"]'); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById("btn-master").click()); await p.waitForTimeout(300);
ok((await p.evaluate(() => new Promise((r) => chrome.storage.local.get("floatingButtonsOn", (v) => r(v.floatingButtonsOn))))) === false, "master OFF → floatingButtonsOn=false");
await p.evaluate(() => document.getElementById("btn-master").click()); await p.waitForTimeout(200);
ok((await p.evaluate(() => new Promise((r) => chrome.storage.local.get("floatingButtonsOn", (v) => r(v.floatingButtonsOn))))) === true, "master back ON");
// icons: saveSend = disk only (no paper plane), save = download arrow
const icons = await p.evaluate(async () => {
  const src = await (await fetch(chrome.runtime.getURL("buttons-mxm.js"))).text();
  const grab = (name) => (src.match(new RegExp(`const ${name} = \`([^\`]+)\``)) || [])[1] || "";
  return { save: grab("saveIcon"), saveSend: grab("saveSendIcon") };
});
ok(icons.saveSend.includes("M17 3H5") && !icons.saveSend.includes("22 10"), "saveSend = disk without the little arrow");
ok(icons.save.includes("M19 9h-4V3H9v6H5l7 7 7-7z"), "save = universal download icon");

// ── OPTIONS ──
const o = await ctx.newPage();
o.on("pageerror", (e) => errs.push("options: " + e.message));
o.on("console", (m) => { if (m.type() === "error") errs.push("options console: " + m.text()); });
await o.goto(`chrome-extension://${extId}/options.html`);
await o.waitForTimeout(800);
ok(await o.evaluate(() => !document.getElementById("theme-cards") && !document.getElementById("toc")), "options with no redesign leftovers");
ok(await o.evaluate(() => document.getElementById("save_path").value) === "LyricsBackups", "default folder = LyricsBackups");

// ── HIGHLIGHTER (synthetic DOM) ──
await o.evaluate(() => new Promise((r) => chrome.storage.local.set({
  hlEnabled: true,
  hlPhrases: { l1: ["Turututu"] },
  hlAutoMarkOpened: true,
  hlAutoMarkMode: "on-open",
  openedSongs: ["song one — artist one", "song two — artist two"],
}, r)));
const h = await ctx.newPage();
h.on("pageerror", (e) => errs.push("hl: " + e.message));
await h.goto(`chrome-extension://${extId}/options.html`);
await h.evaluate(() => {
  document.body.innerHTML = "";
  const mkCard = (title, artist) => {
    const card = document.createElement("div");
    card.style.cssText = "height:80px;display:flex;align-items:center;border:1px solid #ccc;margin:6px";
    const meta = document.createElement("div"); meta.className = "r-dd0y9b";
    const t = document.createElement("div"); t.className = "r-1inkyih r-1kfrs79"; t.textContent = title;
    const a = document.createElement("div"); a.className = "r-a023e6"; a.textContent = artist;
    meta.append(t, a); card.appendChild(meta); document.body.appendChild(card);
    return card;
  };
  // normal card (opened) + normal card (not opened)
  mkCard("Song One", "Artist One").id = "c1";
  mkCard("Another Song", "Another Artist").id = "c2";
  // BUG SCENARIO: a stray title with NO nearby META container, inside a giant
  // container (simulates the list with a single task / different layout)
  const giant = document.createElement("div"); giant.id = "giant";
  giant.style.cssText = "height:600px;border:1px solid red";
  const loneTitle = document.createElement("div");
  loneTitle.className = "r-1inkyih r-1kfrs79"; loneTitle.textContent = "Song Two";
  giant.appendChild(loneTitle); document.body.appendChild(giant);
  // stray text for the manual highlight
  const tx = document.createElement("p"); tx.textContent = "this says Turututu in the middle"; document.body.appendChild(tx);
});
// inject core + stubs + highlighter
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
await h.evaluate(() => { window.MXMButtons = { showToast() {} }; });
await h.addScriptTag({ url: `chrome-extension://${extId}/highlighter.js` });
await h.waitForTimeout(800);

const hlRes = await h.evaluate(() => ({
  markedC1: document.getElementById("c1").hasAttribute("data-mxm-opened"),
  markedC2: document.getElementById("c2").hasAttribute("data-mxm-opened"),
  giantMarked: document.getElementById("giant").hasAttribute("data-mxm-opened"),
  giantOpacity: document.getElementById("giant").style.opacity,
  anyBodyLevel: document.body.hasAttribute("data-mxm-opened"),
  hlSpans: document.querySelectorAll("span.mxm-hl").length,
  hlBg: document.querySelector("span.mxm-hl")?.style.backgroundColor || "",
}));
ok(hlRes.markedC1 === true, "opened card marked");
ok(hlRes.markedC2 === false, "unopened card left unmarked");
ok(hlRes.giantMarked === false && hlRes.giantOpacity === "" && !hlRes.anyBodyLevel, "GRAY FIX: the giant container is NOT painted");
ok(hlRes.hlSpans === 1 && hlRes.hlBg === "rgb(255, 243, 163)", "manual highlighting with the single list works (Turututu)");

// highlighter.js NO LONGER has a card contextmenu listener. Right-clicking a
// card's body must not toggle anything (marking via ⋯ is handled by
// mxm_menu.js, tested in test_dotsaction.mjs).
const before = await h.evaluate(() => new Promise((r) => chrome.storage.local.get("openedSongs", (v) => r(v.openedSongs.length))));
await h.click("#giant", { button: "right" }); await h.waitForTimeout(300);
await h.click("#c2", { button: "right" }); await h.waitForTimeout(300);
const after = await h.evaluate(() => new Promise((r) => chrome.storage.local.get("openedSongs", (v) => r(v.openedSongs.length))));
ok(before === after, "right-click on the card no longer toggles anything (highlighter has no card listener)");
const hlSrc = await h.evaluate(async () => await (await fetch(chrome.runtime.getURL("highlighter.js"))).text());
ok(!hlSrc.includes("isOnCardDots") && !hlSrc.includes('addEventListener("contextmenu"'), "highlighter.js has no isOnCardDots or contextmenu listener");

ok(errs.length === 0, "zero console/page errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
