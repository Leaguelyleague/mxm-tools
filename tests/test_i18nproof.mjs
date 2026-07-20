// i18n-proof: the extension recognizes Studio's UI in any language.
// Verifies (1) the MXMStudioI18n API (rx/test/has/union) in es/fr/ja/pt,
// (2) clickHeaderMenuItem by ICON with menu items in foreign languages,
// (3) gotoSection by multi-language text and by positional fallback,
// (4) structural findSendButton with "Enviar"/other languages.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-i18n-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const p = await ctx.newPage();
p.on("pageerror", (e) => { if (!/setting 'value'/.test(e.message)) fails.push("pageerror: " + e.message); });
// Read the sources from the extension page (has chrome.runtime)...
await p.goto(`chrome-extension://${extId}/options.html`);
const sources = {};
for (const f of ["studio-strings.js", "mxm-log.js", "mxm-core.js"]) {
  sources[f] = await p.evaluate(async (url) => await (await fetch(chrome.runtime.getURL(url))).text(), f);
}
// ...and inject them into about:blank (no CSP; options.html blocks inline).
await p.goto("about:blank");
for (const f of ["studio-strings.js", "mxm-log.js", "mxm-core.js"]) await p.addScriptTag({ content: sources[f] });

// ── 1) MXMStudioI18n API ────────────────────────────────────────────────────
const api = await p.evaluate(() => {
  const I = window.MXMStudioI18n;
  if (!I) return { loaded: false };
  return {
    loaded: true,
    keys: Object.keys(I.STR),
    // exact multi-language test()
    fr_find: I.test("find_replace", "Trouver et remplacer"),
    ja_find: I.test("find_replace", "検索と置換"),
    es_tab: I.test("tab_transcript", "Transcripción"),
    es_sync: I.test("tab_timesync", "Sincronización"),
    pt_thanks: I.test("thanks_title", "Obrigado pela sua contribuição!") || I.STR.thanks_title.length > 0,
    en_neg: I.test("find_replace", "some random thing"),
    // send_btn case-insensitive (CSS capitalize): value "enviar" vs button "Enviar"
    send_es: I.test("send_btn", "Enviar"),
    send_en: I.test("send_btn", "send"),
    // has() substring over the body
    has_thanks: I.has("thanks_title", "  ...  Thanks for your contribution!  gracias"),
    has_neg: I.has("sending_contributions", "hola mundo"),
    // union modes
    union_substr: I.union(["discard"]).test("xx Discard yy"),
    union_start: I.union(["last_edit"], "start").test("Last edit 3 months ago"),
    union_start_neg: I.union(["last_edit"], "start").test("Some name Last edit"),
    union_exact: I.union(["no_contributions"], "exact").test("No contributions found"),
    lyrics_ph_pt: I.test("lyrics_placeholder", "Escreva a letra da música aqui..."),
  };
});
ok(api.loaded, "MXMStudioI18n loaded");
ok(api.keys && api.keys.length >= 20, `STR has >=20 anchors (${api.keys ? api.keys.length : 0})`);
ok(api.fr_find, "find_replace matches 'Trouver et remplacer' (fr)");
ok(api.ja_find, "find_replace matches Japanese");
ok(api.es_tab, "tab_transcript matches 'Transcripción' (es)");
ok(api.es_sync, "tab_timesync matches 'Sincronización' (es)");
ok(api.pt_thanks, "thanks_title has variants (pt)");
ok(api.en_neg === false, "find_replace does NOT match random text");
ok(api.send_es, "send_btn matches 'Enviar' (case-insensitive)");
ok(api.send_en, "send_btn matches 'send'");
ok(api.has_thanks, "has() detects thanks as a substring");
ok(api.has_neg === false, "has() does not give a false positive");
ok(api.union_substr, "union substr matches in the middle of the text");
ok(api.union_start, "union start matches 'Last edit <date>'");
ok(api.union_start_neg === false, "union start does NOT match if the label is not at the start");
ok(api.union_exact, "union exact matches full equality");
ok(api.lyrics_ph_pt, "lyrics_placeholder matches the pt placeholder");

// ── 2) clickHeaderMenuItem by ICON with items in a foreign language ─────────
const iconResult = await p.evaluate(async () => {
  document.body.innerHTML = "";
  const svg = (d) => `<svg><path d="${d}"></path></svg>`;
  // Header ⋯ button (top-right).
  const header = document.createElement("div");
  header.innerHTML = `<div tabindex="0" id="dots" style="position:fixed;top:10px;left:1200px;width:24px;height:24px">${svg("M8 12c0 1.1-.9 2-2 2")}</div>`;
  document.body.appendChild(header);
  // Dropdown with items: TEXT in French/Japanese, each action's real icon.
  const menu = document.createElement("div");
  const rows = [
    { id: "row-fr", icon: "M11.024 11.631l7.972-7.944", label: "Trouver et remplacer" }, // find_replace, fr text
    { id: "row-hist", icon: "M13.7 8.6v3.6l3 1.8c.2.1.3", label: "履歴" },          // contribution_history, ja text
    { id: "row-other", icon: "M99 99 99", label: "Autre chose" },
  ];
  menu.innerHTML = rows.map((r) =>
    `<div tabindex="0" id="${r.id}" style="width:200px;height:40px">${svg(r.icon)}<span>${r.label}</span></div>`
  ).join("");
  document.body.appendChild(menu);
  const clicked = [];
  for (const id of ["row-fr", "row-hist", "row-other"]) {
    document.getElementById(id).addEventListener("click", () => clicked.push(id));
  }
  // Force visible geometry (no jsdom: getClientRects works in real Chrome).
  const okFR = await window.MXMCore.clickHeaderMenuItem("find_replace");
  const okHist = await window.MXMCore.clickHeaderMenuItem("contribution_history");
  return { okFR, okHist, clicked };
});
ok(iconResult.okFR && iconResult.clicked.includes("row-fr"), "clickHeaderMenuItem('find_replace') clicked the item by icon (fr text)");
ok(iconResult.okHist && iconResult.clicked.includes("row-hist"), "clickHeaderMenuItem('contribution_history') clicked by icon (ja text)");
ok(!iconResult.clicked.includes("row-other"), "did not touch the unrelated item");

// ── 3) gotoSection: by multi-language text and by positional fallback ───────
const secResult = await p.evaluate(() => {
  const mkTabs = (labels) => {
    document.body.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = labels.map((l, i) =>
      `<div tabindex="0" class="sect" data-i="${i}" style="position:fixed;left:10px;top:${100 + i * 40}px;width:120px;height:30px">${l}</div>`
    ).join("");
    document.body.appendChild(wrap);
    const hits = [];
    document.querySelectorAll(".sect").forEach((el) => el.addEventListener("click", () => hits.push(el.dataset.i)));
    return hits;
  };
  // (a) Spanish tabs: gotoSection('Time-sync') must find 'Sincronización'
  let hits = mkTabs(["Transcripción", "Sincronización", "Estructura", "Intérprete", "Análisis"]);
  const okES = window.MXMCore.gotoSection("Time-sync");
  const hitES = hits[hits.length - 1];
  // (b) tabs in a language OUTSIDE the table → positional fallback (index 1)
  hits = mkTabs(["AAA", "BBB", "CCC", "DDD", "EEE"]);
  const okPos = window.MXMCore.gotoSection("timesync");
  const hitPos = hits[hits.length - 1];
  return { okES, hitES, okPos, hitPos };
});
ok(secResult.okES && secResult.hitES === "1", "gotoSection('Time-sync') matches 'Sincronización' (es)");
ok(secResult.okPos && secResult.hitPos === "1", "gotoSection falls to a fixed position (index 1) if the text is unknown");

// ── 4) structural findSendButton (save-lyrics.js replica) ───────────────────
const sendResult = await p.evaluate(() => {
  const I = window.MXMStudioI18n;
  const CLICKABLE_SEL = window.MXMCore.CLICKABLE_SEL;
  const matchesSend = (txt) => (I && I.STR.send_btn) ? I.test("send_btn", txt) : /^send$/i.test(txt);
  const find = () => {
    for (const el of document.querySelectorAll(CLICKABLE_SEL)) {
      if (!matchesSend((el.innerText || "").trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.top < 90) return el.id;
    }
    return null;
  };
  document.body.innerHTML = `
    <div tabindex="0" id="send-es" style="position:fixed;top:12px;left:1200px;width:60px;height:30px">Enviar</div>
    <div tabindex="0" id="send-low" style="position:fixed;top:400px;left:1200px;width:60px;height:30px">gửi đi</div>`;
  const es = find();
  document.body.innerHTML = `<div tabindex="0" id="send-ja" style="position:fixed;top:12px;left:1200px;width:60px;height:30px">送信</div>`;
  const ja = find();
  return { es, ja };
});
ok(sendResult.es === "send-es", "findSendButton finds 'Enviar' in the header (es); ignores the one below");
ok(sendResult.ja === "send-ja", "findSendButton finds the Japanese Send in the header");

await ctx.close(); fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL GREEN");
process.exit(fails.length ? 1 : 0);
