// =============================================================================
// Song → Gem — Keyboard shortcut (Content Script, <all_urls>)
// Default shortcut: ⌥G (configurable from the popup, see mxm-shortcuts.js).
//
// Replaces the old chrome.commands command (⌘⇧Y), which Chrome would not let
// you reconfigure from the popup. With text selected, it sends the selection to
// the background (RUN_QUERY message), which reuses the entire existing pipeline
// (searches YouTube and sends to the Gem). The background already validates the
// master toggle.
//
// Limitation compared to the native command: it does not run on chrome:// pages
// or the Chrome Web Store (content scripts are not injected there).
// =============================================================================

(function () {
  "use strict";

  // Respect the local master toggle so the key is not intercepted if the
  // feature is off (lets ⌥G type its normal character).
  let gemEnabled = true;
  chrome.storage.local.get(["songToGemEnabled"], (d) => {
    gemEnabled = d.songToGemEnabled !== false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.songToGemEnabled) {
      gemEnabled = changes.songToGemEnabled.newValue !== false;
    }
  });

  let shortcut = window.MXMShortcuts.get("gem");
  window.MXMShortcuts.onChange((all) => { shortcut = all.gem; });

  function getSelectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
      try {
        const t = el.value.substring(el.selectionStart, el.selectionEnd);
        if (t) return t;
      } catch (_) { /* some inputs do not support selectionStart */ }
    }
    const sel = window.getSelection();
    return sel ? sel.toString() : "";
  }

  document.addEventListener(
    "keydown",
    function (e) {
      if (!gemEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcut)) return;

      const text = getSelectedText().trim();
      if (!text) return; // no selection -> the key types normally

      e.preventDefault();
      e.stopPropagation();
      // The background validates the toggle again and runs the full pipeline.
      chrome.runtime.sendMessage({ type: "RUN_QUERY", query: text });
    },
    true // useCapture: intercept before the page
  );

})();
