// =============================================================================
// mxm-log.js — Central logger gated by a storage.local flag.
//
// Before, each content script called console.log/warn directly: ~60 sites,
// several firing on EVERY visited page (some even an "extension loaded" banner
// on EVERY page). Now MXMLog.log/warn only print if "debugLogs" is true
// (storage.local, default OFF; enabled by hand from the console:
// chrome.storage.local.set({debugLogs:true}) — it has no UI, it is a
// diagnostic tool, not a user option).
//
// MXMLog.error is NOT gated: a console.error signals a real problem (an
// operation failed), it must always be visible.
//
// Injected together with mxm-shortcuts.js/i18n-strings-content.js/mxm-i18n.js
// in ALL manifest groups (before any feature).
// =============================================================================

(function () {
  "use strict";
  if (window.MXMLog) return;

  let debugOn = false;
  try {
    chrome.storage.local.get(["debugLogs"], (d) => { debugOn = d.debugLogs === true; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.debugLogs) debugOn = changes.debugLogs.newValue === true;
    });
  } catch (_) {
    /* no chrome.storage (unexpected context): stays silent */
  }

  window.MXMLog = {
    log(...args) { if (debugOn) console.log(...args); },
    warn(...args) { if (debugOn) console.warn(...args); },
    error(...args) { console.error(...args); }, // always visible
  };
})();
