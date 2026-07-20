// =============================================================================
// compare.js — Lyrics comparison.
//
// - Captures the ORIGINAL when the task OPENS (once per taskId, with an
//   anti-hydration stability wait) → storage.local "baseline:<taskId>".
// - Manual save and status from the popup (baselineStatus / manualBaseline
//   messages).
// - Floating-button actions (exposed on window.MXMCompare):
//     doCompare        → Diffchecker or built-in view (diff.html), per diffMode.
//     doGeminiMessage  → contributor message via the Gem (messageGemUrl).
//     doChain          → all-in-one: saved diff + link + Gem.
//
// Uses window.MXMCore (helpers/selectors) and window.MXMButtons (toasts).
// Tabs are opened via the background (openTab) respecting the per-button
// background config (btnTabConfig, storage.sync).
// =============================================================================

(function () {
  "use strict";

  if (window.__mxmSTCompareInjected) return;
  window.__mxmSTCompareInjected = true;

  const core = window.MXMCore;
  const ui = window.MXMButtons;
  const t = (k, p) => window.MXMI18n.t(k, p);

  const { sleep, waitFor, findByText, getTaskId, getSongInfo, getLyricsEl,
          getTranscriptTextarea, getTaskMeta } = core;

  // After confirming the original capture, show the last contributor.
  // getTaskMeta caches per task; the FIRST time it opens and closes the ⋯ menu
  // and the history modal on its own (~3s) — that is the only source of the data.
  async function announceContributor(taskId) {
    // The contributor auto-check on task open can be turned off (it opens the ⋯
    // modal for ~5s, which is intrusive). With OFF nothing automatic happens;
    // the manual contributor button still works separately.
    const auto = await new Promise((r) => chrome.storage.local.get("contributorAutoCheck", (d) => r(d.contributorAutoCheck !== false))); // default ON
    if (!auto) return;
    await sleep(4800); // let the capture toast be read first
    if (getTaskId() !== taskId) return; // navigated to another task meanwhile
    const meta = await getTaskMeta(taskId);
    if (getTaskId() !== taskId) return;
    // Name + role in parentheses: "Someone (Curator)", etc.
    const shown = meta.contributor
      ? (meta.contributorRole ? `${meta.contributor} (${meta.contributorRole})` : meta.contributor)
      : null;
    const msg = shown ? t("toast.contributor", { name: shown })
      : meta.contributor === "" ? t("toast.contributorEmpty")
      : t("toast.contributorNone");
    statusToast(msg, 5000);
    // Fixed contributor label bottom-right, if the toggle is ON (default). null
    // (error) shows nothing; "" = no contributions.
    chrome.storage.local.get("contributorFixedLabel", (d) => {
      if (d.contributorFixedLabel === false || getTaskId() !== taskId || meta.contributor == null) return;
      const who = meta.contributor === "" ? t("label.noContributor") : meta.contributor;
      let text = who; // the hover tooltip clarifies it is the contributor
      if (meta.contributor && meta.contributorRole) text += " (" + meta.contributorRole + ")";
      ui.setContributorLabel(text, t("label.lastContributorHint"));
    });
  }

  // Opens a URL in a new tab via the background, respecting the
  // foreground/background config of the button that triggered it (default:
  // background).
  function openTab(url, btnKey) {
    chrome.storage.sync.get("btnTabConfig", (d) => {
      const cfg = (d.btnTabConfig || {})[btnKey] || {};
      chrome.runtime.sendMessage({ action: "openTab", url, background: cfg.background !== false });
    });
  }

  // ── "Draft found" banner detection (restored draft) ──
  // If MxM offers to restore a draft when the task opens, the textarea may show
  // previous edits instead of the clean original; the baseline is flagged.
  let draftSeen = false;
  let draftWatchTimer = null;
  function watchDraftModal() {
    draftSeen = false;
    if (draftWatchTimer) clearInterval(draftWatchTimer);
    const t0 = Date.now();
    const i18n = window.MXMStudioI18n;
    const draftRx = (i18n && i18n.STR.draft_title) ? i18n.rx("draft_title") : /draft/i;
    draftWatchTimer = setInterval(() => {
      if (findByText(draftRx)) {
        draftSeen = true;
        MXMLog.log("[MxM ST] Draft banner detected: the original may include previous edits");
        clearInterval(draftWatchTimer);
      } else if (Date.now() - t0 > 30000) {
        clearInterval(draftWatchTimer);
      }
    }, 700);
  }

  function statusToast(msg, ms) {
    ui.showToast("compare", msg, ms);
  }

  function saveBaseline(taskId, text, done) {
    const { song, artist } = getSongInfo();
    const entry = { text, song, artist, restored: draftSeen, ts: Date.now() };
    chrome.storage.local.set({ ["baseline:" + taskId]: entry }, () => done && done(entry));
  }

  // captureGen invalidates pending captures when navigating to another task URL
  // (or out of a task) mid-wait: avoids saving one task's lyrics under another
  // task's taskId.
  let lastTaskId = null;
  let captureGen = 0;

  async function captureOnOpen(taskId, gen) {
    const key = "baseline:" + taskId;
    const existing = await new Promise((r) => chrome.storage.local.get(key, (d) => r(d[key])));
    if (gen !== captureGen) return;
    if (existing) {
      MXMLog.log("[MxM ST] open | taskId:", taskId, "| original already saved (ts:", existing.ts, ") — kept");
      statusToast(existing.restored ? t("toast.alreadySavedRestored") : t("toast.alreadySaved"), 4000);
      announceContributor(taskId);
      return;
    }
    statusToast(t("toast.capturing"), 2500);
    // 1) Wait for the Transcript textarea to appear VISIBLE and with content.
    const found = await waitFor(() => {
      const el = getTranscriptTextarea(true);
      return el && el.value.trim() ? el : null;
    }, 30000);
    if (gen !== captureGen) return;
    if (!found) {
      MXMLog.log("[MxM ST] CAPTURE FAILED | taskId:", taskId, "| no textarea with lyrics after 30s");
      statusToast(t("toast.captureFailed"), 8000);
      return;
    }
    // 2) Anti-hydration stability: wait for two equal reads in a row.
    let text = found.value;
    for (let i = 0; i < 10; i++) {
      await sleep(700);
      if (gen !== captureGen) return;
      const ta = getTranscriptTextarea(true);
      const now = ta ? ta.value : text;
      if (now === text) break;
      text = now;
    }
    if (!text.trim()) {
      MXMLog.log("[MxM ST] CAPTURE FAILED | taskId:", taskId, "| lyrics ended up empty after stabilizing");
      statusToast(t("toast.captureFailed"), 8000);
      return;
    }
    // 3) Re-check that there is still no baseline (get→set is not atomic) and save.
    const again = await new Promise((r) => chrome.storage.local.get(key, (d) => r(d[key])));
    if (gen !== captureGen || again) return;
    MXMLog.log(
      "[MxM ST] CAPTURE (open) | taskId:", taskId,
      "| restored:", draftSeen,
      "| original[0..45]:", JSON.stringify(text.slice(0, 45))
    );
    saveBaseline(taskId, text, (entry) => {
      statusToast(entry.restored ? t("toast.capturedRestored") : t("toast.captured"), 4500);
      announceContributor(taskId);
    });
  }

  // ── Manual save + status, requested from the extension popup ──
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === "baselineStatus") {
      const taskId = getTaskId();
      if (!taskId) { sendResponse({ exists: false, error: "notTask" }); return; }
      chrome.storage.local.get("baseline:" + taskId, (d) => {
        const b = d["baseline:" + taskId];
        sendResponse(b ? { exists: true, ts: b.ts, song: b.song } : { exists: false });
      });
      return true; // async response
    }
    if (msg && msg.action === "manualBaseline") {
      const taskId = getTaskId();
      if (!taskId) { sendResponse({ ok: false, reason: "notTask" }); return; }
      // Prefer the visible textarea; if not (e.g. you are on Time-sync), accept
      // the hidden Transcript one (the same live element with the current lyrics).
      const ta = getTranscriptTextarea(true) || getTranscriptTextarea(false) || getLyricsEl();
      if (!ta || !ta.value.trim()) {
        sendResponse({ ok: false, reason: "noLyrics" });
        return;
      }
      const text = ta.value;
      MXMLog.log("[MxM ST] CAPTURE (manual from popup) | taskId:", taskId,
        "| original[0..45]:", JSON.stringify(text.slice(0, 45)));
      saveBaseline(taskId, text, (entry) => sendResponse({ ok: true, song: entry.song }));
      return true; // async response
    }
  });

  // ── Compare action ──
  async function doCompare(entry) {
    const taskId = getTaskId();
    if (!taskId) { ui.showToast(entry, t("toast.notTask")); return; }
    // Tab-guard: if we are on Time-sync/Structure/etc., jump to Transcript and
    // read the FULL lyrics. It used to use getLyricsEl() directly and on
    // Time-sync captured a single synchronization line.
    if (!core.isOnTranscript()) {
      ui.showToast(entry, t("toast.switchingToLyrics"));
      const ok = await core.ensureTranscript();
      if (!ok) { ui.showToast(entry, t("toast.notTask")); return; }
    }
    const ta = getTranscriptTextarea(true) || getTranscriptTextarea(false) || getLyricsEl();
    if (!ta) { ui.showToast(entry, t("toast.notTask")); return; }
    const key = "baseline:" + taskId;
    chrome.storage.local.get([key, "diffMode"], async (data) => {
      const base = data[key];
      if (!base) { ui.showToast(entry, t("toast.noBaseline")); return; }
      const mode = data.diffMode || "direct";

      MXMLog.log(
        "[MxM ST] doCompare | taskId:", taskId,
        "\n  baseline (original) [0..45]:", JSON.stringify((base.text || "").slice(0, 45)),
        "\n  textarea (edited)   [0..45]:", JSON.stringify((ta.value || "").slice(0, 45)),
        "\n  current title:", document.title
      );

      const meta = await getTaskMeta(taskId); // best-effort, fields may be null
      const { song, artist } = getSongInfo();

      if (mode === "direct") {
        chrome.storage.local.set({
          diffcheckerPayload: {
            left: base.text,
            right: ta.value,
            song, artist,
            contributor: meta.contributor,
            abstrack: meta.abstrack,
            restored: !!base.restored,
          },
        }, () => openTab("https://www.diffchecker.com/", "compare"));
      } else {
        const payload = {
          song, artist, taskId,
          original: base.text,
          edited: ta.value,
          restored: !!base.restored,
          lastContributor: meta.contributor,
          abstrack: meta.abstrack,
          ts: Date.now(),
        };
        chrome.storage.local.set({ comparePayload: payload }, () => {
          openTab(chrome.runtime.getURL("diff.html"), "compare");
        });
      }
    });
  }

  // ── AI message action (Gemini Gem) ──
  // The prompt is a template configurable in Advanced options (same pattern as
  // the transcriber's message_template). `template` comes from the caller from
  // storage.sync (contributorMessageTemplate); DEFAULT_MSG_TEMPLATE is the net
  // if it were empty (it never should be; options.js does not allow saving it
  // empty). The template text is in Spanish because the Gem produces Spanish.
  const DEFAULT_MSG_TEMPLATE = [
    "Contribuyente: {contributor}",
    "Canción: {song} — {artist}",
    "Abstrack: {abstrack}",
    "Firma del curador: {curatorName}",
    "",
    "Escribí el mensaje para este contribuyente, dirigido a él por su nombre, según tus instrucciones.",
    "",
    "=== LETRA ORIGINAL (del contribuyente) ===",
    "{original}",
    "",
    "=== LETRA CORREGIDA (del curador) ===",
    "{edited}",
  ].join("\n");
  function buildGeminiPrompt(p, template) {
    return (template || DEFAULT_MSG_TEMPLATE)
      .replaceAll("{contributor}", p.contributor || "desconocido")
      .replaceAll("{song}", p.song || "")
      .replaceAll("{artist}", p.artist || "")
      .replaceAll("{abstrack}", p.abstrack || "-")
      .replaceAll("{curatorName}", p.curatorName || "")
      .replaceAll("{original}", p.original || "")
      .replaceAll("{edited}", p.edited || "");
  }

  // ── Diffgenie: Diffchecker + Save + diff link + contributor message ──
  // Only makes sense on the LYRICS tab (Transcript): if we are on
  // Time-sync/Structure/etc., it first jumps to Transcript and waits for the
  // lyrics. It opens Diffchecker with the order to save the diff; diffchecker.js
  // captures the saved diff's URL, adds it to the prompt and asks the background
  // to open the Gem.
  async function doDiffgenie(entry) {
    const taskId = getTaskId();
    if (!taskId) { ui.showToast(entry, t("toast.notTask")); return; }

    // Tab-guard: ensure the Transcript section before reading the lyrics.
    if (!core.isOnTranscript()) {
      ui.showToast(entry, t("toast.switchingToLyrics"));
      const ok = await core.ensureTranscript();
      if (!ok) { ui.showToast(entry, t("toast.notTask")); return; }
    }
    const ta = getLyricsEl();
    if (!ta) { ui.showToast(entry, t("toast.notTask")); return; }

    chrome.storage.sync.get(["messageGemUrl", "curatorName", "btnTabConfig", "contributorMessageTemplate"], (syncData) => {
      // The Gem must open in the SAME layer (foreground/background) as the
      // diffgenie button's Diffchecker. Default background.
      const chainBg = ((syncData.btnTabConfig || {}).diffgenie || {}).background !== false;
      chrome.storage.local.get("baseline:" + taskId, async (data) => {
        const base = data["baseline:" + taskId];
        if (!base) { ui.showToast(entry, t("toast.noBaseline")); return; }
        if (!syncData.messageGemUrl) { ui.showToast(entry, t("toast.noGemUrl")); return; }
        ui.showToast(entry, t("toast.openingChain"));

        const meta = await getTaskMeta(taskId, { ensureWebUrl: true }); // Diffgenie: the prompt must carry the web link
        const { song, artist } = getSongInfo();
        const prompt = buildGeminiPrompt({
          song, artist, curatorName: syncData.curatorName,
          contributor: meta.contributor, abstrack: meta.abstrack,
          original: base.text, edited: ta.value,
        }, syncData.contributorMessageTemplate);
        chrome.storage.local.set({
          diffcheckerPayload: {
            left: base.text,
            right: ta.value,
            song, artist,
            contributor: meta.contributor,
            abstrack: meta.abstrack,
            restored: !!base.restored,
            chain: { geminiPrompt: prompt, gemUrl: syncData.messageGemUrl, background: chainBg, webUrl: meta.webUrl },
          },
        }, () => openTab("https://www.diffchecker.com/", "diffgenie"));
      });
    });
  }

  window.MXMCompare = { doCompare, doDiffgenie };

  // ── Task OPEN detection ──
  // "A task opened" = the taskId in the URL changed (includes the initial load
  // and coming back from the list). Switching sections within the same task
  // keeps the same taskId → no re-capture.
  function onUrlChange() {
    // Only capture in the EDITOR (/tool). getTaskId() also returns a value on
    // the LIST (/tasks/<hash>/…), where nothing should be captured or toasted.
    const id = core.isTaskEditorPage() ? getTaskId() : null;
    if (id === lastTaskId) return;
    lastTaskId = id;
    captureGen++; // invalidates any pending capture from the previous task
    if (!id) return;
    watchDraftModal();
    captureOnOpen(id, captureGen);
  }

  onUrlChange();

  // SPA: re-evaluate on URL change (single dispatcher in mxm-core).
  core.onNavigate(onUrlChange);
})();
