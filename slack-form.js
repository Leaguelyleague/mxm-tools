// =============================================================================
// slack-form.js — Typeform "Slack Curators Invitation Request"
// (https://musixmatch.typeform.com/to/aPDyFFta)
//
// Last link of the Slack flow: if there is a fresh "slackInviteProfile" in
// storage (left by mxm-lyrics.js with the last contributor's profile), it fills
// the form on its own: Start → "Curator" option → OK → paste the profile link →
// OK → Submit. The link is also copied to the clipboard as a backup for any
// step that fails.
//
// dryRun: if the payload carries dryRun=true it does EVERYTHING except the final
// Submit (safety rule: never send anything real).
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTSlackForm) return;
  window.__mxmSTSlackForm = true;

  const t = (k, p) => window.MXMI18n.t(k, p);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }

  // Clickables VISIBLE in the viewport (Typeform leaves the previous/next step
  // buttons in the DOM off-screen; they must be ignored). Sorted by closeness to
  // the vertical center = the active question.
  function clickables() {
    const mid = window.innerHeight / 2;
    return Array.from(document.querySelectorAll('button, [role="button"], [role="radio"], label'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight)
      .sort((a, b) => Math.abs((a.r.top + a.r.bottom) / 2 - mid) - Math.abs((b.r.top + b.r.bottom) / 2 - mid))
      .map(({ el }) => el);
  }
  function byText(re) {
    return clickables().find((el) => re.test((el.innerText || "").replace(/\s+/g, " ").trim()));
  }
  // The "Curator" option (Typeform shows it as "A Curator"; exclude "Not Curator").
  function findCuratorOption() {
    return clickables().find((el) => {
      const txt = (el.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      return txt.endsWith("curator") && !txt.includes("not curator");
    }) || null;
  }
  function findInput() {
    return Array.from(document.querySelectorAll('input[type="text"], input[type="url"], input:not([type]), textarea'))
      .find((el) => el.getClientRects().length && !el.readOnly) || null;
  }
  // Writes into Typeform's controlled React input. The native setter alone is
  // not enough: React reverts the value on re-render. Its _valueTracker must be
  // reset so it detects the change.
  function setValue(el, value) {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    if (el._valueTracker) el._valueTracker.setValue("");
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function notice(msg, ms = 15000) {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:16px;" +
      "background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:80vw;";
    bar.textContent = msg;
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), ms);
  }

  async function run(p) {
    // Backup: no matter what happens, the link stays in the clipboard.
    navigator.clipboard.writeText(p.url).catch(() => {});

    // 1) Start.
    const start = await waitFor(() => byText(/^start$/i), 20000);
    if (!start) { notice(t("sf.noStart")); return; }
    start.click();

    // 2) "Curator" option + OK.
    const curator = await waitFor(findCuratorOption, 10000);
    if (!curator) { notice(t("sf.noCurator")); return; }
    await sleep(300);
    curator.click();
    await sleep(500);
    const ok1 = byText(/^(ok|continue)\b/i);
    if (ok1) ok1.click();

    // 3) Profile link + OK.
    const input = await waitFor(findInput, 10000);
    if (!input) { notice(t("sf.noInput")); return; }
    setValue(input, p.url);
    await sleep(600);
    const ok2 = byText(/^(ok|continue)\b/i);
    if (ok2) ok2.click();

    // 4) Submit (in dryRun it stops here: test rule, never send).
    const submit = await waitFor(() => byText(/^submit$/i), 10000);
    if (!submit) { notice(t("sf.noSubmit")); return; }
    if (p.dryRun) { notice(t("sf.dryRun"), 20000); return; }
    await sleep(300);
    submit.click();
    notice(t("sf.done", { name: p.name || p.url }));
  }

  chrome.storage.local.get("slackInviteProfile", (d) => {
    const p = d.slackInviteProfile;
    if (!p || Date.now() - (p.ts || 0) > 180000) return; // stale payload: touch nothing
    chrome.storage.local.remove("slackInviteProfile"); // consume once
    run(p);
  });
})();
