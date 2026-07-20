// =============================================================================
// assistant.js — Automatically closes the editor's "Assistant" panel when a
// task opens (2 seconds after the panel loads). Toggle from the popup
// ("autoCloseAssistant"), default ON — same `!== false` pattern as the rest of
// the features (hydration AND onChanged, see below).
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTAssistant) return;
  window.__mxmSTAssistant = true;

  const core = window.MXMCore;

  // Fragile selector: path of the Assistant panel's collapse button (double
  // chevron). Collapses with a plain fireClick.
  const ASSISTANT_COLLAPSE_PATH_PREFIX = "M9.882 14.762";
  const CLOSE_DELAY_MS = 2000;
  const PANEL_WAIT_MS = 10000;

  let enabled = false;
  chrome.storage.local.get(["autoCloseAssistant"], (d) => {
    enabled = d.autoCloseAssistant !== false; // default ON
    // Re-evaluate the current task: hydration arrives after the first
    // onUrlChange and without this the initial load would be missed.
    if (enabled) { lastTaskId = null; onUrlChange(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoCloseAssistant) {
      // Same default ON (`!== false`) as the hydration above, so an undefined
      // newValue keeps the real default (ON) instead of turning it off.
      enabled = changes.autoCloseAssistant.newValue !== false;
    }
  });

  function findCollapse() {
    const p = document.querySelector(`svg path[d^="${ASSISTANT_COLLAPSE_PATH_PREFIX}"]`);
    if (!p || !p.closest("svg").getClientRects().length) return null;
    return p.closest(core.CLICKABLE_SEL);
  }

  async function closeAssistant(gen) {
    // Wait for the panel to exist; if it never appears (already closed by the
    // user, or the editor does not bring it), there is nothing to do.
    const btn = await core.waitFor(findCollapse, PANEL_WAIT_MS);
    if (!btn || gen !== runGen) return;
    await core.sleep(CLOSE_DELAY_MS);
    if (gen !== runGen || !enabled) return;
    const again = findCollapse();
    if (again) core.fireClick(again);
  }

  let lastTaskId = null;
  let runGen = 0;
  function onUrlChange() {
    const id = core.isTaskEditorPage() ? core.getTaskId() : null;
    if (id === lastTaskId) return;
    lastTaskId = id;
    runGen++;
    if (!id || !enabled) return;
    closeAssistant(runGen);
  }

  onUrlChange();

  // SPA: re-evaluate on URL change (single dispatcher in mxm-core).
  core.onNavigate(onUrlChange);
})();
