// =============================================================================
// MxM Tools — Registry of Studio's floating buttons
//
// Defines the floating buttons on window.MXMButtons and decides their visibility:
//   - ONLY in a task's editor (MXMCore.isTaskEditorPage() → /tool).
//     It used to use getTaskId(), which also returned a value in the task LIST.
//   - Per-button toggle in the "floatingButtons" object of storage.local
//     (default: todos activados), reaccionando a chrome.storage.onChanged.
//   - The stack is RECOMPUTED dynamically: enabled ones stack with no gaps
//     (except those the user dragged, which keep their position).
//
// The compare / diffgenie actions live in compare.js (window.MXMCompare).
// It also listens to the MXM_RUN message (trigger from the popup).
// =============================================================================

(function () {
  "use strict";

  if (window.__mxmSTButtonsInjected) return;
  window.__mxmSTButtonsInjected = true;

  const core = window.MXMCore;
  const ui = window.MXMButtons;
  const t = (k, p) => window.MXMI18n.t(k, p);
  const MXMBtnDefs = window.MXMBtnDefs;

  // gemReview prompt: a template configurable in Options ("gemReviewTemplate",
  // un template configurable en Opciones avanzadas (storage.sync
  // same pattern as message_template). This is only the net if it were empty
  // (options.js no longer allows saving it empty). The text stays Spanish.
  const DEFAULT_REVIEW_TEMPLATE = [
    "Revisá y corregí la siguiente letra ya transcripta según tus instrucciones",
    "(esta vez no hay link de YouTube: la letra va pegada acá).",
    "Devolvé SOLO la letra corregida, sin comentarios.",
    "",
    "Canción: {song} — {artist}",
    "",
    "{lyrics}",
  ].join("\n");

  // ── Iconos ──────────────────────────────────────────────────────────────────
  // All with fill="currentColor": mxm-buttons sets the color per mode
  // (colored uses btn-colors.js's fg; black-and-white forces dark gray).
  // Real (simplified, monochrome) logos for YouTube/Spotify/Apple/Google.
  const copyIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
  const copyCheckIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#2e7d46"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const copyErrorIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#c0392b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  const youtubeIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.58 7.19a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42A2.5 2.5 0 0 0 2.42 7.19 26.2 26.2 0 0 0 2 12c0 1.62.14 3.23.42 4.81a2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 0 0 1.76-1.77c.28-1.58.42-3.19.42-4.81s-.14-3.23-.42-4.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg>`;
  const googleIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 12.23c0-.68-.06-1.36-.19-2.02H12v3.83h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.89-1.74 2.97-4.3 2.97-7.33z"/><path d="M12 21.5c2.7 0 4.96-.9 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 21.5z"/><path d="M6.41 13.41a6 6 0 0 1 0-3.82V7.01H3.07a10 10 0 0 0 0 8.98l3.34-2.58z"/><path d="M12 6.46c1.47 0 2.79.5 3.82 1.5l2.87-2.87A10 10 0 0 0 3.07 7.01l3.34 2.58C7.2 7.23 9.4 6.46 12 6.46z"/></svg>`;
  const spotifyIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.59 14.42a.62.62 0 0 1-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.8-.87 7.08-.5 9.72 1.11.29.18.38.57.21.86zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.49.7.26 1.07zm.11-2.84C14.8 8.85 9.4 8.66 6.3 9.6a.94.94 0 1 1-.54-1.8c3.56-1.08 9.52-.87 13.28 1.36a.94.94 0 0 1-.96 1.62l-.05-.02z"/></svg>`;
  const appleIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.37 12.79c-.03-2.6 2.13-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.95-3.95.95-.81 0-2.07-.92-3.4-.9-1.75.03-3.37 1.02-4.27 2.59-1.82 3.15-.46 7.83 1.31 10.39.87 1.25 1.9 2.66 3.26 2.61 1.3-.05 1.8-.85 3.38-.85 1.58 0 2.02.85 3.4.82 1.4-.03 2.3-1.28 3.16-2.54 1-1.45 1.4-2.86 1.43-2.93-.03-.01-2.74-1.05-2.77-4.19z"/><path d="M14.35 4.72c.72-.87 1.2-2.08 1.07-3.29-1.04.04-2.29.69-3.03 1.56-.67.77-1.25 2-1.1 3.19 1.16.09 2.34-.59 3.06-1.46z"/></svg>`;
  // Diffchecker-style icon: two framed panes with uneven left/right lines =
  // text comparison.
  const compareIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="5.6" y1="8" x2="9.4" y2="8"/><line x1="5.6" y1="11.5" x2="9.4" y2="11.5"/><line x1="5.6" y1="15" x2="8.4" y2="15"/><line x1="14.6" y1="8" x2="18.4" y2="8"/><line x1="14.6" y1="11.5" x2="17.4" y2="11.5"/><line x1="14.6" y1="15" x2="18.4" y2="15"/></svg>`;
  const diffgenieIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 2l1.9 5.6L18.5 9.5l-5.6 1.9L11 17l-1.9-5.6L3.5 9.5l5.6-1.9L11 2z"/><path d="M18.5 13l.95 2.8 2.8.95-2.8.95-.95 2.8-.95-2.8-2.8-.95 2.8-.95.95-2.8z"/></svg>`;
  const contributorIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2.2c-4.2 0-7.6 2.1-7.6 4.8V20a1 1 0 0 0 1 1h13.2a1 1 0 0 0 1-1v-1c0-2.7-3.4-4.8-7.6-4.8z"/></svg>`;
  // Same shape as contributorIcon but EMPTY (outline): used ONLY by the
  // contributor group anchor (not the contributorName member).
  const contributorOutlineIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 20v-1c0-3 3.4-5 7.5-5s7.5 2 7.5 5v1"/></svg>`;
  const findReplaceIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 6a5 5 0 1 0 3.9 8.12l4.49 4.49 1.41-1.41-4.49-4.49A5 5 0 0 0 11 6zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 4h6v2H3V4zm0 4h4v2H3V8zm0 4h4v2H3v-2z"/></svg>`;
  // Gems with a letter in the bottom-right corner to tell them apart:
  // the diamond shrinks and anchors top-left; the "T"/"R" goes bottom-right.
  const gemDiamond = `<g transform="translate(-1,-1) scale(0.82)"><path d="M6 3h12l4 6-10 12L2 9l4-6zm2.7 2L6.2 8.75h11.6L15.3 5H8.7zM7 10.75l5 6.9 5-6.9H7z"/></g>`;
  const gemLetter = (ch) => `<text x="20" y="22.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="10" font-weight="800">${ch}</text>`;
  const gemIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${gemDiamond}${gemLetter("T")}</svg>`;       // transcribir
  const gemReviewIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${gemDiamond}${gemLetter("R")}</svg>`; // reviewer
  // Classic floppy disk.
  // Save lyrics = universal download icon (arrow ↓ + tray); the floppy
  // became the Save-and-Send one.
  const saveIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7z"/><path d="M5 20h14v-2H5v2z"/></svg>`;
  // Floating Save & Send: ONLY the classic floppy, no paper plane (the icon
  // Save lyrics used to use).
  const saveSendIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>`;
  // Amazon Music: the "a" with the logo's smile-arrow, monochrome.
  const amazonIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><text x="12" y="14.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="800">a</text><path d="M5 16.6c4.2 2.8 9.8 2.8 14 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M19 16.9l2.6-.8-.9 2.6z"/></svg>`;
  // Slack: official logo (4-blade pinwheel), monochrome.
  // molinete anterior que quedaba desprolijo).
  // Open on the web: external-link icon → public lyrics page.
  const openWebIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>`;
  // Reset sync: circular reset arrow.
  const resetSyncIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 6V3L7.5 7.5 12 12V8.5a3.5 3.5 0 1 1-3.5 3.5H6a6 6 0 1 0 6-6z"/></svg>`;
  // Group anchors: a PLAIN diamond (no letter) for the gems and a music note
  // (universal music symbol) for the streaming services.
  const gemGroupIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12l4 6-10 12L2 9l4-6zm2.7 2L6.2 8.75h11.6L15.3 5H8.7zM7 10.75l5 6.9 5-6.9H7z"/></svg>`;
  const streamGroupIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l6 1.8v3.02L14 6.6v8.28a3.4 3.4 0 1 1-2-3.09V3z"/></svg>`;
  // Scroll (Lucide "scroll", ISC) — Typeforms group anchor.
  const typeformsIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3a1 1 0 0 0 1 1h3"/></svg>`;
  // Typeform 1-4 members: small scroll + number.
  const tfIcon = (n) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(1.5,1.5) scale(0.66)"><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3a1 1 0 0 0 1 1h3"/></g><text x="17" y="21" text-anchor="middle" stroke="none" fill="currentColor" font-family="-apple-system, sans-serif" font-size="10" font-weight="800">${n}</text></svg>`;
  // Go to the curator's profile: person + exit arrow.
  const profileIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><g transform="translate(-1.5,1.5) scale(0.85)"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2.2c-4.2 0-7.6 2.1-7.6 4.8V20a1 1 0 0 0 1 1h13.2a1 1 0 0 0 1-1v-1c0-2.7-3.4-4.8-7.6-4.8z"/></g><path d="M15.5 3h5.5v5.5h-2V6.41l-4.09 4.09-1.41-1.41L17.59 5H15.5V3z"/></svg>`;

  // Per-button colors: single source in btn-colors.js (pastel bg + icon fg).
  const COLORS = window.MXMBtnColors;

  // ── Per-button "open tab in foreground/background" config (storage.sync) ─
  // Default: BACKGROUND; foreground is opt-in.
  function getTabConfig(key) {
    return new Promise((resolve) => {
      chrome.storage.sync.get("btnTabConfig", (d) => {
        const cfg = (d.btnTabConfig || {})[key] || {};
        resolve({ background: cfg.background !== false });
      });
    });
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  function doCopy(entry) {
    const { song, artist } = core.getSongInfo();
    const text = `${song} - ${artist}`;
    core.copyToClipboard(text).then(
      () => {
        if (entry) ui.setIcon(entry, copyCheckIcon, null, 1500);
        ui.showToast(entry, t("toast.copied", { text }));
      },
      () => {
        if (entry) ui.setIcon(entry, copyErrorIcon, null, 2000);
        ui.showToast(entry, t("toast.copyFailed"));
      }
    );
  }

  async function doYouTube(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    const cfg = await getTabConfig("youtube");
    ui.showToast(entry, t("toast.ytSearching"));
    chrome.runtime.sendMessage(
      { type: "OPEN_TOP_YOUTUBE", query, background: cfg.background },
      (res) => {
        if (res && res.fallback) ui.showToast(entry, t("toast.ytFallback"));
        else if (res && res.error) ui.showToast(entry, t("toast.ytError"));
      }
    );
  }

  async function doGoogle(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    const cfg = await getTabConfig("google");
    chrome.runtime.sendMessage({ type: "OPEN_GOOGLE_SEARCH", query, background: cfg.background });
  }

  async function doSpotify(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    const cfg = await getTabConfig("spotify");
    chrome.runtime.sendMessage({ type: "OPEN_SPOTIFY_SEARCH", query, background: cfg.background });
  }

  async function doAppleMusic(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    const cfg = await getTabConfig("appleMusic");
    chrome.runtime.sendMessage({ type: "OPEN_APPLE_SEARCH", query, background: cfg.background });
  }

  async function doAmazonMusic(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    const cfg = await getTabConfig("amazonMusic");
    chrome.runtime.sendMessage({ type: "OPEN_AMAZON_SEARCH", query, background: cfg.background });
  }

  // Shows the last contributor's name for a few seconds.
  // getLastContributor returns: name | "" (empty history) | null (error).
  // Typeform 2-4: slots not defined yet.
  function doTypeformStub(entry) {
    ui.showToast(entry, t("toast.typeformTodo"), 3500);
  }

  // Go to the curator's profile: the ONLY real path is via the public lyrics
  // page ("open on the web" flow) — there mxm-lyrics.js reads the last
  // contributor's profile from __NEXT_DATA__ and navigates to /profile/<id>.
  // The flag is set BEFORE opening the tab (it may load fast).
  async function doContributorProfile(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return; }
    ui.showToast(entry, t("toast.profileOpening"), 4000);
    chrome.storage.local.set({ goProfilePending: { ts: Date.now() } });
    const res = await core.openTrackPage();
    if (!res.ok) {
      chrome.storage.local.remove("goProfilePending");
      ui.showToast(entry, t("toast.openWebFailed"), 5000);
    }
  }

  async function doContributorName(entry) {
    ui.showToast(entry, t("toast.contributorLoading"), 3000);
    const { name, role } = await core.getLastContributor();
    // Name + role in parentheses: "Someone (Curator)", "Someone else
    // (AI Assistant)", etc. If the role could not be read, just the name.
    const shown = name ? (role ? `${name} (${role})` : name) : null;
    const msg = shown ? t("toast.contributor", { name: shown })
      : name === "" ? t("toast.contributorEmpty")
      : t("toast.contributorNone");
    ui.showToast(entry, msg, 5000);
  }

  // Currently selected text: first from the focused textarea/input (the
  // editor's live selection), then the page's getSelection().
  function currentSelection() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") &&
        typeof el.selectionStart === "number" && el.selectionEnd > el.selectionStart) {
      const s = el.value.substring(el.selectionStart, el.selectionEnd);
      if (s.trim()) return s;
    }
    const w = (window.getSelection && window.getSelection().toString()) || "";
    return w.trim() ? w : "";
  }

  // Sets an input/textarea value so React registers it (native setter +
  // input/change), or a contenteditable as a fallback.
  function setFieldValue(el, value) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const isFieldVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  };
  const findFields = () => Array.from(document.querySelectorAll(
    'input[type="text"], input:not([type]), input[type="search"], textarea, [contenteditable="true"]'
  )).filter(isFieldVisible);

  // Opens the header ⋯ menu and clicks "Find and replace". If there is a
  // selection, it fills BOTH new panel fields (find and replace): the
  // selection is captured BEFORE opening the menu (opening it loses focus) and
  // then all the fields that did NOT exist before the panel are filled. Focus
  // on the 2nd (the "replace" one) to edit the correction right away.
  async function doFindReplace(entry) {
    const sel = currentSelection();
    const before = new Set(findFields());
    const ok = await core.clickHeaderMenuItem("find_replace");
    if (!ok) { ui.showToast(entry, t("toast.menuItemFail")); return; }
    if (!sel) return; // sin selección, solo abre el panel
    const fields = await core.waitFor(() => {
      const nuevos = findFields().filter((el) => !before.has(el));
      return nuevos.length ? nuevos : null;
    }, 2500);
    if (!fields) return; // no encontró campos: el panel igual quedó abierto
    for (const f of fields) setFieldValue(f, sel);
    (fields[1] || fields[0]).focus();
  }

  // Transcriber trigger from the popup: uses the open task's song (the ⌥G
  // shortcut still uses the selection, via gem-shortcut.js).
  async function doGem(entry) {
    const { song, artist } = core.getSongInfo();
    const query = `${song} ${artist}`.trim();
    if (!query) { ui.showToast(entry, t("toast.notTask")); return; }
    const cfg = await getTabConfig("gem"); // open-in-background por botón (lote 4)
    chrome.runtime.sendMessage({ type: "RUN_QUERY", query, background: cfg.background });
    ui.showToast(entry, t("toast.openingGem"));
  }

  // The Gem REVIEWS the Transcript lyrics: it goes to Transcript, reads the
  // full lyrics and sends them to the transcription Gem instead of the YouTube
  // link; gemini-inject waits for the correction and copies it to the clipboard.
  async function doGemReview(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return; }
    if (!core.isOnTranscript()) {
      ui.showToast(entry, t("toast.switchingToLyrics"));
      const ok = await core.ensureTranscript();
      if (!ok) { ui.showToast(entry, t("toast.notTask")); return; }
    }
    const ta = core.getTranscriptTextarea(true) || core.getTranscriptTextarea(false);
    const lyrics = ta && ta.value.trim() ? ta.value : null;
    if (!lyrics) { ui.showToast(entry, t("toast.saveNoLyrics")); return; }
    const { song, artist } = core.getSongInfo();
    const { gemReviewTemplate } = await new Promise((r) => chrome.storage.sync.get("gemReviewTemplate", r));
    const message = (gemReviewTemplate || DEFAULT_REVIEW_TEMPLATE)
      .replaceAll("{song}", song || "")
      .replaceAll("{artist}", artist || "")
      .replaceAll("{lyrics}", lyrics);
    const cfg = await getTabConfig("gemReview"); // open-in-background por botón (lote 4)
    chrome.runtime.sendMessage({ type: "RUN_REVIEW", message, background: cfg.background }, (res) => {
      if (res && res.ok) ui.showToast(entry, t("toast.openingReview"));
      else ui.showToast(entry, t("toast.noGemUrl"));
    });
  }

  // Slack Curators Invitation Request: leaves the request pending and opens
  // the public lyrics page (external Title link in Track info); mxm-lyrics.js
  // extracts the last contributor's profile there and chains the Typeform
  // (slack-form.js fills and sends it).
  // Shared Typeform launcher: the 1st time it asks for name+email and saves
  // them in the browser. The extension, instead, passes them via query params
  // (prefill), so this link is only offered when the Options data is missing.
  const SLACK_LAUNCHER_URL = "https://community-task-manager.replit.app/launch/slack";

  // In-page popup when name/email are missing for the forms. It does NOT
  // autofill anything: it offers to configure them (Options) or fill by hand.
  function slackNeedConfigModal() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    const box = document.createElement("div");
    box.style.cssText = "background:#1f1f1f;color:#fff;max-width:430px;padding:22px 24px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);";
    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:8px;";
    title.textContent = t("slack.needConfig.title");
    const body = document.createElement("div");
    body.style.cssText = "color:#cfcfcf;line-height:1.5;margin-bottom:18px;";
    body.textContent = t("slack.needConfig.body");
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";
    const close = document.createElement("button");
    close.style.cssText = "background:transparent;color:#bbb;border:1px solid #555;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit;";
    close.textContent = t("slack.needConfig.close");
    close.addEventListener("click", () => wrap.remove());
    const manual = document.createElement("button");
    manual.style.cssText = "background:#5677fc;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit;font-weight:600;";
    manual.textContent = t("slack.needConfig.btn");
    manual.addEventListener("click", () => { chrome.runtime.sendMessage({ action: "openTab", url: SLACK_LAUNCHER_URL, background: false }); wrap.remove(); });
    row.append(close, manual);
    box.append(title, body, row);
    wrap.appendChild(box);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  async function doSlackInvite(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return; }
    // Without name+email configured the Typeform cannot be prefilled: ask for
    // them (do not autofill) — resolves the "email step".
    const cfg = await new Promise((r) => chrome.storage.sync.get(["reportName", "reportEmail"], r));
    if (!(cfg.reportName || "").trim() || !(cfg.reportEmail || "").trim()) { slackNeedConfigModal(); return; }
    ui.showToast(entry, t("toast.slackOpening"), 4000);
    // The flag is set BEFORE the click: the lyrics tab may load fast.
    chrome.storage.local.set({ slackInvitePending: { ts: Date.now() } });
    const res = await core.openTrackPage();
    if (!res.ok) {
      chrome.storage.local.remove("slackInvitePending");
      ui.showToast(entry, t("toast.slackFailed"), 5000);
    }
  }

  // Open the task on Musixmatch's public web: opens the Track info modal, reads
  // the lyrics link (Title row), opens the page in a tab AND copies the URL to
  // the clipboard.
  async function doOpenWeb(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return; }
    ui.showToast(entry, t("toast.openingWeb"), 4000);
    const cfg = await getTabConfig("openWeb"); // 2º plano por botón (lote 13, default ON)
    const res = await core.openTrackPage({ background: cfg.background });
    if (!res.ok) { ui.showToast(entry, t("toast.openWebFailed"), 5000); return; }
    let copied = false;
    if (res.url) { try { await navigator.clipboard.writeText(res.url); copied = true; } catch (e) {} }
    if (copied) ui.showToast(entry, t("toast.openWebCopied"));
  }

  // Reset sync: the ⋯ menu's "Restart sync" item ONLY exists on the Time-sync
  // tab. It switches to Time-sync, opens the ⋯ and clicks "Restart sync": the
  // "Restart current sync?" dialog appears and THE USER confirms it
  // (destructive, we do not touch it).
  async function doResetSync(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return; }
    ui.showToast(entry, t("toast.resetSyncOpening"), 3000);
    for (let attempt = 0; attempt < 2; attempt++) {
      core.gotoSection("Time-sync");
      await core.sleep(600); // dejar montar la pestaña de sincronización
      if (await core.clickHeaderMenuItem("restart_sync")) {
        ui.showToast(entry, t("toast.resetSyncConfirm"));
        return;
      }
    }
    ui.showToast(entry, t("toast.menuItemFail"));
  }

  // Actions that live in another module (compare.js → window.MXMCompare,
  // save-lyrics.js → window.MXMSave); se resuelven lazy al clickear.
  function delegated(globalName, fnName) {
    return (entry) => {
      const mod = window[globalName];
      if (mod && typeof mod[fnName] === "function") mod[fnName](entry);
      else ui.showToast(entry, t("toast.notTask"));
    };
  }

  // ── Button definitions ───────────────────────────────────────────────
  // Order/opensTab/default-off/groups: single source in btn-defs.js —
  // this list and popup.js's (BTNS) used to be TWO copies of the same order
  // that had to be kept in sync by hand. Here only the ICONS and onClick
  // (code/behavior, not data portable to the popup) remain. The
  // colores salen de COLORS (btn-colors.js) al registrar.
  const ICON_CLICK = {
    saveSend:        { icon: saveSendIcon,     onClick: delegated("MXMSave", "onSaveSend") },
    copy:            { icon: copyIcon,         light: true, onClick: doCopy },
    save:            { icon: saveIcon,         onClick: delegated("MXMSave", "doSave") },
    findReplace:     { icon: findReplaceIcon,  onClick: doFindReplace },
    resetSync:       { icon: resetSyncIcon,    onClick: doResetSync },
    contributorName: { icon: contributorIcon,  onClick: doContributorName },
    contribProfile:  { icon: profileIcon,      onClick: doContributorProfile },
    openWeb:         { icon: openWebIcon,      onClick: doOpenWeb },
    gem:             { icon: gemIcon,          onClick: doGem },
    gemReview:       { icon: gemReviewIcon,    onClick: doGemReview },
    diffgenie:       { icon: diffgenieIcon,    onClick: delegated("MXMCompare", "doDiffgenie") },
    compare:         { icon: compareIcon,      onClick: delegated("MXMCompare", "doCompare") },
    google:          { icon: googleIcon,       onClick: doGoogle },
    youtube:         { icon: youtubeIcon,      onClick: doYouTube },
    spotify:         { icon: spotifyIcon,      onClick: doSpotify },
    appleMusic:      { icon: appleIcon,        onClick: doAppleMusic },
    amazonMusic:     { icon: amazonIcon,       onClick: doAmazonMusic },
    // Typeforms: 4 slots; the 1st is the Slack invite flow that already
    // worked, the others are to be defined (toast "not configured").
    typeform1:       { icon: tfIcon(1),        onClick: doSlackInvite },
    typeform2:       { icon: tfIcon(2),        onClick: doTypeformStub },
    typeform3:       { icon: tfIcon(3),        onClick: doTypeformStub },
    typeform4:       { icon: tfIcon(4),        onClick: doTypeformStub },
  };
  const DEFS = MXMBtnDefs.ORDER.map((key) => ({ key, ...ICON_CLICK[key] }));
  const DEF_BY_KEY = Object.fromEntries(DEFS.map((d) => [d.key, d]));

  // Collapsible groups: membership single-sourced in btn-defs.js; here only the
  // anchor icon (code, not portable data). With the "groupButtons" toggle
  // (default ON) each group shows as ONE anchor in the stack; its members
  // expand to the left on hover. The anchor takes the position of the FIRST
  // enabled member in the current order.
  const GROUP_ICON = {
    gemGroup: gemGroupIcon,
    streamGroup: streamGroupIcon,
    typeformGroup: typeformsIcon,
    contribGroup: contributorOutlineIcon,
  };
  const GROUPS = Object.fromEntries(
    Object.entries(MXMBtnDefs.GROUPS).map(([ak, members]) => [ak, { icon: GROUP_ICON[ak], members }])
  );

  // Buttons that start DISABLED by default (opt-in). The rest are ON if there
  // is no explicit key.
  const DEFAULT_OFF = new Set(MXMBtnDefs.DEFAULT_OFF);
  const isBtnEnabled = (cfg, key) =>
    DEFAULT_OFF.has(key) ? cfg[key] === true : cfg[key] !== false;

  // Stacking order configurable from the popup ("btnOrder": array of keys).
  // Keys missing from the array (new buttons) go at the end in the
  // por defecto de DEFS.
  function orderedDefs(order) {
    if (!Array.isArray(order) || !order.length) return DEFS;
    const pos = (k) => {
      const i = order.indexOf(k);
      return i === -1 ? order.length + DEFS.findIndex((d) => d.key === k) : i;
    };
    return [...DEFS].sort((a, b) => pos(a.key) - pos(b.key));
  }

  // When leaving the editor, MxM may ask for confirmation ("leave without saving?").
  // While that dialog is visible the buttons must NOT be hidden: they should
  // stay until the user confirms leaving. (The exact text is validated live;
  // the matcher is broad on purpose.)
  function leaveConfirmVisible() {
    const i18n = window.MXMStudioI18n;
    const rx = i18n
      ? i18n.union(["exit_dialog_title", "exit_dialog_desc", "discard"])
      : /(leave|discard|unsaved|are you sure|sure you want|salir|descartar)/i;
    return !!core.findByText(rx);
  }

  // ── Visibility + dynamic stacking ──────────────────────────────────────────
  // Removes all real buttons + the group anchors.
  function removeAllButtons() {
    for (const def of DEFS) ui.remove(def.key);
    for (const ak of Object.keys(GROUPS)) ui.remove(ak);
  }
  let hadButtons = false;       // animación de aparición al entrar (0 → N)
  let lastIntroTaskId = null;   // …y también al cambiar de tarea dentro del editor
  function refresh() {
    const onEditor = core.isTaskEditorPage();
    chrome.storage.local.get(["floatingButtons", "btnOrder", "groupButtons", "groupButtonsBy", "floatingButtonsOn"], (d) => {
      const cfg = d.floatingButtons || {};
      // Grouping PER GROUP: "groupButtonsBy" = { gemGroup: bool, … }.
      // Each group's default = the old global "groupButtons" toggle (default ON),
      // so the user's previous config is respected as a starting point.
      const groupCfg = d.groupButtonsBy || {};
      const legacyDefault = d.groupButtons !== false;
      const groupOn = (ak) => (groupCfg[ak] === undefined ? legacyDefault : groupCfg[ak] !== false);
      // Master switch (popup Buttons tab): hides ALL floating buttons without
      // touching the individual config. Default ON.
      const masterOn = d.floatingButtonsOn !== false;
      const show = onEditor && masterOn;
      // saveSend is a normal floating button (the Send overlay was removed);
      // default ON and 1st in the stack.
      const defEnabled = (key) => isBtnEnabled(cfg, key);
      const enabledDefs = orderedDefs(d.btnOrder).filter((def) => defEnabled(def.key));
      if (!show) {
        if (hadButtons && !onEditor) {
          // Do not hide while leave confirmation is asked: retry until the
          // dialog disappears (confirmed) or it returns to the editor (cancelled).
          if (leaveConfirmVisible()) { setTimeout(refresh, 400); return; }
          // Leaving the editor: hide them off the right side and only then
          // remove them (if the user re-entered meanwhile, refresh() re-registers
          // them and restores their visibility).
          ui.playExit(() => {
            if (core.isTaskEditorPage()) { refresh(); return; }
            removeAllButtons();
          });
        } else {
          // Apagado por switch maestro (o nunca hubo botones): sacarlos directo.
          removeAllButtons();
        }
        hadButtons = false;
        lastIntroTaskId = null;
        return;
      }
      // Remove the disabled ones (includes default-off without an explicit key and
      // saveSend when not in "floating" mode).
      for (const def of DEFS) {
        if (!defEnabled(def.key)) ui.remove(def.key);
      }

      // Grouping: map which members are grouped NOW (only with the toggle ON and
      // with enabled members). anchorMembers: anchor → [members].
      const enabledKeys = new Set(enabledDefs.map((def) => def.key));
      const groupOf = {};        // memberKey → anchorKey
      const anchorMembers = {};  // anchorKey → [memberKey…] habilitados, en orden
      for (const [ak, g] of Object.entries(GROUPS)) {
        if (!groupOn(ak)) continue; // este grupo va SUELTO (toggle individual OFF)
        const mem = g.members.filter((k) => enabledKeys.has(k));
        if (!mem.length) continue;
        anchorMembers[ak] = mem;
        for (const k of mem) groupOf[k] = ak;
      }
      // Remove anchors that do not apply (empty group or toggle OFF).
      for (const ak of Object.keys(GROUPS)) if (!anchorMembers[ak]) ui.remove(ak);

      // Build the stack: enabledDefs, but members collapse into their anchor
      // (which inherits the FIRST enabled member's position).
      const stackItems = [];
      const placed = new Set();
      for (const def of enabledDefs) {
        const ak = groupOf[def.key];
        if (!ak) { stackItems.push({ type: "def", def }); continue; }
        if (!placed.has(ak)) { placed.add(ak); stackItems.push({ type: "anchor", key: ak }); }
      }

      // Register the stack. stackIndex grows from BOTTOM to top, so it is
      // inverted: the 1st in the popup list ends up at the TOP of the stack.
      const n = stackItems.length;
      stackItems.forEach((it, i) => {
        const stackIndex = n - 1 - i;
        if (it.type === "def") {
          const def = it.def;
          const c = COLORS[def.key] || { bg: "#ffffff", fg: "#3a3a3a" };
          ui.register({ ...def, color: c.bg, iconColor: c.fg, stackIndex, label: t("popup.btn." + def.key) });
        } else {
          const ak = it.key;
          const c = COLORS[ak] || { bg: "#ffffff", fg: "#3a3a3a" };
          ui.register({
            key: ak, icon: GROUPS[ak].icon, color: c.bg, iconColor: c.fg,
            stackIndex, label: t("popup.btn." + ak), tipPos: "top",
            groupMembers: anchorMembers[ak],
            onClick: () => ui.toggleGroup(ak),
          });
        }
      });

      // Register the grouped members: hidden over their anchor, they expand on
      // hover (mxm-buttons positions/animates them).
      for (const [ak, mem] of Object.entries(anchorMembers)) {
        mem.forEach((mk, gi) => {
          const def = DEF_BY_KEY[mk];
          const c = COLORS[mk] || { bg: "#ffffff", fg: "#3a3a3a" };
          ui.register({ ...def, color: c.bg, iconColor: c.fg, groupMemberOf: ak, groupIndex: gi, label: t("popup.btn." + mk), tipPos: "top" });
        });
      }
      // Entrance animation: on entering (0 → N) or on changing TASK within the
      // editor (ensures that in random mode it rotates on each opened task).
      const nowHas = enabledDefs.length > 0;
      const taskId = core.getTaskId();
      if (nowHas && (!hadButtons || taskId !== lastIntroTaskId)) {
        ui.playIntro();
        // Clear the previous task's contributor label; compare.announceContributor
        // re-populates it ~5s later.
        if (taskId !== lastIntroTaskId) ui.hideContributorLabel();
        lastIntroTaskId = taskId;
      }
      hadButtons = nowHas;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.floatingButtons || changes.btnOrder || changes.groupButtons || changes.groupButtonsBy || changes.floatingButtonsOn) refresh();
    // Turn off the fixed contributor label on the fly.
    if (changes.contributorFixedLabel && changes.contributorFixedLabel.newValue === false) ui.hideContributorLabel();
  });

  // ── Trigger from the popup (MXM_RUN) ────────────────────────────────────────
  const ACTIONS = {
    copy: doCopy, youtube: doYouTube, google: doGoogle, spotify: doSpotify,
    appleMusic: doAppleMusic, amazonMusic: doAmazonMusic,
    contributorName: doContributorName, contribProfile: doContributorProfile,
    findReplace: doFindReplace,
    compare: delegated("MXMCompare", "doCompare"), diffgenie: delegated("MXMCompare", "doDiffgenie"),
    gem: doGem, gemReview: doGemReview, save: delegated("MXMSave", "doSave"),
    typeform1: doSlackInvite, typeform2: doTypeformStub, typeform3: doTypeformStub,
    typeform4: doTypeformStub, openWeb: doOpenWeb, resetSync: doResetSync,
  };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "MXM_RUN" && ACTIONS[msg.action]) {
      // Triggered without an anchor button; the toast still shows (bottom-center).
      ACTIONS[msg.action](ui.get(msg.action) || null);
    }
  });

  refresh();

  // SPA: re-evaluate on URL change (single dispatcher in mxm-core).
  core.onNavigate(refresh);
})();
