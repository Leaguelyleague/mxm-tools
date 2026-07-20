// =============================================================================
// gemini-inject.js — The ONLY content script on gemini.google.com.
// Merges the two flows:
//
//   A) TRANSCRIBER (Song → Gem): the background left a PER-TAB payload in
//      chrome.storage.session ("gemPayload_<tabId>"). Pastes the video URL,
//      sends it and, when the Gem "is thinking", pastes the duration WITHOUT
//      sending.
//
//   B) CONTRIBUTOR MESSAGE: Studio publishes an ephemeral GLOBAL payload in
//      chrome.storage.local ("geminiPayload", ts < 2 min). Pastes the prompt and
//      sends it, with a clipboard fallback.
//
// Disambiguation: on load it sends GEM_READY; if the background responds with
// this tab's payload it runs flow A and polls nothing else. Only if the response
// is null does it poll geminiPayload (flow B). So a tab opened by the transcriber
// never consumes the message prompt, and vice versa.
//
// NOTE: this page enforces Trusted Types → NEVER use innerHTML here; only
// createElement/textContent/style.cssText.
// =============================================================================

(() => {
  if (window.__mxmSTGeminiInject) return;
  window.__mxmSTGeminiInject = true;

  const t = (k, p) => window.MXMI18n.t(k, p);

  // ── Selectors (semantic cascades; Angular's classes rotate) ────────────────
  const INPUT_SELECTORS = [
    "rich-textarea .ql-editor",
    "div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "textarea",
  ];
  const SEND_SELECTORS = [
    "button.send-button",
    "button[aria-label*='Send' i]",
    "button[aria-label*='Enviar' i]",
    "button[mattooltip*='Send' i]",
    "button[mattooltip*='Enviar' i]",
  ];
  // "Stop" button that appears while the Gem generates the answer (flow A: the
  // signal that the duration can now be pasted).
  const STOP_SELECTORS = [
    "button.stop",
    "button[aria-label*='Stop' i]",
    "button[aria-label*='Detener' i]",
    "button[aria-label*='Cancel' i]",
    "button[mattooltip*='Stop' i]",
    "button[mattooltip*='Detener' i]",
  ];

  // Model responses (flow C: lyrics review). Semantic cascade: Gemini's custom
  // elements are stable across deploys; the classes are not.
  const RESPONSE_SELECTORS = [
    "model-response .markdown",
    "message-content .markdown",
    "model-response",
    "message-content",
    ".model-response-text",
  ];

  // Model selector: defensive cascade anchors (custom elements / aria / roles),
  // NEVER hashed classes.
  const MODEL_TRIGGER_SELECTORS = [
    "bard-mode-switcher button",
    "button[data-test-id='bard-mode-menu-button']",
    "button[aria-haspopup='menu'][aria-label*='model' i]",
    "button[aria-label*='model' i]",
    "button[mattooltip*='model' i]",
  ];
  const MODEL_ITEM_SELECTORS = [
    "[role='menuitemradio']",
    "[role='menuitem']",
    "button.mat-mdc-menu-item",
    ".mode-switch-option",
  ];

  const POLL_MS = 300;
  const TIMEOUT_MS = 20000;
  const REVIEW_TIMEOUT_MS = 90000; // the correction can take a while (long lyrics)

  // Per-feature config for auto-Flash (all three default ON).
  let flashAuto = { transcriptor: true, message: true, review: true };
  chrome.storage.local.get(
    { gemFlashAuto_transcriptor: true, gemFlashAuto_message: true, gemFlashAuto_review: true },
    (d) => {
      flashAuto = {
        transcriptor: d.gemFlashAuto_transcriptor !== false,
        message: d.gemFlashAuto_message !== false,
        review: d.gemFlashAuto_review !== false,
      };
    }
  );
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local") return;
    if (c.gemFlashAuto_transcriptor) flashAuto.transcriptor = c.gemFlashAuto_transcriptor.newValue !== false;
    if (c.gemFlashAuto_message) flashAuto.message = c.gemFlashAuto_message.newValue !== false;
    if (c.gemFlashAuto_review) flashAuto.review = c.gemFlashAuto_review.newValue !== false;
  });

  // ── Shared helpers ──────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  const isEnabled = (b) => b && !b.disabled && b.getAttribute("aria-disabled") !== "true"
    && b.getBoundingClientRect().width > 0;

  // Robust "send" button: the SEND_SELECTORS aria-labels are only in
  // English/Spanish → it broke with Gemini in another language. Cascade:
  // 1) stable send-button class; 2) aria-label in several languages
  // (reinforcement, not exhaustive); 3) structural via the "send" mat-icon.
  // Enter is the last-resort net in the flows that use it.
  const ARIA_SEND_RX = /send|enviar|envoyer|invia|senden|отправить|送信|보내기|发送|傳送|gönder|verzenden|wyślij|إرسال|gửi|ส่ง|kirim/i;
  function findSendButton() {
    for (const sel of SEND_SELECTORS) { const b = document.querySelector(sel); if (isEnabled(b)) return b; }
    for (const b of document.querySelectorAll("button[aria-label]")) {
      if (isEnabled(b) && ARIA_SEND_RX.test(b.getAttribute("aria-label") || "")) return b;
    }
    for (const ic of document.querySelectorAll("mat-icon")) {
      const name = (ic.getAttribute("data-mat-icon-name") || ic.textContent || "").trim().toLowerCase();
      if (name === "send") { const b = ic.closest("button"); if (isEnabled(b)) return b; }
    }
    return null;
  }

  // ── Auto-Flash ────────────────────────────────────────────────────────────
  // Picks the highest numeric-version Flash model (3.5 > 3.1; robust to 4.x),
  // NEVER Pro. Best-effort: if there is no picker or it fails, it continues
  // without changing the model and does not block the flow.
  function pickHighestFlash(items) {
    let best = null, bestV = -Infinity;
    for (const el of items) {
      const txt = (el.innerText || el.textContent || "").trim();
      if (!/flash/i.test(txt) || /\bpro\b/i.test(txt)) continue;
      const m = txt.match(/(\d+(?:\.\d+)?)/);
      const v = m ? parseFloat(m[1]) : 0;
      if (v > bestV) { bestV = v; best = el; }
    }
    return best;
  }
  async function ensureFlashModel() {
    try {
      const trigger = firstMatch(MODEL_TRIGGER_SELECTORS);
      if (!trigger) { MXMLog.log("[MxM ST] flash: could not find the model selector"); return; }
      trigger.click();
      const items = await waitFor(() => {
        for (const sel of MODEL_ITEM_SELECTORS) {
          const els = document.querySelectorAll(sel);
          if (els.length) return Array.from(els);
        }
        return null;
      }, 2500).catch(() => null);
      if (!items) { MXMLog.log("[MxM ST] flash: the models menu did not open"); return; }
      const flash = pickHighestFlash(items);
      if (flash) { flash.click(); MXMLog.log("[MxM ST] flash: model chosen ->", (flash.innerText || "").trim()); }
      else { MXMLog.log("[MxM ST] flash: no Flash option in the menu; not changing"); try { trigger.click(); } catch (_) {} }
      await sleep(300);
    } catch (e) {
      MXMLog.log("[MxM ST] flash: error, continuing without changing the model", e);
    }
  }

  function waitFor(getter, timeout) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const v = getter();
        if (v) return resolve(v);
        if (Date.now() - start > timeout) return reject(new Error("timeout"));
        setTimeout(tick, POLL_MS);
      };
      tick();
    });
  }

  // Robust insertion: execCommand fires the Angular/Quill bindings and is not a
  // Trusted Types sink. Selects everything first (replaces the content).
  function insertInto(input, text, replace) {
    input.focus();
    if (replace && input.tagName !== "TEXTAREA") {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      if (input.tagName === "TEXTAREA") {
        input.value = text;
      } else {
        input.textContent = text;
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    }
  }

  function banner(msg, promptText) {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:16px;" +
      "background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;max-width:80vw;";
    const span = document.createElement("span");
    span.textContent = msg;
    bar.appendChild(span);
    if (promptText) {
      const b = document.createElement("button");
      b.textContent = t("banner.copyAgain");
      b.style.cssText = "flex:none;background:#1A73E8;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:600;";
      b.addEventListener("click", () => {
        navigator.clipboard.writeText(promptText);
        span.textContent = t("banner.copied");
      });
      bar.appendChild(b);
    }
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 20000);
  }

  // ── Flow A: transcriber (Song → Gem) ────────────────────────────────────────
  async function runTranscriptor(message, delay, duration) {
    // Give the Gem page a few seconds to load its context and instructions
    // BEFORE typing the URL and sending.
    if (delay > 0) await sleep(delay);
    let input;
    try {
      input = await waitFor(() => firstMatch(INPUT_SELECTORS), TIMEOUT_MS);
    } catch (e) {
      MXMLog.warn("[Song→Gem] could not find the Gem input:", e);
      return;
    }

    // 0) Auto-Flash before typing: picking the model does NOT clobber the empty
    //    input; doing it first avoids losing already-typed text.
    if (flashAuto.transcriptor) await ensureFlashModel();

    // 1) Type the URL and send it.
    insertInto(input, message, false);
    try {
      const btn = await waitFor(() => findSendButton(), 6000);
      btn.click();
    } catch (_) {
      // Last-resort fallback: simulate Enter.
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
      );
    }

    // 2) When the Gem starts generating, paste the duration WITHOUT sending
    //    (it stays typed for you to send).
    if (duration) {
      try {
        await waitFor(() => firstMatch(STOP_SELECTORS), 8000);
      } catch (_) {
        await sleep(1500);
      }
      const field = firstMatch(INPUT_SELECTORS) || input; // the editor may be recreated
      insertInto(field, duration, false);
    }
  }

  // ── Flow C: lyrics review ───────────────────────────────────────────────────
  // Pastes the message with the lyrics, sends it, waits for the Gem to FINISH
  // generating (the stop button appears then disappears + a stable answer in two
  // reads) and copies the full answer to the clipboard.
  function lastResponseText() {
    for (const sel of RESPONSE_SELECTORS) {
      const els = document.querySelectorAll(sel);
      if (els.length) {
        const txt = (els[els.length - 1].innerText || "").trim();
        if (txt) return txt;
      }
    }
    return "";
  }

  async function runReview(message, delay) {
    if (delay > 0) await sleep(delay);
    let input;
    try {
      input = await waitFor(() => firstMatch(INPUT_SELECTORS), TIMEOUT_MS);
    } catch (_) {
      banner(t("banner.noEditor"), message);
      return;
    }
    if (flashAuto.review) await ensureFlashModel();
    insertInto(input, message, true);
    await sleep(400);
    const len = (input.tagName === "TEXTAREA" ? input.value : input.textContent || "").length;
    if (len < message.length * 0.9) {
      banner(t("banner.pasteFailed"), message);
      return;
    }
    const baseline = lastResponseText(); // previous answer (if the chat already had one)
    const sent = await trySendMessage();
    if (!sent) {
      banner(t("banner.sendFailed"), message);
      return;
    }
    banner(t("banner.reviewWaiting"));

    // End of generation: the stop button appears and then disappears. If we
    // never saw it appear (very fast answer), a new answer is enough.
    try { await waitFor(() => firstMatch(STOP_SELECTORS), 15000); } catch (_) {}
    try {
      await waitFor(() => (firstMatch(STOP_SELECTORS) ? null : true), REVIEW_TIMEOUT_MS);
    } catch (_) {
      banner(t("banner.reviewTimeout"));
      return;
    }

    // New and stable answer (two equal reads in a row).
    let text = "";
    try {
      text = await waitFor(() => {
        const now = lastResponseText();
        return now && now !== baseline ? now : null;
      }, 15000);
    } catch (_) {}
    if (text) {
      for (let i = 0; i < 10; i++) {
        await sleep(800);
        const now = lastResponseText();
        if (now === text) break;
        text = now;
      }
    }
    if (!text) {
      banner(t("banner.reviewNoAnswer"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      banner(t("banner.reviewCopied"), text);
    } catch (_) {
      // Background tab: the clipboard requires focus. It is copied automatically
      // as soon as the user brings the tab to the front; meanwhile, the banner
      // offers to re-copy by hand.
      banner(t("banner.reviewCopyFailed"), text);
      const tryCopy = async () => {
        try {
          await navigator.clipboard.writeText(text);
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("focus", tryCopy);
          banner(t("banner.reviewCopied"), text);
        } catch (_) {}
      };
      const onVis = () => { if (!document.hidden) tryCopy(); };
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("focus", tryCopy);
    }
  }

  // ── Flow B: contributor message ─────────────────────────────────────────────
  async function runMessage(prompt) {
    // Backup copy with the new tab already focused.
    navigator.clipboard.writeText(prompt).catch(() => {});

    let editor = null;
    try {
      editor = await waitFor(() => firstMatch(INPUT_SELECTORS), 16000);
    } catch (_) {}
    if (!editor) {
      banner(t("banner.noEditor"), prompt);
      return;
    }
    if (flashAuto.message) await ensureFlashModel();
    insertInto(editor, prompt, true);
    await sleep(400);
    // Do not send if the paste did not go in completely.
    const len = (editor.tagName === "TEXTAREA" ? editor.value : editor.textContent || "").length;
    if (len < prompt.length * 0.9) {
      banner(t("banner.pasteFailed"), prompt);
      return;
    }
    const sent = await trySendMessage();
    if (!sent) banner(t("banner.sendFailed"), prompt);
  }

  async function trySendMessage() {
    let btn = null;
    try {
      btn = await waitFor(() => findSendButton(), 5000); // enabled once it registers the text
    } catch (_) {}
    if (!btn) return false;
    btn.click();
    return true;
  }

  // Polling of the global payload (flow B): every 300 ms up to 15 s. Stale
  // payloads (> 2 min) are discarded so a reloaded tab does not consume an old
  // prompt.
  function pollMessagePayload() {
    let polls = 0;
    const timer = setInterval(() => {
      chrome.storage.local.get("geminiPayload", (d) => {
        const p = d.geminiPayload;
        if (p && Date.now() - (p.ts || 0) < 120000) {
          clearInterval(timer);
          chrome.storage.local.remove("geminiPayload"); // consume once
          runMessage(p.prompt);
        } else if (++polls >= 50) {
          clearInterval(timer);
        }
      });
    }, 300);
  }

  // ── Startup: first the per-tab payload; if none, the global one ────────────
  chrome.runtime.sendMessage({ type: "GEM_READY" }, (resp) => {
    if (chrome.runtime.lastError) return; // no background: do nothing
    if (resp && resp.kind === "review") {
      runReview(resp.message, resp.delay ?? 3000);
    } else if (resp && resp.message) {
      runTranscriptor(resp.message, resp.delay ?? 3000, resp.duration || "");
    } else {
      pollMessagePayload();
    }
  });
})();
