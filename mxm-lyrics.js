// =============================================================================
// mxm-lyrics.js — PUBLIC lyrics page (www.musixmatch.com/lyrics/...).
//
// Intermediate link of the "Slack Curators Invitation Request" flow:
//   1. In Studio, the slackInvite button leaves "slackInvitePending" and opens
//      this page (external Title link in the Track info modal).
//   2. Here the last contributor's PROFILE is read straight from the
//      __NEXT_DATA__ JSON (crowdTrackHistoryGet.data[0] = last contribution;
//      its id builds /profile/<id>) — without clicking anything in the UI.
//   3. "slackInviteProfile" is stored, the Typeform is opened (slack-form.js
//      does the rest) and this intermediate tab closes itself.
//
// Injected across musixmatch.com (manifest group 1) but only acts on /lyrics/
// (and its per-language variants) with a fresh pending request.
// =============================================================================

(function () {
  "use strict";
  if (window.__mxmSTLyrics) return;
  window.__mxmSTLyrics = true;

  if (!/^\/([a-z]{2}(-[A-Z]{2})?\/)?(lyrics|letras|songtext|paroles|testo)\//.test(location.pathname)) return;

  // Typeform URL configurable from Advanced options; the default is preloaded.
  // NOTE: the slack-form.js content script is only injected on
  // musixmatch.typeform.com (manifest match); changing host would require
  // touching the manifest.
  const DEFAULT_TYPEFORM_URL = "https://musixmatch.typeform.com/to/aPDyFFta";
  const PENDING_MS = 120000; // older requests are discarded (reloaded tab)

  function lastContributor() {
    // 1) __NEXT_DATA__: the structured source (first item = last editor).
    try {
      const data = JSON.parse(document.getElementById("__NEXT_DATA__").textContent);
      const hist = data?.props?.pageProps?.data?.crowdTrackHistoryGet?.data;
      if (Array.isArray(hist) && hist.length && hist[0].id) {
        return { url: location.origin + "/profile/" + hist[0].id, name: hist[0].name || "" };
      }
    } catch (_) {}
    // 2) Fallback: first /profile/ link in the DOM (Contributions list).
    const a = document.querySelector('a[href^="/profile/"]');
    if (a) return { url: a.href, name: (a.textContent || "").trim() };
    return null;
  }

  // "Go to the curator's profile": if there is a fresh request, this tab
  // navigates straight to the last contributor's profile (same source as the
  // Slack flow: __NEXT_DATA__ → /profile/<id>). It has priority over the Slack
  // flow and the tab is NOT closed (the destination is the profile).
  chrome.storage.local.get("goProfilePending", (d) => {
    const p = d.goProfilePending;
    if (!p || Date.now() - (p.ts || 0) > PENDING_MS) return;
    chrome.storage.local.remove("goProfilePending"); // consume once
    const contrib = lastContributor();
    if (!contrib) {
      MXMLog.log("[MxM ST] profile: could not read the last contributor from this page");
      return;
    }
    location.href = contrib.url;
  });

  chrome.storage.local.get("slackInvitePending", (d) => {
    const p = d.slackInvitePending;
    if (!p || Date.now() - (p.ts || 0) > PENDING_MS) return;
    chrome.storage.local.remove("slackInvitePending"); // consume once
    const contrib = lastContributor();
    if (!contrib) {
      MXMLog.log("[MxM ST] slack: could not read the last contributor from this page");
      return;
    }
    MXMLog.log("[MxM ST] slack: last contributor's profile:", contrib.url, "|", contrib.name);
    chrome.storage.sync.get(["slackTypeformUrl", "reportName", "reportEmail"], (s) => {
      let url = (s.slackTypeformUrl || "").trim() || DEFAULT_TYPEFORM_URL;
      // Prefill name+email via query params: skips the shared initial screen →
      // resolves the "email step" that used to stall the flow.
      const name = (s.reportName || "").trim();
      const email = (s.reportEmail || "").trim();
      if (name || email) {
        const params = new URLSearchParams();
        if (name) params.set("name", name);
        if (email) params.set("email", email);
        params.set("typeform-source", "community-task-manager.replit.app");
        url += (url.includes("?") ? "&" : "?") + params.toString();
      }
      chrome.storage.local.set({ slackInviteProfile: { ...contrib, ts: Date.now() } }, () => {
        chrome.runtime.sendMessage({ action: "openTab", url });
        // This intermediate tab has done its job: close it (the payload travels via storage).
        setTimeout(() => chrome.runtime.sendMessage({ action: "closeThisTab" }), 1200);
      });
    });
  });
})();
