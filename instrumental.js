// =============================================================================
// instrumental.js — Inserts "#INSTRUMENTAL" at the cursor position
// (shortcut, default ⌥Z). Uses the React-bypass primitives of window.MXMEdit
// (exported by unir-lineas.js; consumed lazily because the injection order
// between manifest groups is not guaranteed).
// It also responds to the popup trigger (MXM_RUN action="instrumental").
// Only makes sense in the editor (/tool).
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTInstrumental) return;
  window.__mxmSTInstrumental = true;

  const core = window.MXMCore;
  const SC = window.MXMShortcuts;
  const ui = window.MXMButtons;
  const t = (k, p) => window.MXMI18n.t(k, p);

  // Inserted WITH a line break (= typing "#INSTRUMENTAL" and pressing Enter):
  // there must always be an empty line below the instrumental.
  const INSERT_TEXT = "#INSTRUMENTAL";

  let enabled = true; // enabled by default (toggle "instrumentalEnabled")
  chrome.storage.local.get(["instrumentalEnabled"], (d) => {
    enabled = d.instrumentalEnabled !== false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.instrumentalEnabled) {
      enabled = changes.instrumentalEnabled.newValue !== false;
    }
  });

  let shortcut = SC.get("instrumental");
  SC.onChange((all) => { shortcut = all.instrumental; });

  function run() {
    if (!core.isTaskEditorPage()) { ui.showToast(null, t("toast.notTask")); return; }
    const edit = window.MXMEdit;
    const el = document.activeElement;
    if (!edit || !edit.isEditable(el)) {
      ui.showToast(null, t("toast.instrumentalNoFocus"));
      return;
    }
    const text = edit.getText(el);
    const pos = edit.getCursorPos(el);
    const insert = INSERT_TEXT + "\n"; // Enter included → empty line below
    edit.setText(el, text.slice(0, pos) + insert + text.slice(pos));
    edit.placeCursorPersistent(el, pos + insert.length);
    ui.showToast(null, t("toast.instrumentalDone"));
  }

  document.addEventListener("keydown", (e) => {
    if (!enabled) return;
    if (!SC.matches(e, shortcut)) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "MXM_RUN" && msg.action === "instrumental") run();
  });
})();
