// =============================================================================
// btn-defs.js — Single registry of the floating buttons' STATIC metadata.
// buttons-mxm.js and popup.js both derive the order/opensTab/default-off/groups
// from here, so the two cannot drift apart.
//
// What does NOT live here (still specific to each consumer):
//   - SVG icons and onClick handlers (buttons-mxm.js: they are code/behavior,
//     not portable data — popup.js does not even need them).
//   - Anything about popup rendering (triggers, toggles, i18n text).
//
// Exposes window.MXMBtnDefs = { ORDER, OPENS_TAB, DEFAULT_OFF, GROUPS }.
// =============================================================================

(function () {
  "use strict";
  if (window.MXMBtnDefs) return;

  // DEFAULT order (top = top of the on-screen stack and top of the popup
  // list): copy at the very top, then save, functions, gems, Google and the
  // streaming ones last.
  const ORDER = [
    "saveSend", "copy", "save", "findReplace", "resetSync",
    "contributorName", "contribProfile", "openWeb",
    "gem", "gemReview", "diffgenie", "compare",
    "google", "youtube", "spotify", "appleMusic", "amazonMusic",
    "typeform1", "typeform2", "typeform3", "typeform4",
  ];

  // Buttons that open a tab ⇒ the popup shows them the foreground/background
  // sub-config (btnTabConfig, storage.sync).
  const OPENS_TAB = {
    openWeb: true, gem: true, gemReview: true, diffgenie: true, compare: true,
    google: true, youtube: true, spotify: true, appleMusic: true, amazonMusic: true,
  };

  // Buttons that start DISABLED by default (opt-in). The rest are ON if there
  // is no explicit key.
  const DEFAULT_OFF = ["save", "copy"];

  // Collapsible groups: on screen they collapse into an anchor that expands on
  // hover; in the popup they are shown together with a per-cluster grouping
  // switch.
  const GROUPS = {
    gemGroup: ["gem", "gemReview"],
    streamGroup: ["youtube", "spotify", "appleMusic", "amazonMusic"],
    typeformGroup: ["typeform1", "typeform2", "typeform3", "typeform4"],
    contribGroup: ["contributorName", "contribProfile"],
  };

  window.MXMBtnDefs = { ORDER, OPENS_TAB, DEFAULT_OFF, GROUPS };
})();
