(function () {
  // Diffchecker's text-comparison page is the root (/) and uses CodeMirror 6.
  const t = (k, p) => window.MXMI18n.t(k, p);

  chrome.storage.local.get("diffcheckerPayload", (d) => {
    const p = d.diffcheckerPayload;
    if (!p) return;
    chrome.storage.local.remove("diffcheckerPayload"); // consume once
    waitForEditors(p);
  });

  // Waits for CM6 to mount the two contenteditable editors. The aria-label is in
  // English; if Diffchecker is shown in another language it changes, so there is
  // a POSITIONAL fallback: 1st .cm-content = original, 2nd = edited.
  function findEditors() {
    let left = document.querySelector('.cm-content[aria-label="Original text input"]');
    let right = document.querySelector('.cm-content[aria-label="Changed text input"]');
    if (left && right) return [left, right];
    const all = document.querySelectorAll(".cm-content");
    if (all.length >= 2) return [all[0], all[1]];
    return [null, null];
  }
  function waitForEditors(p, tries = 0) {
    const [leftEl, rightEl] = findEditors();
    if (leftEl && rightEl) {
      fillEditor(leftEl, p.left);
      fillEditor(rightEl, p.right);
      setTimeout(clickFindDifference, 400);
      infoBanner(p);
      if (p.chain) chainFlow(p);
      return;
    }
    if (tries < 40) { setTimeout(() => waitForEditors(p, tries + 1), 400); return; }
    fallbackClipboard(p.left, p.right);
  }

  // Diff name: "Contributor · Song - Artist · Abstrack · YYYY-MM-DD".
  function buildTitle(p) {
    const date = new Date().toISOString().slice(0, 10);
    const parts = [];
    if (p.contributor) parts.push(p.contributor);
    const songArtist = [p.song, p.artist].filter(Boolean).join(" - ");
    if (songArtist) parts.push(songArtist);
    if (p.abstrack) parts.push(String(p.abstrack));
    if (p.restored) parts.push("(Restaurado)");
    parts.push(date);
    return parts.join(" · ");
  }

  function setInputValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Title input of the Save modal (with a fallback in case the testids change):
  // first the known data-testid; otherwise the first text input inside a dialog.
  function getTitleInput() {
    return document.querySelector('input[data-testid="save-diff-modal-title-input"]')
      || document.querySelector('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])');
  }

  // Button that OPENS the Save modal (not the one that confirms inside the modal).
  function getOpenSaveButton() {
    const byTestid = document.querySelector('button[data-testid="save-text-diff-button"]');
    if (byTestid) return byTestid;
    return Array.from(document.querySelectorAll("button"))
      .find((b) => /^save( diff)?$/i.test((b.textContent || "").trim()) && !b.closest('[role="dialog"]')) || null;
  }

  // Opens the "Save" modal and writes the title automatically. The user only
  // picks expiration and confirms Save (we do not press it ourselves). VERIFIES
  // that the title was written (the modal may come pre-filled with a generic
  // default, or React may overwrite the value) and retries until it sticks.
  // Generous retries: the Save button only exists once the diff has finished
  // computing.
  function openSaveAndSetTitle(title, tries = 0) {
    if (tries >= 60) { // ~24s
      MXMLog.log("[MxM ST] diffchecker: could NOT set the diff title (did Diffchecker's DOM change?)");
      notice(t("dc.titleFailed"));
      return;
    }
    const input = getTitleInput();
    if (input) {
      if (input.value === title) {
        MXMLog.log("[MxM ST] diffchecker: diff title set and verified:", title);
        return; // done and verified
      }
      input.focus();
      setInputValue(input, title);
      // Re-check on the next tick that the value stuck (if React overwrites it, retry).
      setTimeout(() => openSaveAndSetTitle(title, tries + 1), 300);
      return;
    }
    const saveBtn = getOpenSaveButton();
    if (saveBtn) saveBtn.click(); // open the modal
    setTimeout(() => openSaveAndSetTitle(title, tries + 1), 400);
  }

  // Info banner + diff name (copied to the clipboard).
  function infoBanner(p) {
    const title = buildTitle(p);
    openSaveAndSetTitle(title);
    navigator.clipboard.writeText(title).catch(() => {});

    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:16px;" +
      "background:#9013FE;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:80vw;display:flex;gap:12px;align-items:center;";
    const span = document.createElement("span");
    span.textContent = t("dc.titleCopied", { title });
    span.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const b = document.createElement("button");
    b.textContent = t("dc.copy");
    b.style.cssText = "flex:none;background:#fff;color:#9013FE;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-weight:600;";
    b.onclick = () => navigator.clipboard.writeText(title);
    bar.appendChild(span); bar.appendChild(b);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 12000);
  }

  // ── Chained flow (all-in-one button): save the diff, capture its URL and fire
  // the Gem with the prompt + link. The Diffchecker app navigates on its own to
  // the saved diff's URL (e.g. /YBMUfBEL/) when Save is confirmed.
  async function chainFlow(p) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, timeoutMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const v = fn();
        if (v) return v;
        await sleep(250);
      }
      return null;
    };
    const fireGemini = (saved) => {
      let prompt = p.chain.geminiPrompt;
      if (saved) prompt += "\n\nIncluí al final del mensaje este link al diff con las correcciones: " + saved;
      if (p.chain.webUrl) prompt += "\n\nY también este link a la letra en la web: " + p.chain.webUrl;
      // The final message must include BOTH links (diff + web) when available.
      navigator.clipboard.writeText(prompt).catch(() => {});
      chrome.storage.local.set({ geminiPayload: { prompt, ts: Date.now() } }, () => {
        chrome.runtime.sendMessage({ action: "openTab", url: p.chain.gemUrl, background: p.chain.background !== false });
        // This tab has done its job: close it so only the Gem remains. The prompt
        // travels via storage.local, so it does not depend on this tab; the delay
        // gives openTab some margin.
        setTimeout(() => chrome.runtime.sendMessage({ action: "closeThisTab" }), 1500);
      });
    };

    // 1) Wait for the Save modal to be open with OUR title already set
    //    (openSaveAndSetTitle writes it). NOTE: require the EXACT title — the
    //    modal may come pre-filled with a generic default, and "any non-empty
    //    value" used to save it under that name.
    const title = buildTitle(p);
    let titled = await waitFor(() => {
      const el = getTitleInput();
      return el && el.value === title ? el : null;
    }, 20000);
    if (!titled) {
      // Last attempt: if the modal is open, write the title right here.
      const el = getTitleInput();
      if (el) {
        el.focus();
        setInputValue(el, title);
        await sleep(600);
        if (el.value === title) titled = el;
      }
    }
    if (!titled) { notice(t("dc.noModal")); fireGemini(null); return; }

    // 2) Confirm Save (expiration stays at "Never", the default).
    const saveBtn = document.querySelector('button[data-testid="save-diff-modal-save-button"]')
      || Array.from(document.querySelectorAll('[role="dialog"] button'))
           .find((b) => /^save$/i.test((b.textContent || "").trim()));
    if (!saveBtn) { notice(t("dc.noSaveBtn")); fireGemini(null); return; }
    MXMLog.log("[MxM ST] diffchecker: saving diff with title:", title);
    saveBtn.click();

    // 3) Wait for the saved diff's URL (slug at the root, never /unsaved/...).
    const saved = await waitFor(() => {
      const m = location.pathname.match(/^\/(?!unsaved)([A-Za-z0-9_-]{6,})\/?$/);
      return m ? location.href : null;
    }, 20000);
    if (!saved) notice(t("dc.notSaved"));

    fireGemini(saved);
  }

  function notice(msg) {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:16px;" +
      "background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:80vw;";
    bar.textContent = msg;
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 10000);
  }

  // Writes text into a CM6 contenteditable via execCommand (fires the
  // beforeinput/input events CodeMirror listens to in order to update its state).
  function fillEditor(el, text) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertText", false, text);
  }

  function clickFindDifference() {
    const btn = Array.from(document.querySelectorAll('button[type="submit"]'))
      .find((b) => /find difference/i.test(b.textContent || ""));
    if (btn) btn.click();
  }

  function fallbackClipboard(left, right) {
    navigator.clipboard.writeText(left).catch(() => {});
    banner(t("dc.fallbackLeft"), right);
  }

  function banner(msg, rightText) {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);top:16px;" +
      "background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;";
    const span = document.createElement("span"); span.textContent = msg;
    const b = document.createElement("button");
    b.textContent = t("dc.copyEdited");
    b.style.cssText = "background:#9013FE;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;";
    b.onclick = () => { navigator.clipboard.writeText(rightText); span.textContent = t("dc.editedCopied"); };
    bar.appendChild(span); bar.appendChild(b);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 15000);
  }
})();
