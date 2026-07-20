// =============================================================================
// auto-continue.js — Auto-click of the "Continue" button on the
// "Thanks for your contribution!" banner that appears when a task is
// successfully SENT. Toggle `autoContinueThanks` (storage.local), default ON.
// Not destructive — the task was already sent; it only closes the banner.
//
// Selectors (verified with the user's HTML): the banner has the title
// "Thanks for your contribution!"; the primary button is a clickable
// (div[tabindex]/r-1otgn73, white background r-o7jlcn) whose text is exactly
// "Continue" — the other is an <a> "Learn more" (excluded).
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTAutoContinue) return;
  window.__mxmSTAutoContinue = true;

  const core = window.MXMCore;
  let enabled = false;
  let lastClick = 0;

  chrome.storage.local.get({ autoContinueThanks: true }, (d) => { enabled = d.autoContinueThanks !== false; }); // default ON
  chrome.storage.onChanged.addListener((c, area) => {
    // Same default ON (`!== false`) as the hydration above.
    if (area === "local" && c.autoContinueThanks) enabled = c.autoContinueThanks.newValue !== false;
  });

  function tryContinue() {
    if (!enabled) return;
    const i18n = window.MXMStudioI18n;
    const thanksRx = (i18n && i18n.STR.thanks_title) ? i18n.rx("thanks_title") : /thanks for your contribution/i;
    if (!core.findByText(thanksRx)) return; // the banner is not there yet
    const isContinue = (txt) => (i18n && i18n.STR.continue_btn) ? i18n.test("continue_btn", txt) : txt.toLowerCase() === "continue";
    const btn = Array.from(document.querySelectorAll(core.CLICKABLE_SEL)).find((el) => {
      if (el.tagName === "A") return false; // "Learn more" is an <a>
      const r = el.getBoundingClientRect();
      return r.width > 0 && isContinue((el.innerText || "").trim());
    });
    if (!btn) return;
    if (Date.now() - lastClick < 3000) return; // anti-double-click guard
    lastClick = Date.now();
    core.fireClickFull(btn);
    MXMLog.log("[MxM ST] auto-Continue: 'Thanks for your contribution' banner closed.");
  }

  // 300ms throttle: Studio mutates the DOM constantly (typing,
  // animations, SPA); without this, findByText scans ALL the document's
  // div[dir=auto]/span on EVERY mutation. At most one pending check at a time —
  // they do not accumulate, extra mutations are just ignored until it runs.
  let continueTimer = null;
  function scheduleTryContinue() {
    if (continueTimer) return;
    continueTimer = setTimeout(() => { continueTimer = null; tryContinue(); }, 300);
  }
  new MutationObserver(scheduleTryContinue).observe(document.body, { childList: true, subtree: true });
})();
