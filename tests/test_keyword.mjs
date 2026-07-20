// Batch 12 · item 9: markCards marks by manual KEYWORD (substring over
// normalized "title + artist") in addition to the exact songKey match.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-kw-"));
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
h.on("pageerror", (e) => { if (!/setting .value./.test(e.message)) errs.push("hl: " + e.message); });
await h.goto(`chrome-extension://${extId}/options.html`);
await h.waitForTimeout(700);
// exact match: "Song One — Artist One"; keyword: "beatles" (partial, in the artist)
await h.evaluate(() => new Promise((r) => chrome.storage.local.set({
  hlEnabled: true, hlAutoMarkOpened: true, hlAutoMarkMode: "on-open-not-completed",
  openedSongs: ["song one — artist one"],
  openedKeywords: ["beatles", "yesterday"],
}, r)));
await h.evaluate(() => {
  document.body.innerHTML = "";
  const mkCard = (id, title, artist) => {
    const card = document.createElement("div");
    card.id = id; card.style.cssText = "height:80px;display:flex;align-items:center;border:1px solid #ccc;margin:6px";
    const meta = document.createElement("div"); meta.className = "r-dd0y9b";
    const t = document.createElement("div"); t.className = "r-1inkyih r-1kfrs79"; t.textContent = title;
    const a = document.createElement("div"); a.className = "r-a023e6"; a.textContent = artist;
    meta.append(t, a); card.appendChild(meta); document.body.appendChild(card);
  };
  mkCard("exact", "Song One", "Artist One");             // exact match (openedSongs)
  mkCard("kwArtist", "Come Together", "The Beatles");    // keyword "beatles" in the artist
  mkCard("kwTitle", "Yesterday", "Paul McCartney");      // keyword "yesterday" in the title
  mkCard("none", "Random Song", "Someone Else");         // matches nothing
});
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-shortcuts.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/i18n-strings.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-i18n.js` });
await h.addScriptTag({ url: `chrome-extension://${extId}/mxm-core.js` });
await h.evaluate(() => { window.MXMButtons = { showToast() {} }; });
await h.addScriptTag({ url: `chrome-extension://${extId}/highlighter.js` });
await h.waitForTimeout(800);

const res = await h.evaluate(() => ({
  exact: document.getElementById("exact").hasAttribute("data-mxm-opened"),
  kwArtist: document.getElementById("kwArtist").hasAttribute("data-mxm-opened"),
  kwTitle: document.getElementById("kwTitle").hasAttribute("data-mxm-opened"),
  none: document.getElementById("none").hasAttribute("data-mxm-opened"),
}));
ok(res.exact === true, "exact match (openedSongs) still marks");
ok(res.kwArtist === true, "keyword 'beatles' marks the card via the artist");
ok(res.kwTitle === true, "keyword 'yesterday' marks the card via the title");
ok(res.none === false, "a card with no match is NOT marked");
ok(errs.length === 0, "zero errors → " + (errs.join(" | ") || "none"));

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
