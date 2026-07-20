// background.js — Service worker (MV3, ES module).
// Brings together: the "Song → Gem" pipeline, the openTab handler (with
// per-button background support) and the handlers for the YouTube (top video)
// and Google floating buttons.
import { searchYouTube, scoreCandidates } from "./youtube.js";

// Diagnostic-log gate, local to this file: the service worker has no `window`,
// so it cannot share mxm-log.js (meant for content scripts). Same storage.local
// "debugLogs" flag (default OFF, enabled by hand from the console). The
// console.error/console.warn of notifyTab (below) are left OUT on purpose: they
// are real problems / the only user-facing channel in that flow, not internal
// diagnostics.
let debugOn = false;
chrome.storage.local.get(["debugLogs"], (d) => { debugOn = d.debugLogs === true; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debugLogs) debugOn = changes.debugLogs.newValue === true;
});
const dlog = (...args) => { if (debugOn) console.log(...args); };
const dwarn = (...args) => { if (debugOn) console.warn(...args); };

// ═══════════════════════════════════════════════════════════════════════════
//  Song → Gem
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  gem_url: "",
  ui_mode: "overlay", // overlay | off
  yt_method: "http", // http (fast fetch) | browser (opens the page and searches by hand)
  auto_always: false,
  auto_threshold: 65,
  message_template: "{url}",
  num_candidates: 5,
  load_delay_ms: 3000, // wait for the Gem page to load before typing/sending
  open_in_background: true, // open the tabs (Gem/YouTube) in the background
};

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

// Master toggle (popup): turns the WHOLE feature on/off. Lives in storage.local
// (same pattern as the rest of the popup toggles). Default: on.
async function isGemEnabled() {
  const { songToGemEnabled } = await chrome.storage.local.get("songToGemEnabled");
  return songToGemEnabled !== false;
}

// YouTube search tabs ("browser" method) with a pending candidate overlay: they
// close when the user picks a candidate or dismisses the overlay.
const ytSearchTabs = new Set();

function removeYtTab(tabId) {
  if (tabId == null) return;
  ytSearchTabs.delete(tabId);
  chrome.tabs.remove(tabId).catch(() => {});
}

function closeIfYtSearchTab(tabId) {
  if (tabId != null && ytSearchTabs.has(tabId)) removeYtTab(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => ytSearchTabs.delete(tabId));

// ---- Feature context menu ------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  // The right-click-on-selection menu has ONLY "Highlighter MxM Tools" (the
  // "🎵 Song → Gem" item was removed; Song→Gem stays via ⌥G and the card's ⋯).
  rebuildHlMenu();

  // Cleanup: on install/update AND every day from here on (alarm).
  cleanupOldEntries();
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 24 * 60 });
});

chrome.runtime.onStartup.addListener(() => { rebuildHlMenu(); });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Single "Highlighter MxM Tools" item: sends the selection to the tab so
  // highlighter.js highlights/un-highlights it (toggle).
  if (info.menuItemId === MENU_HL_ITEM) {
    if (tab && tab.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: "MXM_HL_APPLY", text: info.selectionText || "" });
    }
    return;
  }
});

// Show/hide the highlighter item instantly based on its on/off.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.hlEnabled) rebuildHlMenu();
});

// ── The "Highlighter MxM Tools" item (right-click on a selection) ──────────────
// No list system: a single item, a fixed product name in every language.
const MENU_HL_ITEM = "hl_add_parent";
async function rebuildHlMenu() {
  await new Promise((r) => chrome.contextMenus.remove(MENU_HL_ITEM, () => { void chrome.runtime.lastError; r(); }));
  const d = await chrome.storage.local.get(["hlEnabled"]);
  if (d.hlEnabled === false) return; // highlighter off → no item
  chrome.contextMenus.create({
    id: MENU_HL_ITEM, title: "Highlighter MxM Tools",
    contexts: ["selection"], documentUrlPatterns: ["https://*.musixmatch.com/*"],
  });
}

// ---- Main flow -------------------------------------------------------

async function handleSelection(query, tab, bgOverride) {
  const settings = await getSettings();
  // Per-button foreground/background override: if the button that triggered the
  // transcriber carries its own config, it overrides the global open_in_background.
  if (bgOverride != null) settings.open_in_background = bgOverride;
  if (!settings.gem_url) {
    notifyTab(tab, "Configurá la URL de tu Gem en las opciones de la extensión.");
    chrome.runtime.openOptionsPage();
    return;
  }

  let scored;
  let ytTabId = null;
  try {
    let candidates;
    if (settings.yt_method === "browser") {
      const r = await searchYouTubeBrowser(query, settings.num_candidates,
                                           settings.open_in_background);
      candidates = r.candidates;
      ytTabId = r.tabId;
    } else {
      candidates = await searchYouTube(query, settings.num_candidates);
    }
    if (!candidates.length) {
      notifyTab(tab, `Sin resultados en YouTube para “${query}”.`);
      removeYtTab(ytTabId);
      return;
    }
    scored = scoreCandidates(query, candidates);
  } catch (e) {
    console.error("[Song→Gem] search failed:", e);
    notifyTab(tab, "Error buscando en YouTube: " + e.message);
    return; // searchYouTubeBrowser already closed its tab if it failed
  }

  const top = scored[0];
  const auto =
    settings.auto_always ||
    settings.ui_mode === "off" ||
    top.score >= settings.auto_threshold;

  if (auto) {
    await sendToGem(top, query, settings);
    removeYtTab(ytTabId);
    return;
  }

  // ui_mode === "overlay": if we search via the browser, the overlay goes OVER
  // the YouTube tab (results in view); otherwise, over the original page.
  if (ytTabId != null) {
    ytSearchTabs.add(ytTabId);
    try {
      await chrome.tabs.update(ytTabId, { active: true });
    } catch (_) {}
    await showOverlay({ id: ytTabId }, query, scored);
  } else {
    await showOverlay(tab, query, scored);
  }
}

async function showOverlay(tab, query, candidates) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["overlay.css"] });
    // overlay.js uses MXMI18n — unlike the manifest's declarative content
    // scripts, this one is injected ON DEMAND into whatever tab (which may be a
    // YouTube tab that has neither loaded), so they must ALWAYS be brought in
    // first. Idempotent on pages that already have them (mxm-i18n.js guards
    // itself; i18n-strings-content.js reassigns the same dictionary, no effect).
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["i18n-strings-content.js", "mxm-i18n.js", "overlay.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "SHOW_CANDIDATES", query, candidates });
  } catch (e) {
    console.error("[Song→Gem] could not inject the overlay:", e);
    notifyTab(tab, "No se pudo mostrar el selector en esta página.");
  }
}

// ---- "By hand" search on the real YouTube page -----------------------

async function searchYouTubeBrowser(query, limit, background) {
  const tab = await chrome.tabs.create({ url: "https://www.youtube.com/", active: !background });
  try {
    await waitForTabComplete(tab.id);
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ytInPageSearch,
      args: [query, limit],
    });
    // The tab is left OPEN on purpose: the caller shows the overlay over it and
    // closes it on pick/dismiss (or immediately if automatic).
    return { candidates: (res && res.result) || [], tabId: tab.id };
  } catch (e) {
    chrome.tabs.remove(tab.id).catch(() => {});
    throw e;
  }
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) return;
      if (t && t.status === "complete") finish();
    });
    setTimeout(finish, timeoutMs);
  });
}

// Runs INSIDE the YouTube tab (serialized and injected). No closures: it only
// uses the page's globals. YouTube is an SPA: pasting and submitting navigates
// without reloading, so the same script sees the results appear.
async function ytInPageSearch(query, limit) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const findBox = () =>
    document.querySelector("input#search") ||
    document.querySelector("ytd-searchbox input") ||
    document.querySelector("input[name='search_query']");

  let box = null;
  for (let i = 0; i < 40 && !box; i++) {
    box = findBox();
    if (!box) await sleep(250);
  }
  if (!box) return [];

  box.focus();
  box.value = "";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(rnd(200, 500));

  // Paste the text all at once (not character by character), without opening any video.
  box.value = query;
  box.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: query })
  );
  await sleep(rnd(300, 700));

  box.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Enter", keyCode: 13, which: 13 })
  );
  const btn =
    document.querySelector("button#search-icon-legacy") ||
    document.querySelector("#search-icon-legacy");
  if (btn) btn.click();

  let found = false;
  for (let i = 0; i < 40; i++) {
    if (document.querySelector("ytd-video-renderer")) {
      found = true;
      break;
    }
    await sleep(300);
  }
  if (!found) return [];
  await sleep(rnd(400, 900));
  window.scrollBy(0, 200 + Math.random() * 400); // slight scroll, without clicking anything
  await sleep(rnd(200, 500));

  const out = [];
  const seen = new Set();
  const nodes = document.querySelectorAll("ytd-video-renderer, ytd-rich-item-renderer");
  for (const n of nodes) {
    const a = n.querySelector("a#video-title, a#video-title-link");
    if (!a) continue;
    const href = a.href || "";
    const m = href.match(/[?&]v=([\w-]{11})/);
    if (!m) continue;
    const videoId = m[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const title = (a.getAttribute("title") || a.textContent || "").trim();
    const chEl = n.querySelector("ytd-channel-name a, #channel-name a, ytd-channel-name #text");
    const channel = chEl ? (chEl.textContent || "").trim() : "";
    const dEl = n.querySelector(
      "ytd-thumbnail-overlay-time-status-renderer #text, #time-status #text"
    );
    const duration = dEl ? (dEl.textContent || "").trim() : "";
    out.push({
      videoId,
      title,
      channel,
      duration,
      thumbnail: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      url: "https://www.youtube.com/watch?v=" + videoId,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---- Send to the Gem ----------------------------------------------------------

async function sendToGem(candidate, query, settings) {
  const message = settings.message_template
    .replaceAll("{url}", candidate.url)
    .replaceAll("{query}", query)
    .replaceAll("{title}", candidate.title);
  const gemTab = await chrome.tabs.create({
    url: settings.gem_url,
    active: !settings.open_in_background,
  });
  // The content script (gemini-inject.js) will request this payload when ready.
  await chrome.storage.session.set({
    ["gemPayload_" + gemTab.id]: {
      message,
      delay: settings.load_delay_ms,
      duration: candidate.duration || "",
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Floating buttons: YouTube (top video) and Google
// ═══════════════════════════════════════════════════════════════════════════

// Searches with the existing pipeline and opens the best-scoring video. If the
// search fails or there are no candidates, it falls back to the results page
// (never leave the user with nothing). `background` comes from the per-button config.
async function openTopYouTube(query, background) {
  const resultsUrl =
    "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
  try {
    const candidates = await searchYouTube(query, 5);
    if (!candidates.length) {
      await chrome.tabs.create({ url: resultsUrl, active: !background });
      return { fallback: true };
    }
    const scored = scoreCandidates(query, candidates);
    await chrome.tabs.create({ url: scored[0].url, active: !background });
    return { ok: true, url: scored[0].url };
  } catch (e) {
    console.error("[MxM ST] button's YouTube search failed:", e);
    await chrome.tabs.create({ url: resultsUrl, active: !background });
    return { error: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Messaging
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHOOSE") {
    getSettings().then((settings) => sendToGem(msg.candidate, msg.query || "", settings));
    closeIfYtSearchTab(sender.tab && sender.tab.id);
    return false;
  }
  if (msg.type === "OPEN_YOUTUBE_SEARCH") {
    const q = (msg.query || "").trim();
    if (q) {
      getSettings().then((settings) => {
        chrome.tabs.create({
          url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q),
          active: !settings.open_in_background,
        });
      });
    }
    return false;
  }
  if (msg.type === "OVERLAY_DISMISSED") {
    const sid = sender.tab && sender.tab.id;
    if (sid != null) ytSearchTabs.delete(sid);
    return false;
  }
  if (msg.type === "RUN_QUERY") {
    const query = (msg.query || "").trim();
    if (query && sender.tab) {
      isGemEnabled().then((on) => {
        if (on) handleSelection(query, sender.tab, msg.background);
      });
    }
    return false;
  }
  // Lyrics review with the Gem: opens the transcription Gem with a per-tab
  // payload kind:"review" (gemini-inject pastes the lyrics, sends, waits for the
  // correction and copies it to the clipboard). It respects the button's
  // background flag (default background). If it opens in the background, the
  // clipboard requires focus → gemini-inject copies as soon as the tab is focused.
  if (msg.type === "RUN_REVIEW") {
    const message = (msg.message || "").trim();
    if (!message) { sendResponse({ ok: false }); return false; }
    getSettings().then(async (settings) => {
      if (!settings.gem_url) { sendResponse({ ok: false, reason: "noGemUrl" }); return; }
      const gemTab = await chrome.tabs.create({ url: settings.gem_url, active: !msg.background });
      await chrome.storage.session.set({
        ["gemPayload_" + gemTab.id]: { kind: "review", message, delay: settings.load_delay_ms },
      });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "GEM_READY") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse(null);
      return false;
    }
    const key = "gemPayload_" + tabId;
    chrome.storage.session.get(key).then((r) => {
      const payload = r[key];
      if (payload != null) chrome.storage.session.remove(key);
      sendResponse(payload ?? null);
    });
    return true;
  }
  if (msg.type === "OPEN_TOP_YOUTUBE") {
    const q = (msg.query || "").trim();
    if (!q) { sendResponse({ error: true }); return false; }
    openTopYouTube(q, !!msg.background).then(sendResponse);
    return true;
  }
  if (msg.type === "OPEN_GOOGLE_SEARCH") {
    const q = (msg.query || "").trim();
    if (q) {
      chrome.tabs.create({
        url: "https://www.google.com/search?q=" + encodeURIComponent(q),
        active: !msg.background,
      });
    }
    return false;
  }
  if (msg.type === "OPEN_SPOTIFY_SEARCH") {
    const q = (msg.query || "").trim();
    if (q) {
      chrome.tabs.create({
        url: "https://open.spotify.com/search/" + encodeURIComponent(q),
        active: !msg.background,
      });
    }
    return false;
  }
  if (msg.type === "OPEN_APPLE_SEARCH") {
    const q = (msg.query || "").trim();
    if (q) {
      chrome.tabs.create({
        url: "https://music.apple.com/search?term=" + encodeURIComponent(q),
        active: !msg.background,
      });
    }
    return false;
  }
  if (msg.type === "OPEN_AMAZON_SEARCH") {
    const q = (msg.query || "").trim();
    if (q) {
      chrome.tabs.create({
        url: "https://music.amazon.com/search/" + encodeURIComponent(q),
        active: !msg.background,
      });
    }
    return false;
  }
  // Open a tab at a content script's request (e.g. diffchecker.js in the chain
  // flow: window.open without a gesture would be blocked as a popup).
  if (msg.action === "openTab" && msg.url) {
    chrome.tabs.create({ url: msg.url, active: !msg.background });
    return false;
  }
  // Close the requesting tab (diffchecker.js when the Diffgenie flow ends: the
  // diff tab is no longer needed, only the Gem remains).
  if (msg.action === "closeThisTab") {
    if (sender.tab && sender.tab.id !== undefined) chrome.tabs.remove(sender.tab.id);
    return false;
  }
  // Download the lyrics as .txt (save-lyrics.js). No timestamp prefix: the
  // name is "song - artist.txt" and collisions are resolved with conflictAction
  // "uniquify".
  if (msg.action === "download" && msg.filename && typeof msg.text === "string") {
    const safeName = msg.filename.replace(/[/\\:*?"<>|]/g, "_").trim() || "sin_nombre";
    const safeFolder = (msg.folder || "General").replace(/[/\\:*?"<>|]/g, "_").trim() || "General";
    chrome.storage.local.get("savePath", (data) => {
      const basePath = sanitizeSavePath(data.savePath);
      const url = "data:text/plain;charset=utf-8," + encodeURIComponent(msg.text);
      chrome.downloads.download(
        {
          url,
          filename: `${basePath}/${safeFolder}/${safeName}.txt`,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (id) => sendResponse({ success: !chrome.runtime.lastError && id !== undefined })
      );
    });
    return true; // async sendResponse
  }
  return false;
});

// ── Sanitize the save base path ──
// chrome.downloads requires a RELATIVE path under Downloads: no absolute paths,
// drives (C:\) or ".." segments. Returns "LyricsBackups" if it ends up empty.
function sanitizeSavePath(raw) {
  const DEFAULT = "LyricsBackups";
  if (!raw || typeof raw !== "string") return DEFAULT;
  if (raw === "TextosGuardados") return DEFAULT; // migrate the old default
  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.replace(/[:*?"<>|]/g, "_").trim())
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  return cleaned || DEFAULT;
}

// ---- Utility: lightweight notice on the active tab --------------------------

function notifyTab(tab, text) {
  if (!tab || tab.id == null) {
    console.warn("[Song→Gem]", text);
    return;
  }
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      func: (t) => console.warn("[Song→Gem]", t),
      args: [text],
    })
    .catch(() => {});
}

// ---- Limpieza de storage: baselines/metas/dedups viejos ---------------------
// baseline:<taskId> carries ts; meta:<taskId> does not, so it is deleted along
// with its baseline. savedLyric:<songKey> (Save dedup, see save-lyrics.js) also
// carries ts. Without this, storage.local grows unbounded with every task/song
// touched. Runs on install/update AND on a DAILY alarm (the MV3 service worker
// does not live long enough for a real setInterval; chrome.alarms does
// persiste dormido y despierta al SW).
const BASELINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CLEANUP_ALARM = "mxm-daily-cleanup";

async function cleanupOldEntries() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const toRemove = [];
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (key.startsWith("baseline:") && entry && entry.ts && now - entry.ts > BASELINE_MAX_AGE_MS) {
        toRemove.push(key);
        toRemove.push("meta:" + key.slice("baseline:".length));
      } else if (key.startsWith("savedLyric:") && entry && entry.ts && now - entry.ts > BASELINE_MAX_AGE_MS) {
        toRemove.push(key);
      }
    }
    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
      dlog("[MxM ST] limpieza: eliminadas", toRemove.length, "claves viejas");
    }
  } catch (e) {
    dwarn("[MxM ST] storage cleanup failed:", e);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM) cleanupOldEntries();
});
