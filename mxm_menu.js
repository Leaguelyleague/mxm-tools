// mxm_menu.js — Integration with Musixmatch Studio (The Jukebox).
// RIGHT-click on a card's ⋯ (three dots): a CONFIGURABLE action, reading that
// card's title+artist. A single handler, routed by the `dotsRightClickAction`
// option (storage.local, default "highlight"):
//   "none"      → does nothing (native browser menu).
//   "highlight" → marks/unmarks the song as "opened" (openedSongs); requires the
//                 marking master (hlAutoMarkOpened) to be on.
//   "gem"       → triggers "Song → Gem" directly (without opening the menu);
//                 requires the Gem feature master (songToGemEnabled) to be on.
// Right-clicking the REST of the card does nothing: only the ⋯ act.
//
// RISK: depends on musixmatch.com's DOM. Selectors centralized at the top.

(() => {
  if (window.__song2gemMxm) return;
  window.__song2gemMxm = true;

  const core = window.MXMCore;
  // Card selectors + the ⋯ tolerance list come from mxm-core (single source, so
  // this copy and highlighter.js's cannot drift apart, and the ⋯ path matching
  // keeps the redeploy tolerance of DOTS_PATH_PREFIXES).
  const { CARD_TITLE_SEL: TITLE_SEL, CARD_META_SEL: META_SEL, CARD_ARTIST_SEL: ARTIST_SEL, CLICKABLE_SEL: CLICKABLE, DOTS_PATH_PREFIXES } = core;
  const DOTS_MAX_PX = 56; // the three-dots button is small; the card is large

  let dotsAction = "highlight"; // "none" | "highlight" | "gem"
  let gemMasterOn = true;       // songToGemEnabled (Gem feature master)
  let autoMarkOn = true;        // hlAutoMarkOpened (opened-songs marking master), default ON

  chrome.storage.local.get(
    { dotsRightClickAction: "highlight", songToGemEnabled: true, hlAutoMarkOpened: true },
    (s) => {
      dotsAction = s.dotsRightClickAction || "highlight";
      gemMasterOn = s.songToGemEnabled !== false;
      autoMarkOn = s.hlAutoMarkOpened !== false;
    }
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.dotsRightClickAction) dotsAction = changes.dotsRightClickAction.newValue || "highlight";
    if (changes.songToGemEnabled) gemMasterOn = changes.songToGemEnabled.newValue !== false;
    if (changes.hlAutoMarkOpened) autoMarkOn = changes.hlAutoMarkOpened.newValue !== false;
  });

  // ---- RIGHT-click on the ⋯ = configurable action --------------------------
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (dotsAction === "none") return; // native menu, do not touch anything
      const dots = findDotsButton(e.target);
      if (!dots) return; // did not land on the ⋯ -> normal native menu
      const task = extractTask(dots);
      if (!task) return; // no readable card (e.g. the editor header's ⋯)

      if (dotsAction === "gem") {
        if (!gemMasterOn) return; // Gem turned off at its master
        e.preventDefault();
        e.stopPropagation();
        const query = `${task.title} ${task.artist}`.trim();
        chrome.runtime.sendMessage({ type: "RUN_QUERY", query });
        flashDots(dots); // visual confirmation (the Gem may open in the background)
        return;
      }

      // "highlight": mark/unmark the song as opened. NO preventDefault (the
      // native menu still appears). Requires the marking master to be on
      // (otherwise it would be an invisible toggle).
      if (!autoMarkOn) return;
      const ui = window.MXMButtons;
      const tr = (k, p) => window.MXMI18n.t(k, p);
      const key = core.songKey(task.title, task.artist);
      chrome.storage.local.get({ openedSongs: [] }, (d) => {
        const arr = Array.isArray(d.openedSongs) ? d.openedSongs : [];
        const i = arr.indexOf(key);
        if (i === -1) arr.push(key); else arr.splice(i, 1);
        chrome.storage.local.set({ openedSongs: arr });
        if (ui) ui.showToast(null, tr(i === -1 ? "toast.hlMarked" : "toast.hlUnmarked", { song: task.title }));
      });
      flashDots(dots);
    },
    true
  );

  // Brief outline on the button to confirm the right-click fired.
  function flashDots(el) {
    try {
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = "2px solid #3F8456";
      el.style.outlineOffset = "2px";
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
      }, 500);
    } catch (_) {}
  }

  // Returns the three-dots button ONLY if the click landed on it. Walks up from
  // e.target (never searches down into the subtree): so clicking anywhere else
  // on the card does NOT match. The size gate (≤56px) discards large containers
  // that hold the dots in some descendant.
  const matchesDots = (d) => DOTS_PATH_PREFIXES.some((prefix) => (d || "").startsWith(prefix));
  function findDotsButton(target) {
    let el = target instanceof Element ? target : null;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      // The element itself is the three-dots <path>.
      if (el.matches?.("path[d]") && matchesDots(el.getAttribute("d"))) {
        return el.closest(CLICKABLE) || el.closest("svg") || el;
      }
      // The element is a SMALL container whose icon is the three-dots one.
      const r = el.getBoundingClientRect?.();
      if (r && r.width > 0 && r.width <= DOTS_MAX_PX && r.height <= DOTS_MAX_PX) {
        const p = el.querySelector?.("path[d]");
        if (p && matchesDots(p.getAttribute("d"))) return el;
      }
    }
    return null;
  }

  function extractTask(fromEl) {
    // Walk up to the card that contains the title.
    let card = fromEl;
    for (let i = 0; card && i < 14; i++, card = card.parentElement) {
      if (card.querySelector?.(TITLE_SEL)) break;
    }
    if (!card) return null;
    const meta = card.querySelector(META_SEL) || card;
    const titleEl = meta.querySelector(TITLE_SEL);
    const artistEl = meta.querySelector(ARTIST_SEL);
    const title = titleEl ? titleEl.textContent.trim() : "";
    const artist = artistEl ? artistEl.textContent.trim() : "";
    return title ? { title, artist } : null;
  }
})();
