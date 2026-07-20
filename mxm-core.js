// =============================================================================
// MxM Tools — Shared utilities for Musixmatch Studio
//
// Brings together the shared helpers used across the extension. Exposes
// window.MXMCore. Injected after mxm-i18n.js and before the feature content
// scripts.
//
// Studio's fragile DOM selectors live as constants at the top: if Musixmatch
// redesigns its UI, they are adjusted there.
// =============================================================================

(function () {
  "use strict";

  if (window.MXMCore) return;

  // ── Centralized fragile selectors ───────────────────────────────────────
  // path of the ⋯ (three dots) icon of Studio menus.
  const DOTS_PATH_PREFIX = "M8 12c0 1.1-.9 2-2 2";
  // List of ⋯ prefixes to tolerate a redeploy that changes the path: they are
  // tried in order (old first). If MxM changes the icon, add the new prefix
  // here without deleting the old one.
  const DOTS_PATH_PREFIXES = [DOTS_PATH_PREFIX];
  // path of the X icon that closes Studio modals.
  const CLOSE_X_PATH_PREFIX = "M18.295,7.115";
  // path of the header ⓘ icon (circle with "i"), opens "Track info".
  // (anchored on the editor's real HTML).
  const INFO_PATH_PREFIX = "M12 2C6.486 2 2 6.486 2 12";
  // SVG path prefixes of the header ⋯ menu items. The item's TEXT changes with
  // Studio's language; the icon does NOT.
  // It is the primary i18n-proof anchor of clickHeaderMenuItem; MXMStudioI18n's
  // multi-language text is the fallback. Each key is a LIST of prefixes
  // (old + new) to tolerate a redeploy: add the new one at the front without
  // deleting the old one.
  const MENU_ICON_PREFIX = {
    find_replace: ["M11.024 11.631l7.972-7.944"],
    contribution_history: ["M13.7 8.6v3.6l3 1.8c.2.1.3"],
    instrumental: ["M4.9 11.3v1.4a1.3 1.3 0 1"],
    restart_sync: ["M17 7l1.4.1c-.7-.9-1.7-1.7"],
  };
  // Editor containers used by the title/artist heuristic.
  const EDITOR_CONTAINER_SELECTORS = ['div[class*="r-1pi2tsx"]', 'div[class*="r-13awgt0"]'];
  // React Native Web clickable elements class.
  const CLICKABLE_SEL = '[tabindex], button, [class*="r-1otgn73"]';
  // Title/metadata/artist of a task-list CARD (single source — highlighter.js
  // and mxm_menu.js each used to have their own identical copy of these 3
  // selectors).
  const CARD_TITLE_SEL = ".r-1inkyih.r-1kfrs79";
  const CARD_META_SEL = ".r-dd0y9b";
  const CARD_ARTIST_SEL = ":scope > div.r-a023e6";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Is the element REALLY visible? getClientRects (discards display:none and
  // detached) + the ancestor chain (visibility/display/opacity). Needed because
  // Studio's SPA leaves HIDDEN clones of the controls in the DOM — e.g. the
  // mission list with one ⋯ per card, many with negative top (off-viewport).
  // Without this filter, findHeaderDotsButton grabbed a ghost ⋯ and the menu
  // never opened (the ⋯ menu bug).
  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  }

  // Waits until predicate() returns something truthy (or null on timeout).
  async function waitFor(predicate, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = predicate();
      if (v) return v;
      await sleep(120);
    }
    return null;
  }

  // Synthetic click React listens to (bubbling pointer + mouse events).
  function fireClick(el) {
    for (const t of ["pointerdown", "pointerup", "click"]) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }

  // FULL synthetic click (pointer + mouse with coordinates). Some Studio
  // controls (section tabs, modal Xs) ignore the short sequence of the
  // fireClick and require mousedown/mouseup with clientX/Y.
  function fireClickFull(el, clientX, clientY) {
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: clientX != null ? clientX : r.left + r.width / 2,
      clientY: clientY != null ? clientY : r.top + r.height / 2,
    };
    for (const [Ctor, type] of [
      [PointerEvent, "pointerdown"], [MouseEvent, "mousedown"],
      [PointerEvent, "pointerup"], [MouseEvent, "mouseup"], [MouseEvent, "click"],
    ]) {
      el.dispatchEvent(new Ctor(type, opts));
    }
  }

  // Finds the VISIBLE element whose text matches (exact string or RegExp).
  function findByText(matcher) {
    const els = document.querySelectorAll('div[dir="auto"], span');
    for (const e of els) {
      const t = e.textContent.trim();
      const ok = matcher instanceof RegExp ? matcher.test(t) : t === matcher;
      if (ok && e.offsetParent !== null) return e;
    }
    return null;
  }

  // ── Task id: UNIQUE per-task identifier from the query params ──────────
  function getTaskId() {
    // The /tool editor carries the id in the query. `task_id` is unique per
    // task; `commontrack_id` identifies the track. NOTE: do NOT use
    // `mission_id` or a generic hex regex: `mission_id` is the BATCH id, shared
    // by all tasks of the same batch -> shared baseline -> compares against the
    // previous task's lyrics.
    const p = new URLSearchParams(location.search);
    const id = p.get("task_id") || p.get("commontrack_id");
    if (id) return id;
    // Fallbacks for other editor views.
    const parts = location.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("tasks");
    if (i !== -1 && parts[i + 1]) return parts[i + 1];
    const m = location.href.match(/[0-9a-f]{32,}/i);
    return m ? m[0] : null;
  }

  // ── Title/artist: cascade title → DOM heuristic → __NEXT_DATA__ ─────────
  function getSongInfo() {
    const title = document.title;
    const m1 = title.match(/^(.+?)\s*·\s*(.+?)\s*-\s*Musixmatch/);
    if (m1) return { song: m1[1].trim(), artist: m1[2].trim() };

    const m2 = title.match(/^(.+?)\s*-\s*(.+?)\s*-\s*Musixmatch/);
    if (m2) return { song: m2[1].trim(), artist: m2[2].trim() };

    // DOM heuristic: the title is the bold div[dir=auto] near the editor; the
    // artist, the next one without bold.
    const textarea = document.querySelector("textarea");
    if (textarea) {
      let container = null;
      for (const sel of EDITOR_CONTAINER_SELECTORS) {
        container = textarea.closest(sel);
        if (container) break;
      }
      if (container) {
        const titles = container.querySelectorAll('div[dir="auto"]');
        for (let i = 0; i < titles.length; i++) {
          const el = titles[i];
          const cs = window.getComputedStyle(el);
          const fw = parseInt(cs.fontWeight);
          const fs = parseFloat(cs.fontSize);
          if (fw >= 600 && fs >= 16) {
            const song = el.textContent.trim();
            for (let j = i + 1; j < titles.length; j++) {
              const a = titles[j];
              const afw = parseInt(window.getComputedStyle(a).fontWeight);
              if (afw < 600 && a.textContent.trim()) {
                return { song, artist: a.textContent.trim() };
              }
            }
            return { song, artist: "Sin artista" };
          }
        }
      }
    }

    // NOTE: in the current Studio pageProps only carries
    // auth/mixpanelProjectToken — this fallback is dead. Kept as harmless.
    // si Musixmatch vuelve a exponer trackName/artistName; es inofensivo.
    const nextData = document.getElementById("__NEXT_DATA__");
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        const query = data?.props?.pageProps;
        if (query?.trackName && query?.artistName) {
          return { song: query.trackName, artist: query.artistName };
        }
      } catch (e) {}
    }

    const m5 = title.match(/^(.+?)\s*-\s*Musixmatch/);
    if (m5) return { song: m5[1].trim(), artist: "Sin artista" };

    return { song: "Sin titulo", artist: "Sin artista" };
  }

  // ── Lyrics textarea ────────────────────────────────────────────────────
  // Loose: by placeholder and otherwise the first textarea with content. Used
  // to READ the edited lyrics in the actions; do NOT use it to capture the
  // original (on Time-sync there are small per-line textareas that confuse it).
  // Is the placeholder the lyrics textarea's? i18n-proof: matches the 21
  // edit_tool.placeholder variants; if the table is missing, falls to the en/es substring.
  function isLyricsPlaceholder(ph) {
    const i18n = window.MXMStudioI18n;
    if (i18n && i18n.STR.lyrics_placeholder) return i18n.test("lyrics_placeholder", ph);
    const low = (ph || "").toLowerCase();
    return low.includes("lyric") || low.includes("letra");
  }

  function getLyricsEl() {
    const tas = document.querySelectorAll("textarea");
    for (const ta of tas) {
      if (isLyricsPlaceholder(ta.placeholder)) return ta;
    }
    for (const ta of tas) {
      if ((ta.value || "").trim().length > 10) return ta;
    }
    return null;
  }

  // Transcript textarea, ONLY by placeholder. Studio's SPA leaves old panels
  // HIDDEN in the DOM (visibility:hidden): with visibleOnly the active panel is
  // required, so as not to read the stale textarea of another task/section.
  function getTranscriptTextarea(visibleOnly) {
    for (const ta of document.querySelectorAll("textarea")) {
      if (!isLyricsPlaceholder(ta.placeholder)) continue;
      if (visibleOnly) {
        if (!ta.getClientRects().length) continue;
        if (getComputedStyle(ta).visibility === "hidden") continue;
      }
      return ta;
    }
    return null;
  }

  // ── Cierre de modales/overlays de Studio ────────────────────────────────────
  // The modals and the ⋯ menu dropdown live in a position:fixed wrapper that
  // covers the viewport. NOTE: the Time-sync delete-row Xs use the SAME path as
  // the close X — clicking an X outside the overlay used to delete a sync line.
  // A synthetic Escape does not close (isTrusted), so the dropdown (no X) is
  // closed by clicking its backdrop.
  function findFixedOverlay(node) {
    for (let e = node; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).position === "fixed" &&
          e.getBoundingClientRect().width >= window.innerWidth * 0.9) return e;
    }
    return null;
  }

  function closeModal() {
    // 1) Modal: close X INSIDE a full-viewport fixed overlay.
    for (const p of document.querySelectorAll("svg path")) {
      if (!(p.getAttribute("d") || "").startsWith(CLOSE_X_PATH_PREFIX)) continue;
      if (!findFixedOverlay(p)) continue;
      const clickable = p.closest(CLICKABLE_SEL);
      if (clickable) { fireClickFull(clickable); return; }
    }
    // 2) Dropdown with no X: click the overlay's backdrop (trying points away
    //    from the menu box). If there is no overlay, touch nothing.
    for (const [fx, fy] of [[0.15, 0.75], [0.5, 0.9], [0.08, 0.5]]) {
      const x = Math.round(window.innerWidth * fx);
      const y = Math.round(window.innerHeight * fy);
      const target = document.elementFromPoint(x, y);
      if (target && findFixedOverlay(target)) { fireClickFull(target, x, y); return; }
    }
  }

  // ── Are we in a task's editor? ─────────────────────────────────────
  // The editor lives at /tool. getTaskId() by itself does NOT work to gate the
  // UI: it also returns a value in the LIST (/tasks/<hash>/...) due to its path
  // fallback. The floating buttons must use THIS helper.
  function isTaskEditorPage() {
    return location.pathname.startsWith("/tool");
  }

  // ── Open the header ⋯ menu and return its button (to reuse) ────────────
  // top >= 0 discards the hidden clones the SPA leaves above the viewport;
  // isVisible (below, per element) discards the display:none / visibility:hidden ones.
  const inHeaderRight = (r) => r.top >= 0 && r.top < 90 && r.left > window.innerWidth * 0.6 && r.width > 0;
  function findHeaderDotsButton() {
    // 1) By icon path (prefix list: old + new). VISIBLE only: there are dozens
    //    of cloned ⋯ (one per mission-list card) that the SPA leaves hidden in
    //    the DOM; without the filter a ghost one was grabbed.
    for (const prefix of DOTS_PATH_PREFIXES) {
      const btn = Array.from(document.querySelectorAll("svg path"))
        .filter((p) => (p.getAttribute("d") || "").startsWith(prefix))
        .map((p) => p.closest(CLICKABLE_SEL))
        .filter(Boolean)
        .filter((el) => isVisible(el) && inHeaderRight(el.getBoundingClientRect()))[0];
      if (btn) { MXMLog.log("[MxM ST] ⋯ header por path:", prefix.slice(0, 14)); return btn; }
    }
    // 2) Structural fallback (if MxM changed the ⋯ path): the rightmost header
    //    clickable that wraps a small <svg> and is NOT the ⓘ (Track info).
    const cand = Array.from(document.querySelectorAll(CLICKABLE_SEL)).filter((el) => {
      const r = el.getBoundingClientRect();
      if (!isVisible(el) || !inHeaderRight(r) || r.width >= 80) return false;
      const svg = el.querySelector("svg");
      if (!svg) return false;
      const isInfo = Array.from(svg.querySelectorAll("path"))
        .some((p) => (p.getAttribute("d") || "").startsWith(INFO_PATH_PREFIX));
      return !isInfo;
    });
    if (cand.length) {
      const btn = cand.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
      MXMLog.log("[MxM ST] ⋯ header por fallback estructural (ícono más a la derecha)");
      return btn;
    }
    return null;
  }

  // ── Click a header ⋯ menu item (i18n-proof) ────────────────────
  // Accepts a MENU_ICON_PREFIX/MXMStudioI18n key (e.g. "find_replace") or, for
  // compat, a loose English text. Prioritizes the item's SVG icon (same in all
  // languages); if there is no icon for that key, falls to the multi-language
  // text; and as a last net, the English literal. Returns true if it found and
  // clicked it.
  function findMenuItemByIcon(iconPrefixes) {
    const list = Array.isArray(iconPrefixes) ? iconPrefixes : [iconPrefixes];
    for (const p of document.querySelectorAll("svg path")) {
      const d = p.getAttribute("d") || "";
      if (!list.some((pref) => d.startsWith(pref))) continue;
      const row = p.closest(CLICKABLE_SEL);
      if (row && row.getClientRects().length) return row;
    }
    return null;
  }
  async function clickHeaderMenuItem(spec) {
    const key = typeof spec === "string" ? spec : spec.key;
    const iconPrefix = MENU_ICON_PREFIX[key];
    const dots = findHeaderDotsButton();
    if (!dots) { MXMLog.log("[MxM ST] menú ⋯ del header no encontrado"); return false; }
    fireClickFull(dots);
    // 1) Item icon (i18n-proof). 2) Multi-language text. 3) English literal.
    const i18n = window.MXMStudioI18n;
    const textRx = (i18n && i18n.STR[key]) ? i18n.rx(key)
      : new RegExp("^" + String(key).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
    const found = await waitFor(() => {
      if (iconPrefix) {
        const byIcon = findMenuItemByIcon(iconPrefix);
        if (byIcon) { MXMLog.log("[MxM ST] ítem de menú", key, "por ícono"); return byIcon; }
      }
      const el = findByText(textRx);
      if (el) { MXMLog.log("[MxM ST] ítem de menú", key, "por texto"); return el.closest('[tabindex], [class*="r-1otgn73"]') || el; }
      return null;
    }, 1500);
    if (!found) { MXMLog.log("[MxM ST] ítem de menú no encontrado:", key); closeModal(); return false; }
    // Let the menu settle: clicking the item as soon as it appears closes the
    // dropdown without firing the action.
    await sleep(250);
    fireClickFull(found);
    return true;
  }

  // ── Active editor section (Transcript / Time-sync / Structure / …) ──────
  // Returns the active tab by text, or null. An "active" tab usually has the
  // darker/bolder text; as a robust heuristic, there is a lyrics textarea
  // visible ⇒ estamos en Transcript.
  function isOnTranscript() {
    return !!getTranscriptTextarea(true);
  }

  // Fixed order of the sections in the editor's left sidebar (positional
  // fallback when the text does not match by language). The sections' i18n keys
  // dos que usamos viven en MXMStudioI18n (tab_transcript / tab_timesync).
  const SECTION_ORDER = ["transcript", "timesync", "structure", "performer", "analysis"];
  const SECTION_I18N_KEY = { transcript: "tab_transcript", timesync: "tab_timesync" };

  // Editor side tabs (div[tabindex="0"] in the left third).
  function sectionTabs() {
    return Array.from(document.querySelectorAll('div[tabindex="0"]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left < window.innerWidth * 0.3;
    });
  }

  // Clicks a section's side tab (i18n-proof). `name` is a SECTION_ORDER key
  // ("transcript"/"timesync"/…). Primary: match the tab text in any language
  // (MXMStudioI18n); fallback: fixed position in the list
  // of the tabs. Requires fireClickFull.
  function gotoSection(name) {
    const raw = name.trim().toLowerCase();
    // "time-sync" → "timesync"; accepts both the key and the English label.
    const canon = raw.replace(/[-\s]/g, "");
    const tabs = sectionTabs();
    const i18n = window.MXMStudioI18n;
    const i18nKey = SECTION_I18N_KEY[canon];
    let tab = null;
    if (i18nKey && i18n && i18n.STR[i18nKey]) {
      tab = tabs.find((el) => i18n.test(i18nKey, el.innerText || ""));
    }
    if (!tab) tab = tabs.find((el) => (el.innerText || "").trim().toLowerCase().replace(/[-\s]/g, "") === canon);
    if (!tab) {
      const idx = SECTION_ORDER.indexOf(canon);
      if (idx !== -1 && tabs.length === SECTION_ORDER.length) tab = tabs[idx]; // fallback posicional
    }
    if (!tab) { MXMLog.log("[MxM ST] gotoSection: tab no encontrado:", name); return false; }
    fireClickFull(tab);
    return true;
  }

  // Goes to the Transcript section (the lyrics one) if we are not there. Waits
  // for the visible textarea to appear. Returns true if it ended on Transcript.
  async function ensureTranscript(timeoutMs = 6000) {
    if (isOnTranscript()) return true;
    gotoSection("Transcript");
    const ok = await waitFor(() => isOnTranscript(), timeoutMs);
    return !!ok;
  }

  // ── Last contributor (⋯ → Contribution history) ────────────────────────
  async function getContributorOnce() {
    try {
      const { song } = getSongInfo();

      // 1-2) Open the ⋯ menu and click "Contribution history" (i18n-proof by
      //    icon; see clickHeaderMenuItem).
      const opened = await clickHeaderMenuItem("contribution_history");
      if (!opened) { MXMLog.log("[MxM ST] contributor: no pude abrir 'Contribution history'"); return null; }

      // 3) Read the name INSIDE the modal (full-viewport fixed overlay). First
      //    the avatar img's alt; if the contributor has no photo it falls to
      //    the row's TEXT (filtering out modal labels). The modal has internal
      //    Lyrics/Sync/Structure Tags tabs: if the default tab says
      //    "No contributions found" the others are tried (in QA tasks the
      //    contributions live in Sync). If ALL are empty it returns "" (no
      //    contributions), distinct from null (error).
      const modalRoot = () => {
        for (const p of document.querySelectorAll("svg path")) {
          if (!(p.getAttribute("d") || "").startsWith(CLOSE_X_PATH_PREFIX)) continue;
          const ov = findFixedOverlay(p);
          if (ov) return ov;
        }
        return null;
      };
      // Modal labels to skip when looking for the name (i18n-proof: labels in
      // any Studio language, anchored to the start to tolerate the tail of
      // "Last edit <date>"). Fallback: English literals.
      const i18nH = window.MXMStudioI18n;
      const SKIP_TEXT = i18nH
        ? i18nH.union(["contribution_history", "modal_tab_lyrics", "modal_tab_sync",
            "modal_tab_structure_tags", "no_contributions", "last_edit"], "start")
        : /^(contribution history|lyrics|sync|structure tags|no contributions.*|last edit.*)$/i;
      const DATE_TEXT = /\b(ago|hace)\b|\bcontribution(s)?$/i; // "…months ago" / "23 contributions" (no pisa nombres tipo "Santiago")
      const readName = (root) => {
        const imgs = Array.from(root.querySelectorAll("img[alt]"))
          .filter((im) => im.getClientRects().length && (im.alt || "").trim());
        const contrib = imgs.find((im) => im.alt.trim() !== (song || "").trim());
        if (contrib) return contrib.alt.trim();
        for (const el of root.querySelectorAll("div, span")) {
          if (el.children.length) continue;
          const txt = (el.textContent || "").trim();
          if (!txt || txt.length > 60) continue;
          if (!el.getClientRects().length) continue;
          if (SKIP_TEXT.test(txt) || DATE_TEXT.test(txt)) continue;
          if (txt === (song || "").trim()) continue;
          return txt;
        }
        return null;
      };
      const noContribRx = i18nH ? i18nH.union(["no_contributions"], "start") : /no contributions/i;
      const emptyShown = (root) => Array.from(root.querySelectorAll("div, span"))
        .some((el) => !el.children.length && noContribRx.test((el.textContent || "").trim()) && el.getClientRects().length);
      // The "AI Assistant" flag must be read ONLY in the LAST contributor's row
      // (MxM lists the history NEWEST to oldest, so it is the FIRST row).
      // Each row is a div[tabindex] with avatar + name + role ("Curator"/"AI
      // Assistant"/…) + date. It used to look for "AI Assistant" across the WHOLE
      // modal and attribute it to whoever the name was → bug: a curator came out
      // as AI because there was an assistant further back in the history.
      // Giisela Ibarra/Curator [reciente] + Rodrigo Niehaus/AI Assistant [11 meses]).
      // lastRow: the last contributor's row (the one readName gives).
      const lastRow = (root) => {
        const imgs = Array.from(root.querySelectorAll("img[alt]"))
          .filter((im) => im.getClientRects().length && (im.alt || "").trim());
        const contribImg = imgs.find((im) => im.alt.trim() !== (song || "").trim());
        if (contribImg) return contribImg.closest("[tabindex]");
        // No photo: derive the row from the name's text node.
        for (const el of root.querySelectorAll("div, span")) {
          if (el.children.length) continue;
          const txt = (el.textContent || "").trim();
          if (!txt || txt.length > 60) continue;
          if (!el.getClientRects().length) continue;
          if (SKIP_TEXT.test(txt) || DATE_TEXT.test(txt)) continue;
          if (txt === (song || "").trim()) continue;
          return el.closest("[tabindex]");
        }
        return null;
      };
      // Role of the LAST contributor: in the same row where only "AI Assistant"
      // was looked at before, now the FULL role is captured
      // (Rookie / Rater / Curator / Specialist / AI Assistant / …) to show it in
      // parentheses after the name. Prioritizes the known-roles list; if the
      // role is another, it falls to "the row's leaf that is not the name, the
      // date, or a modal label".
      const KNOWN_ROLE = /^(rookie|rater|curator|specialist|graduate|expert|moderator|editor|ai assistant|contributor|rising star|mentor|master|pending|reviewer)$/i;
      // Known gap: KNOWN_ROLE is English only — Studio's translated roles are
      // not confirmed in the harvestable bundle (harvest-studio-strings.mjs did
      // not find a clear path; they are not simple static text). The `other`
      // fallback below already covers ANY language because it does not match
      // against known text, it only discards name/song/date/label — the real
      // row orders avatar→name→ROLE→date, so the role always ends up BEFORE the
      // date in `leaves`. HAS_DIGIT is an extra language-agnostic net for when
      // DATE_TEXT (en/es only) does not recognize a translated relative date:
      // no known role has digits, almost every relative date does ("3 months
      // ago", "il y a 3 mois", …), so a token with digits that is not the name
      // is almost certainly the date. A username COULD have digits, a role
      // "3ヶ月前"…). Acotado a ESTE fallback (no a readName/lastRow): un
      // never does.
      const HAS_DIGIT = /\d/;
      const roleInRow = (row, name) => {
        if (!row) return "";
        const leaves = Array.from(row.querySelectorAll("div, span"))
          .filter((el) => !el.children.length && el.getClientRects().length)
          .map((el) => (el.textContent || "").trim())
          .filter(Boolean);
        const known = leaves.find((tx) => KNOWN_ROLE.test(tx));
        if (known) return known;
        const other = leaves.find((tx) =>
          tx !== name && tx !== (song || "").trim() &&
          !DATE_TEXT.test(tx) && !SKIP_TEXT.test(tx) && !HAS_DIGIT.test(tx) && tx.length <= 30);
        return other || "";
      };
      const aiRx = i18nH && i18nH.STR.assistant ? i18nH.rx("assistant") : /^ai assistant$/i;
      const aiInRow = (row) => !!row && Array.from(row.querySelectorAll("div, span"))
        .some((el) => !el.children.length && aiRx.test((el.textContent || "").trim()) && el.getClientRects().length);
      const probe = () => {
        const root = modalRoot();
        if (!root) return null;
        const n = readName(root);
        if (n) return { name: n };
        if (emptyShown(root)) return { empty: true };
        return null;
      };

      let res = await waitFor(probe, 5000); // el modal trae el historial por red
      let name = (res && res.name) || null;
      if (!name && res && res.empty) {
        for (const tabKey of ["modal_tab_sync", "modal_tab_structure_tags"]) {
          const root = modalRoot();
          if (!root) break;
          const tabMatch = i18nH && i18nH.STR[tabKey]
            ? (t) => i18nH.test(tabKey, t)
            : (t) => t.toLowerCase() === (tabKey === "modal_tab_sync" ? "sync" : "structure tags");
          const tab = Array.from(root.querySelectorAll("div, span")).find((el) =>
            !el.children.length && tabMatch((el.textContent || "").trim()) && el.getClientRects().length);
          if (!tab) continue;
          await sleep(250);
          fireClickFull(tab.closest(CLICKABLE_SEL) || tab);
          res = await waitFor(probe, 2500);
          if (res && res.name) { name = res.name; break; }
        }
        if (!name) name = ""; // historial vacío en todas las tabs
      }
      if (!name) MXMLog.log("[MxM ST] contributor: modal abierto pero sin img[alt] legible");
      const row = lastRow(modalRoot()); // renglón del ÚLTIMO contribuyente
      const role = name ? roleInRow(row, name) : ""; // rango completo (o "")
      const ai = aiRx.test(role) || aiInRow(row); // AI solo del último renglón

      // 4) Close the modal, and then the ⋯ dropdown left open below it (the
      //    second call clicks the backdrop; if there is no overlay, it does nothing).
      closeModal();
      await sleep(400);
      closeModal();
      MXMLog.log("[MxM ST] contributor:", name, role ? "(" + role + ")" : "");
      return { name, ai, role };
    } catch (e) {
      closeModal();
      return null;
    }
  }

  // Robust: retries the whole flow up to 3 times. The typical cause of it
  // "suddenly" failing to find the name that is visibly there is an
  // overlay/dropdown left open from a previous call or the header not yet
  // mounted: between attempts the overlays are cleared and it waits for the ⋯
  // button to appear. A "" result (empty history) or a name is final; only null
  // (error) retries. It ALWAYS returns a
  // objeto { name, ai } (name: string | "" | null; ai: boolean).
  async function getLastContributor() {
    // Limpiar cualquier overlay colgado antes de arrancar.
    closeModal(); await sleep(200);
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => findHeaderDotsButton(), 2500);
      const res = await getContributorOnce();
      if (res !== null) return res; // { name, ai, role } definitivo
      closeModal(); await sleep(400); closeModal(); await sleep(400);
    }
    return { name: null, ai: false, role: "" };
  }

  // ── Header ⓘ button (opens the Track info modal) ───────────────────────────
  // Prefer aria-label; otherwise a clickable with an SVG to the right of the title.
  function findInfoButton() {
    // 1) Prefer the header circle-i (ⓘ) icon by its path (robust: does not
    //    depend on findByText(title), which matches the title repeated in the list).
    const byPath = Array.from(document.querySelectorAll("svg path"))
      .filter((p) => (p.getAttribute("d") || "").startsWith(INFO_PATH_PREFIX))
      .map((p) => p.closest(CLICKABLE_SEL))
      .filter(Boolean)
      .find((el) => { const r = el.getBoundingClientRect(); return isVisible(el) && r.width > 0 && r.top >= 0 && r.top < 90; });
    if (byPath) return byPath;
    for (const sel of ['[aria-label*="track info" i]', '[aria-label*="info" i]', '[aria-label*="details" i]']) {
      const el = document.querySelector(sel);
      const r = el && el.getBoundingClientRect();
      if (r && r.width && r.top < 140) return el;
    }
    const { song } = getSongInfo();
    const titleEl = song && song !== "Sin titulo" ? findByText(song) : null;
    const tr = titleEl ? titleEl.getBoundingClientRect() : null;
    const candidates = [...new Set(
      Array.from(document.querySelectorAll("svg path"))
        .filter((p) => !(p.getAttribute("d") || "").startsWith(DOTS_PATH_PREFIX)) // no el ⋯
        .map((p) => p.closest(CLICKABLE_SEL))
        .filter(Boolean)
    )].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return false;
      if (tr) return r.left >= tr.right - 8 && Math.abs(r.top - tr.top) < 70;
      // No title: header button, avoiding the "back" arrow at the far left.
      return r.top < 90 && r.left > window.innerWidth * 0.15;
    });
    // With a title, the ⓘ is the clickable immediately to the right of the title.
    if (tr) candidates.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return candidates[0] || null;
  }

  // ── Public lyrics page (www.musixmatch.com) ─────────────────────────
  // Opens the Track info modal and READS the lyrics link from the "Title" row
  // (`<a href="//www.musixmatch.com/lyrics/…">`). Opens that URL in a tab and
  // returns it so the caller can also copy it. The lyrics anchor is the only
  // `<a href*="/lyrics/">` in the modal (Album uses /album/, Amazon uses
  // music.amazon.com, Artist uses /artist/).
  // Returns { ok, url }. Used by Open-on-web and the Slack Invitation.
  // `opts.background`: if passed (true/false), the tab is opened by the
  // background con ese flag (openTab handler) en vez de window.open. Si opts es
  // background; if undefined, the usual window.open is kept (slackInvite/contribProfile).
  async function openTrackPageOnce(opts) {
    try {
      // 1) ALWAYS open the modal via the header ⓘ button (the circle-i next to
      //    the song/artist name). Track info is a SEPARATE panel: it is NOT a ⋯
      //    menu item, so it is never looked for there (this ⓘ opens Track info
      //    with the link //www.musixmatch.com/lyrics/…). If it does not appear,
      //    openTrackPage()'s retry tries again; it does not fall to the menu.
      //    (kept as one comment block)
      const infoBtn = findInfoButton();
      if (!infoBtn) { MXMLog.log("[MxM ST] track page: no encontré el botón ⓘ del header"); return { ok: false }; }
      fireClick(infoBtn);
      const titleRx = (window.MXMStudioI18n && window.MXMStudioI18n.STR.title_label)
        ? window.MXMStudioI18n.rx("title_label") : /^title$/i;
      const label = await waitFor(() => findByText(titleRx), 3000);
      if (!label) { MXMLog.log("[MxM ST] track page: no apareció 'Title' en el modal"); closeModal(); return { ok: false }; }
      // 2) Read the lyrics anchor's href (more robust than clicking).
      const linkEl = await waitFor(() => document.querySelector('a[href*="/lyrics/"]'), 1500);
      if (!linkEl) { MXMLog.log("[MxM ST] track page: sin link de la letra en el modal"); closeModal(); return { ok: false }; }
      const href = linkEl.getAttribute("href") || "";
      const url = href.startsWith("//") ? "https:" + href
        : href.startsWith("http") ? href
        : "https://www.musixmatch.com" + href;
      // 3) Open the page in a new tab and close the modal. With a background
      //    option: if opts.background is defined, the background opens it;
      //    otherwise window.open (historical behavior).
      if (opts && opts.background !== undefined) {
        chrome.runtime.sendMessage({ action: "openTab", url, background: opts.background });
      } else {
        window.open(url, "_blank");
      }
      await sleep(300);
      closeModal();
      return { ok: true, url };
    } catch (e) {
      closeModal();
      return { ok: false };
    }
  }

  // Robust: retries up to 3 times clearing stuck overlays between attempts.
  // Fixes the Slack invite's "cannot open Track info" when the header mounted
  // late or a modal stayed open. Returns { ok, url }.
  async function openTrackPage(opts) {
    closeModal(); await sleep(200);
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => findHeaderDotsButton() || findInfoButton(), 2500);
      const res = await openTrackPageOnce(opts);
      if (res && res.ok) return res;
      closeModal(); await sleep(400);
    }
    return { ok: false };
  }

  // ── Abstrack ────────────────────────────────────────────────────────────────
  // The "Abstrack" number in the Track info modal IS the commontrack_id from
  // the editor URL (/tool?commontrack_id=...). It is read from the URL first
  // (without opening modals); the ⓘ modal is the fallback.
  // `collect` (optional): if passed, besides the abstrack it reads the public
  // lyrics link (a[href*="/lyrics/"]) in the SAME ⓘ modal pass and leaves it in
  // collect.webUrl (no window.open). The URL fast-path does not open the modal,
  // so in that case webUrl is left uncaptured (best-effort).
  async function getAbstrack(collect) {
    const fromUrl = new URLSearchParams(location.search).get("commontrack_id")
      || (new URLSearchParams(location.search).get("task_id") || "").split(".")[0];
    if (/^\d{4,}$/.test(fromUrl)) return fromUrl;
    try {
      const infoBtn = findInfoButton();
      if (!infoBtn) { MXMLog.log("[MxM ST] abstrack: no encontré el botón ⓘ"); return null; }
      fireClick(infoBtn);

      // 2) Wait for the modal; the robust anchor is the "Abstrack" label
      //    cualquier idioma ("Musixmatch ID", etc.).
      const abstrackRx = window.MXMStudioI18n && window.MXMStudioI18n.STR.abstrack
        ? window.MXMStudioI18n.rx("abstrack") : /^abstrack$/i;
      const label = await waitFor(() => findByText(abstrackRx), 2000);
      if (!label) { MXMLog.log("[MxM ST] abstrack: no apareció 'Abstrack' en el modal"); closeModal(); return null; }

      // Public lyrics link: same modal, same anchor as openTrackPageOnce (the
      // only a[href*="/lyrics/"] in the modal), without opening a tab.
      if (collect) {
        const a = await waitFor(() => document.querySelector('a[href*="/lyrics/"]'), 1200);
        if (a) {
          const href = a.getAttribute("href") || "";
          collect.webUrl = href.startsWith("//") ? "https:" + href
            : href.startsWith("http") ? href : "https://www.musixmatch.com" + href;
        }
      }

      // 3) Value: the 4+ digit number in the label's row (i18n-proof: does not
      //    depend on the word "abstrack", which is translated; walks nearby ancestors).
      let value = null;
      for (let node = label.parentElement, up = 0; node && up < 4 && !value; node = node.parentElement, up++) {
        const m = (node.textContent || "").match(/\b(\d{4,})\b/);
        if (m) value = m[1];
      }
      MXMLog.log("[MxM ST] abstrack:", value);
      closeModal();
      return value;
    } catch (e) {
      closeModal();
      return null;
    }
  }

  // ── Per-task meta (contributor + abstrack) cached to avoid repeating modals ──
  // Reads ONLY the public lyrics link from the ⓘ modal (no window.open) and
  // closes it. To fill meta.webUrl when the abstrack came via the URL fast-path
  // (modal not opened) or the cache is old. Returns url | null.
  async function readLyricsWebUrl() {
    try {
      const infoBtn = findInfoButton();
      if (!infoBtn) { MXMLog.log("[MxM ST] webUrl: no encontré el botón ⓘ"); return null; }
      fireClick(infoBtn);
      const a = await waitFor(() => document.querySelector('a[href*="/lyrics/"]'), 2500);
      if (!a) { closeModal(); return null; }
      const href = a.getAttribute("href") || "";
      const url = href.startsWith("//") ? "https:" + href
        : href.startsWith("http") ? href : "https://www.musixmatch.com" + href;
      closeModal();
      return url;
    } catch (e) { closeModal(); return null; }
  }

  // `opts.ensureWebUrl`: if webUrl could not be captured above (abstrack
  // fast-path, or old cache without webUrl), it opens the ⓘ modal once to read
  // the link and RE-CACHES it — so later uses already have it and do not reopen
  // the modal. Only Diffgenie requests it (the other uses do not open a modal
  // extra por esto).
  async function getTaskMeta(taskId, opts) {
    const ensureWebUrl = !!(opts && opts.ensureWebUrl);
    const key = "meta:" + taskId;
    const cached = await new Promise((r) => chrome.storage.local.get(key, (d) => r(d[key])));
    if (cached) {
      if (ensureWebUrl && !cached.webUrl) {
        const url = await readLyricsWebUrl();
        if (url) { cached.webUrl = url; chrome.storage.local.set({ [key]: cached }); }
      }
      return cached;
    }
    // contributor keeps the distinction name | "" (no contributions) | null
    // (error): the post-capture toast needs it. contributorAI = is it AI?
    const { name, ai, role } = await getLastContributor();
    const collect = {};
    const abstrack = (await getAbstrack(collect)) || null;
    let webUrl = collect.webUrl || null;
    if (!webUrl && ensureWebUrl) webUrl = await readLyricsWebUrl();
    const meta = { contributor: name != null ? name : null, contributorAI: !!ai, contributorRole: role || "", abstrack, webUrl: webUrl || null };
    if (name != null || abstrack || webUrl) chrome.storage.local.set({ [key]: meta }); // no cachear fallas totales
    return meta;
  }

  // ── Portapapeles con fallback a execCommand ─────────────────────────────────
  function copyToClipboard(text) {
    const legacy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok ? Promise.resolve() : Promise.reject(new Error("execCommand copy falló"));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    return legacy();
  }

  // ── Single SPA dispatcher ───────────────────────────────────────────
  // Before, 4 files (buttons-mxm, compare, highlighter, assistant) each ran
  // their own <title> observer + setInterval(500) detecting URL changes — the
  // same work 4 times per page. Now there is a single one here; each consumer
  // subscribes with onNavigate(cb) instead of building its own observer+interval
  // pair. The interval is the net: the <title> observer does not catch every
  // navigation (pushState cannot be hooked from the
  // isolated world).
  const navCallbacks = [];
  let navLastUrl = location.href;
  function navCheck() {
    if (location.href === navLastUrl) return;
    navLastUrl = location.href;
    for (const cb of navCallbacks) {
      try { cb(); } catch (_) { /* no romper por un subscriber */ }
    }
  }
  new MutationObserver(navCheck).observe(document.querySelector("head > title") || document.head,
    { childList: true, subtree: true, characterData: true });
  setInterval(navCheck, 500);
  function onNavigate(cb) { navCallbacks.push(cb); }

  // ── Normalized key of a song ("title — artist") ───────────────────
  // Used by the highlighter (marking of already-opened songs) to match the same
  // song in the editor and in the list, without depending on DOM ids.
  function songKey(song, artist) {
    const norm = (s) => (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    return norm(song) + " — " + norm(artist);
  }

  window.MXMCore = {
    DOTS_PATH_PREFIX,
    DOTS_PATH_PREFIXES,
    CLOSE_X_PATH_PREFIX,
    CLICKABLE_SEL,
    CARD_TITLE_SEL,
    CARD_META_SEL,
    CARD_ARTIST_SEL,
    sleep,
    waitFor,
    isVisible,
    fireClick,
    fireClickFull,
    findByText,
    findFixedOverlay,
    getTaskId,
    isTaskEditorPage,
    getSongInfo,
    getLyricsEl,
    getTranscriptTextarea,
    findHeaderDotsButton,
    clickHeaderMenuItem,
    isOnTranscript,
    gotoSection,
    ensureTranscript,
    closeModal,
    getLastContributor,
    getAbstrack,
    openTrackPage,
    getTaskMeta,
    copyToClipboard,
    songKey,
    onNavigate,
  };
})();
