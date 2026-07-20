// =============================================================================
// save-lyrics.js — Saves the task's lyrics as a .txt in Downloads.
//
// - doSave: downloads the current lyrics as "<song> - <artist>.txt" into
//   Downloads/<savePath>/<folder>/ (background's "download" handler).
//   It goes to the Transcript tab first to read the real full lyrics.
//   Exposed on window.MXMSave; the floating button lives in buttons-mxm.js.
//   Returns true if the download fired OK (used by Save & Send).
// - "Save & Send" button: a 42px button ANCHORED next to the header's Send
//   button (div[tabindex] with text "Send", top<90). It saves the lyrics and
//   only if that succeeds presses Send (fireClickFull). The Send button alone
//   no longer saves anything. Toggle "floatingButtons.saveSend" (default ON).
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTSave) return;
  window.__mxmSTSave = true;

  const core = window.MXMCore;
  const ui = window.MXMButtons;
  const t = (k, p) => window.MXMI18n.t(k, p);

  const DEDUP_MS = 3000; // avoids a double download from a double click
  let lastSaveAt = 0;

  // Folder by the day's date: YYYY-MM-DD in local time. The day changes → a new
  // folder. Replaces the old manual folder selector.
  function dateFolder() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // Simple hash (djb2) to compare the lyrics to be saved against the last saved
  // ones for that song (content dedup).
  function lyricHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  }

  // Prefer the visible textarea; as a last resort the hidden one the SPA leaves.
  function getLyricsText() {
    const ta = core.getTranscriptTextarea(true) || core.getTranscriptTextarea(false);
    return ta && ta.value.trim().length ? ta.value : null;
  }

  async function doSave(entry) {
    if (!core.isTaskEditorPage()) { ui.showToast(entry, t("toast.notTask")); return false; }
    if (Date.now() - lastSaveAt < DEDUP_MS) return false;
    // If we are not on Transcript, go there first to read the real full lyrics
    // (the hidden textarea stays only as a fallback).
    if (!core.isOnTranscript()) {
      ui.showToast(entry, t("toast.switchingToLyrics"));
      await core.ensureTranscript();
    }
    const lyrics = getLyricsText();
    if (!lyrics) { ui.showToast(entry, t("toast.saveNoLyrics")); return false; }
    lastSaveAt = Date.now();
    const { song, artist } = core.getSongInfo();
    return await persistLyrics(song, artist, lyrics, entry);
  }

  // Downloads the already-captured lyrics (+ content dedup). Separate from
  // doSave so Save & Send can capture the lyrics BEFORE sending and only
  // download once the "Thanks for your contribution" banner appears.
  async function persistLyrics(song, artist, lyrics, entry) {
    const filename = `${song} - ${artist}`;
    // Content dedup: if the lyrics are IDENTICAL to the last saved ones for THIS
    // song, they are not saved again. It still returns true (the lyrics are
    // already safe on disk) so Save & Send can send without re-saving.
    const dedupKey = "savedLyric:" + core.songKey(song, artist);
    // ts does NOT take part in the dedup comparison (only h/len below); it lets
    // background.js clean up old signatures so they do not grow unbounded.
    const sig = { h: lyricHash(lyrics), len: lyrics.length, ts: Date.now() };
    const prev = await new Promise((r) => chrome.storage.local.get(dedupKey, (d) => r(d[dedupKey])));
    if (prev && prev.h === sig.h && prev.len === sig.len) {
      ui.showToast(entry, t("toast.saveIdentical"));
      return true;
    }
    const folder = dateFolder();
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "download", folder, filename, text: lyrics }, (res) => {
        const ok = !!(res && res.success);
        if (ok) chrome.storage.local.set({ [dedupKey]: sig });
        ui.showToast(entry, ok ? t("toast.saved", { name: filename }) : t("toast.saveFailed"));
        resolve(ok);
      });
    });
  }

  // Watches for the "Thanks for your contribution" banner (i18n-proof, same
  // anchor as auto-continue.js). It is ARMED before pressing Send to beat
  // auto-Continue, which could close it before the next poll. Returns a
  // wait(timeoutMs) → Promise<boolean> function.
  function watchForThanks() {
    let seen = false;
    const i18n = window.MXMStudioI18n;
    const check = () => {
      const body = document.body.textContent || "";
      const hit = (i18n && i18n.STR.thanks_title)
        ? i18n.has("thanks_title", body) : /thanks for your contribution/i.test(body);
      if (hit) seen = true;
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    check(); // in case it was already there
    return (timeoutMs) => new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (seen) { clearInterval(iv); obs.disconnect(); resolve(true); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); obs.disconnect(); resolve(false); }
      }, 100);
    });
  }

  window.MXMSave = { doSave, onSaveSend };

  // ── "Save & Send" (floating button only) ────────────────────────────────────
  // onSaveSend (fired by the saveSend floating button in buttons-mxm): it saves
  // and, only if the save succeeded, presses the real Send.
  let ssBusy = false;
  // Double-click confirmation: the 1st click only warns; the 2nd within the
  // window actually sends (so a task is not sent by a stray click).
  let ssConfirmAt = 0;
  const SS_CONFIRM_MS = 3000;

  // Header's Send button. i18n-proof: matches the text against Studio's 14
  // "send" variants (MXMStudioI18n, case-insensitive due to the CSS capitalize)
  // AND requires the header position (top<90). The English literal is the net in
  // case the table is missing. The match is TRIPLE (text+position+outside
  // overlay) on purpose: a wrong click here would send a real contribution. The
  // 3rd condition discards a "Send" that appears inside a fixed modal/dropdown
  // (e.g. a menu item with that text) — only the real header one counts, never
  // one covered by an overlay.
  function findSendButton() {
    const i18n = window.MXMStudioI18n;
    const matchesSend = (txt) => (i18n && i18n.STR.send_btn)
      ? i18n.test("send_btn", txt) : /^send$/i.test(txt);
    for (const el of document.querySelectorAll(core.CLICKABLE_SEL)) {
      if (!matchesSend((el.innerText || "").trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.top < 90 && !core.findFixedOverlay(el)) return el;
    }
    return null;
  }

  // Visually highlights the button Save & Send is going to click, during the
  // confirmation window: the user SEES what will be pressed before the 2nd
  // click. Restores the original outline on clear.
  let sendHighlightEl = null, sendHighlightPrevOutline = "";
  function highlightSendTarget(el) {
    clearSendHighlight();
    sendHighlightEl = el;
    sendHighlightPrevOutline = el.style.outline;
    el.style.outline = "3px solid #4FB477";
    el.style.outlineOffset = "2px";
  }
  function clearSendHighlight() {
    if (sendHighlightEl) { sendHighlightEl.style.outline = sendHighlightPrevOutline; sendHighlightEl.style.outlineOffset = ""; }
    sendHighlightEl = null;
  }

  async function onSaveSend(entry) {
    if (ssBusy) return;
    const now = Date.now();
    // 1st click (or expired window): ask for confirmation and wait for the 2nd
    // click. Besides the bottom toast, a small bubble next to the button. The
    // confirmation window now VALIDATES the target — if the real Send is not
    // found, it warns right away (no waiting for the 2nd click to discover it),
    // and the one to be pressed is highlighted on the page.
    if (now - ssConfirmAt > SS_CONFIRM_MS) {
      const send = findSendButton();
      if (!send) { ui.showToast(entry || null, t("toast.saveSendNoBtn")); return; }
      ssConfirmAt = now;
      highlightSendTarget(send);
      setTimeout(() => { if (Date.now() - ssConfirmAt >= SS_CONFIRM_MS) clearSendHighlight(); }, SS_CONFIRM_MS);
      ui.showToast(entry || null, t("toast.saveSendConfirm"), SS_CONFIRM_MS);
      if (entry) ui.showBubble(entry, t("toast.saveSendConfirmShort"), SS_CONFIRM_MS);
      return;
    }
    // 2nd click within the window: actually send.
    ssConfirmAt = 0;
    clearSendHighlight();
    ui.hideBubble();
    ssBusy = true;
    try {
      // 1) Capture the lyrics in memory BEFORE sending (after Send the editor's
      //    DOM may disappear and they could no longer be read).
      if (!core.isTaskEditorPage()) { ui.showToast(null, t("toast.notTask")); return; }
      if (!core.isOnTranscript()) {
        ui.showToast(null, t("toast.switchingToLyrics"));
        await core.ensureTranscript();
      }
      const lyrics = getLyricsText();
      if (!lyrics) { ui.showToast(null, t("toast.saveNoLyrics")); return; }
      const { song, artist } = core.getSongInfo();

      // 2) Arm the Thanks banner observer BEFORE pressing Send (to beat
      //    auto-Continue, which could close it right away).
      const waitThanks = watchForThanks();

      const send = findSendButton();
      if (!send) { ui.showToast(null, t("toast.saveSendNoBtn")); return; }
      await core.sleep(150);
      core.fireClickFull(send);

      // 3) Download ONLY if the send was confirmed by the "Thanks" banner.
      const confirmed = await waitThanks(15000);
      if (!confirmed) { ui.showToast(null, t("toast.saveSendNoThanks")); return; }
      lastSaveAt = 0; // the Save button's dedup does not apply to this flow
      await persistLyrics(song, artist, lyrics, null);
    } finally {
      ssBusy = false;
    }
  }

})();
