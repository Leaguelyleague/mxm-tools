// =============================================================================
// btn-colors.js — SINGLE source of the floating buttons' colors.
// Consumed by buttons-mxm.js (real render) and popup.js (dots in the Buttons
// tab); previously duplicated. bg = saturated pastel background; fg = icon
// color (the SVGs use fill="currentColor").
// =============================================================================

(function () {
  "use strict";
  if (window.MXMBtnColors) return;

  window.MXMBtnColors = {
    copy:            { bg: "#ffffff", fg: "#3a3a3a" },
    youtube:         { bg: "#ff9d9d", fg: "#8f1d1d" },
    google:          { bg: "#ffd166", fg: "#7a5200" },
    spotify:         { bg: "#6fdc9a", fg: "#14532d" },
    appleMusic:      { bg: "#d59af0", fg: "#5b1e7a" },
    compare:         { bg: "#b393f2", fg: "#3c1e78" },
    diffgenie:       { bg: "#66d6a3", fg: "#0f5132" },
    contributorName: { bg: "#7fb5f0", fg: "#173e6b" },
    findReplace:     { bg: "#e8cf6b", fg: "#5c4a00" },
    gem:             { bg: "#ff9ecd", fg: "#7a1e4d" },
    save:            { bg: "#8fa8ff", fg: "#1e2f78" },
    amazonMusic:     { bg: "#7fe3ea", fg: "#0b4a50" },
    gemReview:       { bg: "#ffb59e", fg: "#7a2a10" },
    saveSend:        { bg: "#4fb477", fg: "#ffffff" },
    openWeb:         { bg: "#9fd0ff", fg: "#0b3a66" },
    resetSync:       { bg: "#f0a6a6", fg: "#6b1414" },
    // Typeforms (typeform1 = the Slack invite flow).
    typeform1:       { bg: "#dcb8e3", fg: "#4a154b" },
    typeform2:       { bg: "#dcb8e3", fg: "#4a154b" },
    typeform3:       { bg: "#dcb8e3", fg: "#4a154b" },
    typeform4:       { bg: "#dcb8e3", fg: "#4a154b" },
    contribProfile:  { bg: "#7fb5f0", fg: "#173e6b" },
    // Group anchors: they inherit their members' tone.
    gemGroup:        { bg: "#ff9ecd", fg: "#7a1e4d" },
    streamGroup:     { bg: "#8fd0c8", fg: "#0b4a44" },
    typeformGroup:   { bg: "#dcb8e3", fg: "#4a154b" },
    contribGroup:    { bg: "#7fb5f0", fg: "#173e6b" },
  };
})();
