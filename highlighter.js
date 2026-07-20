// =============================================================================
// highlighter.js — HighlightThis-style highlighter (Musixmatch only).
//
// Two subsystems:
//  A) MANUAL HIGHLIGHTING with a single fixed internal list: you select text and
//     apply it from the "Highlighter MxM Tools" context menu (MXM_HL_APPLY
//     message from the background). The phrase is saved and ALL of its
//     occurrences on the page are re-highlighted (HighlightThis model).
//     Persistent across reloads. Does not touch editable fields
//     (textarea/input/contenteditable).
//  B) AUTOMATIC MARKING of already-opened songs: when a task (/tool) opens, its
//     song is recorded; in a mission's list, the cards of already-opened songs
//     get marked (border + opacity). Configurable (on/off + mode).
//
// Storage.local: hlEnabled, hlPhrases (only the HL_LIST key), hlAutoMarkOpened,
//                hlAutoMarkMode, hlAutoMarkColor, openedSongs.
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTHighlighter) return;
  window.__mxmSTHighlighter = true;

  const core = window.MXMCore;
  const ui = window.MXMButtons;
  const t = (k, p) => window.MXMI18n.t(k, p);

  const MARK_CLASS = "mxm-hl";
  // Single source in mxm-core (so this copy and mxm_menu.js's cannot drift).
  const { CARD_TITLE_SEL, CARD_META_SEL, CARD_ARTIST_SEL } = core;

  // The only manual-highlight list: same id as the old list 1, so phrases
  // already saved in hlPhrases.l1 keep working.
  const HL_LIST = { id: "l1", color: "#fff3a3" };

  // ── In-memory state (hydrated from storage) ─────────────────────────────────
  let hlEnabled = true;
  let hlPhrases = {};
  let autoMarkOn = true; // marking master, ON by default
  let autoMarkMode = "on-open-not-completed"; // on-open | on-open-not-completed (default)
  let autoMarkColor = "#b9f0cd"; // pastel green (matching the extension's accent)
  let openedSongs = [];       // auto (exact match by songKey)
  let openedKeywords = [];    // manual (keywords; substring over "title + artist")

  function loadState(cb) {
    chrome.storage.local.get(
      ["hlEnabled", "hlPhrases", "hlAutoMarkOpened", "hlAutoMarkMode", "hlAutoMarkColor", "openedSongs", "openedKeywords"],
      (d) => {
        hlEnabled = d.hlEnabled !== false;
        hlPhrases = d.hlPhrases || {};
        autoMarkOn = d.hlAutoMarkOpened !== false; // default ON
        autoMarkMode = d.hlAutoMarkMode || "on-open-not-completed";
        autoMarkColor = d.hlAutoMarkColor || "#b9f0cd";
        openedSongs = Array.isArray(d.openedSongs) ? d.openedSongs : [];
        openedKeywords = Array.isArray(d.openedKeywords) ? d.openedKeywords : [];
        if (cb) cb();
      }
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.hlEnabled || changes.hlPhrases) {
      loadState(() => { reHighlight(); });
    }
    if (changes.hlAutoMarkOpened || changes.hlAutoMarkMode || changes.hlAutoMarkColor || changes.openedSongs || changes.openedKeywords) {
      loadState(() => { markCards(); });
    }
  });

  // ── A) List highlighting ────────────────────────────────────────────────────
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function unwrapAll() {
    document.querySelectorAll("." + MARK_CLASS).forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
  }

  function buildEntries() {
    const entries = [];
    for (const ph of hlPhrases[HL_LIST.id] || []) {
      const s = (ph || "").trim();
      if (s) entries.push({ phrase: s, color: HL_LIST.color });
    }
    // Longer phrases first (so they win in the regex alternation).
    entries.sort((a, b) => b.phrase.length - a.phrase.length);
    return entries;
  }

  function shouldSkip(node) {
    const p = node.parentElement;
    if (!p) return true;
    if (p.closest("." + MARK_CLASS + ", script, style, textarea, input, [contenteditable='true'], #mxm-st-buttons-host")) return true;
    return false;
  }

  // Readable font color based on the highlight background: in dark mode the
  // page text is white and was unreadable over a light highlight. Returns black
  // or white based on the chosen color's luminance, independent of the theme.
  function contrastText(bg) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((bg || "").trim());
    if (!m) return "#000";
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#000" : "#fff";
  }

  function reHighlight() {
    unwrapAll();
    if (!hlEnabled) return;
    const entries = buildEntries();
    if (!entries.length) return;
    const re = new RegExp(entries.map((e) => escapeRe(e.phrase)).join("|"), "gi");
    const colorOf = {};
    for (const e of entries) colorOf[e.phrase.toLowerCase()] = e.color;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    for (const node of targets) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement("span");
        span.className = MARK_CLASS;
        const bg = colorOf[m[0].toLowerCase()] || "#fff3a3";
        span.style.backgroundColor = bg;
        // readable color over the background (important: in case MxM forces the text color).
        span.style.setProperty("color", contrastText(bg), "important");
        span.style.borderRadius = "2px";
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++; // anti-loop guard
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // Toggles the current selection in the fixed list and re-highlights: if the
  // phrase was already there, it removes it (un-highlight); otherwise it adds
  // it. textOverride comes from the browser context menu, in case the live
  // selection was already lost.
  function applySelection(textOverride) {
    const text = (textOverride || (window.getSelection() ? window.getSelection().toString() : "")).trim();
    if (!text) { ui.showToast(null, t("toast.hlNoSelection")); return; }
    const arr = hlPhrases[HL_LIST.id] || [];
    const i = arr.findIndex((p) => p.toLowerCase() === text.toLowerCase());
    if (i === -1) arr.push(text); else arr.splice(i, 1);
    hlPhrases[HL_LIST.id] = arr;
    chrome.storage.local.set({ hlPhrases }, () => {
      reHighlight();
      if (i === -1) ui.showToast(null, t("toast.hlAdded", { name: "Highlighter" }));
    });
  }

  // Trigger from the context menu (background): apply/remove the selection.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "MXM_HL_APPLY") applySelection(msg.text);
  });

  // ── B) Automatic marking of already-opened songs ────────────────────────────
  let curOpenKey = null;
  let curCompleted = false;

  function addOpenedSong(key) {
    if (!key || openedSongs.includes(key)) return;
    openedSongs.push(key);
    chrome.storage.local.set({ openedSongs });
  }

  // Detects the send/thanks banner (task completed). 300ms throttle:
  // document.body.textContent serializes the WHOLE document (including the full
  // lyrics) — without this it ran on every keystroke. Early-exit BEFORE
  // scheduling the timeout (costs nothing outside an open task) and again inside
  // (the state may have changed during the wait).
  let completionTimer = null;
  const completionObserver = new MutationObserver(() => {
    if (!curOpenKey || curCompleted || completionTimer) return;
    completionTimer = setTimeout(() => {
      completionTimer = null;
      if (!curOpenKey || curCompleted) return;
      const body = document.body.textContent || "";
      const i18n = window.MXMStudioI18n;
      const done = i18n
        ? (i18n.has("sending_contributions", body) || i18n.has("thanks_title", body))
        : /sending your contributions|thank you/i.test(body);
      if (done) curCompleted = true;
    }, 300);
  });

  // The song's DOM mounts with a delay in the SPA: if we read getSongInfo at the
  // instant of the URL change it comes back empty and the mark ends up
  // wrong/absent. We wait for the real title to be available before computing
  // the key and marking; the gen prevents clobbering if navigation is fast.
  let enterGen = 0;
  async function onEnterEditor() {
    const gen = ++enterGen;
    curCompleted = false;
    curOpenKey = null;
    const info = await core.waitFor(() => {
      const { song, artist } = core.getSongInfo();
      return song && song !== "Sin titulo" ? { song, artist } : null;
    }, 8000) || core.getSongInfo();
    if (gen !== enterGen) return; // navigated to another task while we waited
    curOpenKey = core.songKey(info.song, info.artist);
    if (autoMarkMode === "on-open") { addOpenedSong(curOpenKey); markCards(); }
  }

  function onLeaveEditor() {
    if (autoMarkMode === "on-open-not-completed" && curOpenKey && !curCompleted) {
      addOpenedSong(curOpenKey);
    }
    curOpenKey = null;
    curCompleted = false;
  }

  // Walks up from a node to the song CARD (the container with META). Guards
  // against the "gray screen" bug (with a single task in the list): if within
  // `max` levels no ancestor with META appears, or the candidate is a huge
  // container (the whole list/page, not a card), it returns null instead of
  // leaving the loop's last ancestor — previously that leftover got painted with
  // opacity and grayed out the whole screen.
  function findCard(fromEl, max) {
    let el = fromEl instanceof Element ? fromEl : null;
    for (let i = 0; el && i < max; i++, el = el.parentElement) {
      if (el.querySelector?.(CARD_META_SEL)) {
        const r = el.getBoundingClientRect();
        // a card is a short row; a list/page container is tall
        if (r.height === 0 || r.height > 260) return null;
        return el;
      }
    }
    return null; // no META in sight → not a card, mark nothing
  }

  // Normalizes free text the same way core.songKey normalizes each field (for
  // the keyword match: lowercase, no accents, non-alphanumerics → space).
  function normText(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  // Marks the list cards whose songs were already opened (auto: exact match by
  // songKey) or that contain some manual keyword (substring over the normalized
  // "title + artist").
  function markCards() {
    // Clear previous marks.
    document.querySelectorAll("[data-mxm-opened]").forEach((el) => {
      el.style.borderLeft = "";
      el.style.opacity = "";
      el.removeAttribute("data-mxm-opened");
    });
    if (!autoMarkOn || core.isTaskEditorPage()) return;
    const set = new Set(openedSongs);
    const keywords = openedKeywords.map(normText).filter(Boolean);
    document.querySelectorAll(CARD_TITLE_SEL).forEach((titleEl) => {
      const card = findCard(titleEl, 8);
      if (!card) return;
      const meta = card.querySelector(CARD_META_SEL) || card;
      const title = (meta.querySelector(CARD_TITLE_SEL)?.textContent || "").trim();
      const artist = (meta.querySelector(CARD_ARTIST_SEL)?.textContent || "").trim();
      const hay = normText(title + " " + artist);
      const marked = set.has(core.songKey(title, artist)) || keywords.some((k) => hay.includes(k));
      if (marked) {
        card.style.borderLeft = "4px solid " + autoMarkColor;
        card.style.opacity = "0.55";
        card.setAttribute("data-mxm-opened", "1");
      }
    });
  }

  // Right-click on the cards is now handled by mxm_menu.js (configurable action
  // on the ⋯). There is no longer a card listener here.

  // ── SPA lifecycle ───────────────────────────────────────────────────────────
  let onEditor = core.isTaskEditorPage();
  function onUrlChange() {
    const nowEditor = core.isTaskEditorPage();
    if (nowEditor && !onEditor) onEnterEditor();
    if (!nowEditor && onEditor) onLeaveEditor();
    onEditor = nowEditor;
    reHighlight();
    markCards();
  }

  // Re-apply on DOM changes (SPA), with debounce.
  let debTimer = null;
  function scheduleReapply() {
    if (debTimer) clearTimeout(debTimer);
    debTimer = setTimeout(() => { reHighlight(); markCards(); }, 400);
  }

  loadState(() => {
    if (onEditor) onEnterEditor();
    completionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    new MutationObserver(scheduleReapply).observe(document.body, { childList: true, subtree: true });
    reHighlight();
    markCards();
  });

  // SPA: re-evaluate on URL change (single dispatcher in mxm-core).
  core.onNavigate(onUrlChange);
})();
