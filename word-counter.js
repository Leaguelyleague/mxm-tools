// =============================================================================
// MxM Tools — Word counter (Word Counter Plus style)
// When you select text on any page it shows a HUD with:
//   - Words
//   - Characters (with spaces)
//   - Characters (without spaces)
// It appears when you press Cmd+A twice in a row (the first Cmd+A only selects).
// Configurable shortcut (default ⌥X): turns the counter on/off. Toggle in the
// popup.
// =============================================================================

(function () {
  "use strict";

  let enabled = true; // default: on
  let hud = null; // Shadow DOM host
  let valuesEl = null; // container of the numbers inside the shadow
  let hideTimer = null;

  // Configurable shortcut to turn the counter on/off (default: ⌥X).
  let shortcut = window.MXMShortcuts.get("wordCounter");
  window.MXMShortcuts.onChange((all) => { shortcut = all.wordCounter; });

  // ── Persistent state ───────────────────────────────────────────────────────
  chrome.storage.local.get(["wordCounterEnabled"], (d) => {
    enabled = d.wordCounterEnabled !== false;
    if (!enabled) hideHud();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.wordCounterEnabled) {
      enabled = changes.wordCounterEnabled.newValue !== false;
      // The HUD only shows while Cmd+A is held, so re-enabling shows nothing;
      // disabling hides it.
      if (!enabled) hideHud();
    }
  });

  // ── HUD (Shadow DOM, does not interfere with the page) ─────────────────────
  function ensureHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "mxm-word-counter-hud";
    // pointer-events:none -> does not steal the selection or clicks
    hud.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
      "display:flex;justify-content:center;pointer-events:none;";
    const shadow = hud.attachShadow({ mode: "open" });
    // Black-and-white HUD matching the floating buttons: no blue, numbers in
    // currentColor, and sensitive to the system mode via a media query inside
    // the shadow (light = white background/black text; dark = #1a1a1a/white).
    shadow.innerHTML = `
      <style>
        .box{
          margin:0 0 16px;
          display:flex; gap:18px; align-items:center;
          background:#fff; color:#111;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
          padding:10px 16px; border-radius:12px;
          box-shadow:0 6px 24px rgba(0,0,0,.25);
          border:1px solid #ddd;
          opacity:0; transform:translateY(8px);
          transition:opacity .15s ease, transform .15s ease;
        }
        .box.show{ opacity:1; transform:translateY(0); }
        .stat{ text-align:center; line-height:1.1; }
        .num{ font-size:16px; font-weight:700; color:currentColor; }
        .lbl{ font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.04em; }
        .sep{ width:1px; height:24px; background:#ddd; }
        @media (prefers-color-scheme: dark){
          .box{ background:#1a1a1a; color:#fff; border-color:#333; box-shadow:0 6px 24px rgba(0,0,0,.35); }
          .lbl{ color:#aaa; }
          .sep{ background:#333; }
        }
      </style>
      <div class="box">
        <div class="stat"><div class="num" id="words">0</div><div class="lbl" id="lbl-words"></div></div>
        <div class="sep"></div>
        <div class="stat"><div class="num" id="chars">0</div><div class="lbl" id="lbl-chars"></div></div>
        <div class="sep"></div>
        <div class="stat"><div class="num" id="charsNs">0</div><div class="lbl" id="lbl-charsNs"></div></div>
      </div>`;
    document.documentElement.appendChild(hud);
    valuesEl = {
      box: shadow.querySelector(".box"),
      words: shadow.getElementById("words"),
      chars: shadow.getElementById("chars"),
      charsNs: shadow.getElementById("charsNs"),
      lblWords: shadow.getElementById("lbl-words"),
      lblChars: shadow.getElementById("lbl-chars"),
      lblCharsNs: shadow.getElementById("lbl-charsNs"),
    };
  }

  function showHud(stats) {
    ensureHud();
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    // Labels at display time: they follow the language chosen live.
    valuesEl.lblWords.textContent = window.MXMI18n.t("hud.words");
    valuesEl.lblChars.textContent = window.MXMI18n.t("hud.chars");
    valuesEl.lblCharsNs.textContent = window.MXMI18n.t("hud.charsNs");
    valuesEl.words.textContent = stats.words.toLocaleString();
    valuesEl.chars.textContent = stats.chars.toLocaleString();
    valuesEl.charsNs.textContent = stats.charsNs.toLocaleString();
    valuesEl.box.classList.add("show");
  }

  function hideHud() {
    if (!valuesEl) return;
    valuesEl.box.classList.remove("show");
  }

  // ── Metric computation ──────────────────────────────────────────────────────
  function computeStats(text) {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const chars = text.length;
    const charsNs = text.replace(/\s/g, "").length;
    return { words, chars, charsNs };
  }

  // ── Get the selected text (includes inputs/textarea) ───────────────────────
  function getSelectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
      try {
        const t = el.value.substring(el.selectionStart, el.selectionEnd);
        if (t) return t;
      } catch (_) {
        /* some inputs do not support selectionStart */
      }
    }
    const sel = window.getSelection();
    return sel ? sel.toString() : "";
  }

  function updateFromSelection() {
    if (!enabled) return;
    const text = getSelectedText();
    if (text && text.trim()) {
      showHud(computeStats(text));
    } else {
      hideHud();
    }
  }

  // ── Show ONLY when Cmd+A is pressed TWICE in a row ─────────────────────────
  // The first Cmd+A behaves like a normal "select all" (no HUD). If Cmd+A is
  // pressed again within DOUBLE_PRESS_MS, the HUD appears, stays while the combo
  // is held, and hides when it is released.
  let comboActive = false;
  const DOUBLE_PRESS_MS = 400; // window for the second press
  let lastCmdAPress = 0;

  document.addEventListener(
    "keydown",
    function (e) {
      if (!enabled) return;
      // "Select all": Cmd+A on mac, Ctrl+A on Windows/Linux.
      const selectAll = (e.metaKey && !e.ctrlKey) || (e.ctrlKey && !e.metaKey);
      if (selectAll && e.code === "KeyA" && !e.altKey && !e.shiftKey) {
        // Ignore auto-repeat from holding the key down.
        if (e.repeat) return;
        const now = Date.now();
        const isDouble = now - lastCmdAPress <= DOUBLE_PRESS_MS;
        lastCmdAPress = now;
        if (!isDouble) return; // first Cmd+A: just selects, no HUD
        lastCmdAPress = 0; // consume, so a third press does not count as double
        comboActive = true;
        // Let the browser do the "select all" and then read.
        requestAnimationFrame(() => {
          if (comboActive) updateFromSelection();
        });
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    function (e) {
      // On releasing the modifier (Cmd on mac, Ctrl on Win/Linux) or the A.
      if (e.key === "Meta" || e.key === "Control" ||
          e.code === "MetaLeft" || e.code === "MetaRight" ||
          e.code === "ControlLeft" || e.code === "ControlRight" || e.code === "KeyA") {
        comboActive = false;
        hideHud();
      }
    },
    true
  );

  window.addEventListener("blur", () => {
    comboActive = false;
    hideHud();
  });

  // ── Configurable shortcut: turns the counter on/off (default ⌥X) ───────────
  document.addEventListener(
    "keydown",
    function (e) {
      if (!window.MXMShortcuts.matches(e, shortcut)) return;
      e.preventDefault();
      e.stopPropagation();
      chrome.storage.local.set({ wordCounterEnabled: !enabled });
    },
    true
  );

  // Trigger from the popup (▶ trigger): turns the counter on/off.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "MXM_RUN" && msg.action === "wordCounter") {
      chrome.storage.local.set({ wordCounterEnabled: !enabled });
    }
  });

})();
