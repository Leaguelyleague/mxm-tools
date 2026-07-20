// =============================================================================
// MxM Tools — Single floating-button system
//
// A single Shadow DOM host for all the extension's draggable circular buttons
// (copy, YouTube, Google, compare, Gem message, chain).
// Expone window.MXMButtons.
//
// - register(cfg): creates a button. cfg = { key, icon, color, light?, defaultPos, onClick }.
//   `light: true` = light button (soft border, for the white copy one).
// - remove(key): removes it (the host is destroyed if left empty).
// - Position persisted in chrome.storage.local "btnPos:<key>" on drop after a drag.
// - Drag with a 3px threshold: if it did not move, it is a click.
// - showToast(entry|key, msg, ms) and setIcon(entry, icon, cls, ms) for feedback.
//
// Per-button VISIBILITY (storage's "floatingButtons" object) is decided by
// buttons-mxm.js calling register/remove; this module does not read that config.
// =============================================================================

(function () {
  "use strict";

  if (window.MXMButtons) return;

  let host = null;
  let shadow = null;
  let toast = null;
  let contribLabel = null; // etiqueta fija del último contribuyente (lote 5)
  let bubble = null;       // cartelito anclado a un botón (Save & Send confirm)
  // Repositioning timers: start with the host (ensureHost) and stop when it is
  // destroyed (destroyHostIfEmpty) — they used to run ALWAYS, even on pages with
  // no floating button (e.g. the task list).
  let restackTimer = null;
  let contribLabelTimer = null;

  const buttons = {}; // key -> entry

  // FIXED style: always black-and-white + square. The popup's color/shape
  // options were removed.
  const colorMode = "bw";
  const btnShape = "square";

  // Button drag: by default the buttons are FIXED; drag is opt-in with the
  // popup's "buttonsMovable" toggle (default OFF).
  let movable = false;
  chrome.storage.local.get(["buttonsMovable"], (d) => { movable = d.buttonsMovable === true; });

  // Applies background/icon color and shape per the current mode. In B&W the
  // .bw class is used (with a system dark-mode media query) and inline styles
  // are cleared so the CSS wins.
  function applyEntryStyle(entry) {
    const bw = colorMode === "bw";
    entry.el.classList.toggle("bw", bw);
    entry.el.style.background = bw ? "" : entry.bg;
    entry.el.style.color = bw ? "" : entry.fg;
    entry.el.classList.toggle("square", btnShape === "square");
    entry.el.classList.toggle("light", !bw && !!entry.light);
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.id = "mxm-st-buttons-host";
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .b {
        position: fixed;
        z-index: 2147483647;
        width: 42px;
        height: 42px;
        border: none;
        border-radius: 50%;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        box-shadow: 0 2px 10px rgba(0,0,0,.4);
        user-select: none;
        touch-action: none;
        transition: background 0.2s, box-shadow 0.2s;
      }
      .b:hover { box-shadow: 0 3px 14px rgba(0,0,0,.55); }
      .b.dragging { cursor: grabbing; }
      .b::after {
        content: attr(data-tip);
        position: absolute;
        right: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%);
        background: #1a1a1a;
        color: #fff;
        font: 500 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 4px 9px;
        border-radius: 7px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity .15s ease .35s;
      }
      .b:hover::after { opacity: 1; }
      /* Grouped buttons: the label goes ABOVE (members expand to the
         izquierda y taparían un tooltip anclado a la izquierda). */
      .b[data-tip-pos="top"]::after {
        right: auto;
        left: 50%;
        top: auto;
        bottom: calc(100% + 10px);
        transform: translateX(-50%);
      }
      .b.dragging::after, .b[data-tip=""]::after, .b:not([data-tip])::after { display: none; }
      .b.light {
        box-shadow: 0 2px 10px rgba(0,0,0,0.25);
        border: 1px solid rgba(0,0,0,0.08);
      }
      .b.light:hover { box-shadow: 0 3px 14px rgba(0,0,0,0.35); }
      .b.success { background: #34c759 !important; }
      .b.error { background: #ff3b30 !important; }
      .b.square { border-radius: 12px; }
      .b.bw { background: #ffffff; color: #333333; }
      @media (prefers-color-scheme: dark) {
        .b.bw {
          background: #2b2b2b;
          color: #ececec;
          border: 1px solid rgba(255,255,255,.18);
          box-shadow: 0 2px 10px rgba(0,0,0,.6);
        }
      }
      .t {
        position: fixed;
        z-index: 2147483647;
        left: 50%;
        bottom: 24px;
        transform: translate(-50%, 8px);
        background: #1a1a1a;
        color: #fff;
        padding: 10px 18px;
        border-radius: 10px;
        font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        opacity: 0;
        transition: opacity .2s, transform .2s;
        pointer-events: none;
        max-width: 60vw;
        text-align: center;
      }
      .t.show { opacity: 1; transform: translate(-50%, 0); }
      /* Bubble anchored to a button (to its left), with a little arrow on the right.
         Lo usa Save & Send para pedir el 2º clic de confirmación. */
      .bub {
        position: fixed;
        z-index: 2147483647;
        transform: translateY(-50%);
        background: #1a1a1a;
        color: #fff;
        padding: 6px 11px;
        border-radius: 8px;
        font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        white-space: nowrap;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s;
      }
      .bub.show { opacity: 1; }
      .bub::after {
        content: "";
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        border: 6px solid transparent;
        border-left-color: #1a1a1a;
      }
      .cl {
        position: fixed;
        z-index: 2147483647;
        right: 20px;
        bottom: 50px;
        max-width: 240px;
        font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
        color: #8a8a8a;
        text-align: right;
        white-space: nowrap;
        overflow: visible;
        text-overflow: ellipsis;
        pointer-events: auto;
        cursor: default;
        user-select: none;
        opacity: 0;
        transition: opacity .2s;
      }
      .cl.show { opacity: 1; }
      /* Hover tooltip: clarifies it is the last contributor. */
      .cl::after {
        content: attr(data-hint);
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        background: #1a1a1a;
        color: #fff;
        font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 3px 8px;
        border-radius: 6px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity .15s ease .3s;
      }
      .cl:hover::after { opacity: 1; }
      .cl:not([data-hint])::after, .cl[data-hint=""]::after { display: none; }
      @media (prefers-color-scheme: dark) { .cl { color: #9a9a9a; } }
    `;
    shadow.appendChild(style);

    toast = document.createElement("div");
    toast.className = "t";
    shadow.appendChild(toast);

    contribLabel = document.createElement("div");
    contribLabel.className = "cl";
    shadow.appendChild(contribLabel);

    bubble = document.createElement("div");
    bubble.className = "bub";
    shadow.appendChild(bubble);

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);

    if (!restackTimer) restackTimer = setInterval(maybeRestack, 700);
    if (!contribLabelTimer) contribLabelTimer = setInterval(positionContribLabel, 700);
  }

  function destroyHostIfEmpty() {
    if (!host) return;
    if (Object.keys(buttons).length > 0) return;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    clearInterval(restackTimer); restackTimer = null;
    clearInterval(contribLabelTimer); contribLabelTimer = null;
    host.remove();
    host = null;
    shadow = null;
    toast = null;
    contribLabel = null;
  }

  function applyPosition(entry, pos) {
    const { el } = entry;
    if (pos.left !== undefined && pos.top !== undefined) {
      el.style.left = pos.left + "px";
      el.style.top = pos.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    } else {
      el.style.right = pos.right + "px";
      el.style.bottom = pos.bottom + "px";
      el.style.left = "auto";
      el.style.top = "auto";
    }
  }

  // Left edge of the Assistant panel. Structural: the panel sits against the
  // editor's RIGHT edge and contains the collapse button (double chevron, path
  // M9.882 14.762, the same one assistant.js uses). It walks up from that
  // button to the TALL container anchored to the right of the viewport and
  // returns its `left`. If the panel is not there (closed) → null.
  // ajuste fino en vivo.
  const ASSISTANT_COLLAPSE_PATH_PREFIX = "M9.882 14.762";
  function assistantPanelLeft() {
    const p = document.querySelector(`svg path[d^="${ASSISTANT_COLLAPSE_PATH_PREFIX}"]`);
    if (!p) return null;
    const svg = p.closest("svg");
    if (!svg || !svg.getClientRects().length) return null;
    let el = svg, best = null;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.height >= window.innerHeight * 0.4 && r.right >= window.innerWidth - 4 &&
          r.left > window.innerWidth * 0.5) best = el;
      el = el.parentElement;
    }
    return best ? Math.round(best.getBoundingClientRect().left) : null;
  }

  // Stack `right`: 20px from the viewport edge if there is no panel; if the
  // assistant panel is open, aligned to its left edge (with a small gap). A
  // safety clamp so the buttons are not pushed off-screen.
  function stackRight() {
    const panelLeft = assistantPanelLeft();
    if (panelLeft == null) return 20;
    const r = window.innerWidth - panelLeft + 12;
    return Math.max(20, Math.min(r, Math.round(window.innerWidth * 0.5)));
  }

  // Stacking position by index: right column, bottom to top.
  function stackPos(index) {
    return { right: stackRight(), bottom: 80 + (index || 0) * 52 };
  }

  // Re-stacks the buttons in the stack (not dragged, not group members) when
  // `right` changes (assistant panel opening/closing, or resize). Only acts
  // when the value changes so as not to churn.
  let lastStackRight = null;
  function maybeRestack() {
    const r = stackRight();
    if (r === lastStackRight) return;
    lastStackRight = r;
    for (const entry of Object.values(buttons)) {
      if (entry.dragged || entry.groupMemberOf) continue;
      applyPosition(entry, stackPos(entry.stackIndex));
    }
  }
  window.addEventListener("resize", maybeRestack);

  function register(cfg) {
    const existing = buttons[cfg.key];
    if (existing) {
      existing.stackIndex = cfg.stackIndex;
      existing.el.style.visibility = ""; // por si quedó oculto por playExit
      if (cfg.label) existing.el.dataset.tip = cfg.label;
      if (cfg.tipPos) existing.el.dataset.tipPos = cfg.tipPos;
      else delete existing.el.dataset.tipPos;
      existing.onClick = cfg.onClick || existing.onClick;
      if (cfg.groupMembers) setupGroupAnchor(existing, cfg.groupMembers);
      if (cfg.groupMemberOf) {
        // Is (or becomes) a group member: does not enter the stack; stays hidden
        // over its anchor and expands on hover.
        existing.groupMemberOf = cfg.groupMemberOf;
        existing.groupIndex = cfg.groupIndex;
        markAsGroupMember(existing);
      } else if (existing.groupMemberOf) {
        // No longer grouped (toggle OFF): cancel the expand animation (with
        // fill:forwards it would leave the button invisible) and re-stack.
        existing.groupMemberOf = null;
        if (existing._fanAnim) { try { existing._fanAnim.cancel(); } catch (_) {} existing._fanAnim = null; }
        existing.el.style.opacity = "";
        existing.el.style.transform = "";
        existing.el.style.pointerEvents = "";
        if (!existing.dragged) applyPosition(existing, stackPos(cfg.stackIndex));
      } else if (!existing.dragged) {
        // Normal button: re-stack if the index changed and the user did NOT drag it.
        applyPosition(existing, stackPos(cfg.stackIndex));
      }
      return existing;
    }
    ensureHost();

    const el = document.createElement("button");
    el.className = "b";
    el.innerHTML = cfg.icon;
    if (cfg.label) el.dataset.tip = cfg.label; // tooltip (::after) al hacer hover
    if (cfg.tipPos) el.dataset.tipPos = cfg.tipPos; // "top" para agrupados
    shadow.appendChild(el);

    const entry = {
      key: cfg.key,
      el,
      defaultIcon: cfg.icon,
      posKey: "btnPos:" + cfg.key,
      onClick: cfg.onClick,
      stackIndex: cfg.stackIndex,
      bg: cfg.color,
      fg: cfg.iconColor || "#3a3a3a",
      light: !!cfg.light,
      groupMemberOf: cfg.groupMemberOf || null,
      groupIndex: cfg.groupIndex,
      dragged: false,
      isDragging: false,
      wasDragged: false,
      dragStartX: 0,
      dragStartY: 0,
      btnStartX: 0,
      btnStartY: 0,
    };
    buttons[cfg.key] = entry;
    applyEntryStyle(entry);

    if (cfg.groupMemberOf) {
      // Group member: hidden over the anchor, with no stack position of its own.
      markAsGroupMember(entry);
    } else {
      // If the user has dragged this button before, respect that free position;
      // otherwise stack it by index (re-stacked when others are toggled).
      chrome.storage.local.get(entry.posKey, (data) => {
        if (data[entry.posKey]) {
          entry.dragged = true;
          applyPosition(entry, data[entry.posKey]);
        } else {
          applyPosition(entry, stackPos(cfg.stackIndex));
        }
      });
    }

    if (cfg.groupMembers) setupGroupAnchor(entry, cfg.groupMembers);
    el.addEventListener("pointerdown", (e) => onPointerDown(e, entry));
    return entry;
  }

  // ── Button grouping ────────────────────────────────────────────
  // An "anchor" button occupies a stack slot; its members stay hidden over it
  // and, on hover, EXPAND to the left ("cell dividing" effect) with staggered
  // slide+fade+scale. On mouse-out, they retract.
  const GROUP_STEP = 52; // separación horizontal (igual al paso vertical de la pila)
  const HOVER_MARGIN = 60; // zona de tolerancia invisible alrededor del grupo desplegado

  // Bounding rect of the anchor + its members, expanded by HOVER_MARGIN. While
  // the pointer is inside this zone the group does NOT retract (even if not over
  // a real button): resolves the gaps between buttons and gives room to reach the last.
  function groupRect(anchor) {
    const r = anchor.el.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    (anchor.groupMembers || []).forEach((key) => {
      const m = buttons[key];
      if (!m) return;
      const mr = m.el.getBoundingClientRect();
      left = Math.min(left, mr.left); top = Math.min(top, mr.top);
      right = Math.max(right, mr.right); bottom = Math.max(bottom, mr.bottom);
    });
    return { left: left - HOVER_MARGIN, top: top - HOVER_MARGIN, right: right + HOVER_MARGIN, bottom: bottom + HOVER_MARGIN };
  }

  function fanOut(anchor) {
    if (!anchor || anchor._fanned) return;
    // Only ONE group expanded at a time: on opening one, close the others that
    // stayed open (e.g. if you moved quickly from one to another).
    for (const other of Object.values(buttons)) {
      if (other !== anchor && other._fanned) { clearTimeout(other._closeTimer); fanIn(other); }
    }
    anchor._fanned = true;
    // Watch the pointer at document level: keeps the group open within the
    // expanded rect and retracts it only on leaving that zone.
    anchor._hoverInside = true;
    document.addEventListener("pointermove", anchor._groupHitTest);
    const rect = anchor.el.getBoundingClientRect();
    (anchor.groupMembers || []).forEach((key, i) => {
      const m = buttons[key];
      if (!m) return;
      m.el.style.left = rect.left - (i + 1) * GROUP_STEP + "px";
      m.el.style.top = rect.top + "px";
      m.el.style.right = "auto";
      m.el.style.bottom = "auto";
      m.el.style.opacity = "1";
      m.el.style.pointerEvents = "auto";
      if (m._fanAnim) { try { m._fanAnim.cancel(); } catch (_) {} }
      try {
        m._fanAnim = m.el.animate(
          [
            { transform: `translateX(${(i + 1) * GROUP_STEP}px) scale(.35)`, opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 280, delay: i * 45, easing: "cubic-bezier(.2,.9,.25,1.15)", fill: "both" }
        );
      } catch (_) { m.el.style.opacity = "1"; }
    });
  }

  function fanIn(anchor) {
    if (!anchor || !anchor._fanned) return;
    anchor._fanned = false;
    anchor._hoverInside = false;
    document.removeEventListener("pointermove", anchor._groupHitTest);
    const members = anchor.groupMembers || [];
    members.forEach((key, i) => {
      const m = buttons[key];
      if (!m) return;
      m.el.style.pointerEvents = "none";
      if (m._fanAnim) { try { m._fanAnim.cancel(); } catch (_) {} }
      try {
        m._fanAnim = m.el.animate(
          [
            { transform: "none", opacity: 1 },
            { transform: `translateX(${(i + 1) * GROUP_STEP}px) scale(.35)`, opacity: 0 },
          ],
          { duration: 200, delay: (members.length - 1 - i) * 30, easing: "ease-in", fill: "forwards" }
        );
        m._fanAnim.onfinish = () => { m.el.style.opacity = "0"; };
      } catch (_) { m.el.style.opacity = "0"; }
    });
  }

  function setupGroupAnchor(anchor, memberKeys) {
    anchor.groupMembers = memberKeys;
    if (anchor._groupAttached) return;
    anchor._groupAttached = true;
    anchor._groupOpen = () => { clearTimeout(anchor._closeTimer); fanOut(anchor); };
    anchor._groupClose = () => {
      clearTimeout(anchor._closeTimer);
      anchor._closeTimer = setTimeout(() => fanIn(anchor), 140);
    };
    // Hit-test of the tolerance zone (active only while expanded). Inside:
    // cancels the close. On crossing out (once): schedules it.
    anchor._groupHitTest = (e) => {
      if (!anchor._fanned) return;
      const r = groupRect(anchor);
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside) {
        anchor._hoverInside = true;
        clearTimeout(anchor._closeTimer);
        anchor._closeTimer = null;
      } else if (anchor._hoverInside) {
        anchor._hoverInside = false;
        anchor._groupClose();
      }
    };
    anchor.el.addEventListener("pointerenter", anchor._groupOpen);
    anchor.el.addEventListener("pointerleave", anchor._groupClose);
  }

  function markAsGroupMember(entry) {
    entry.el.style.opacity = "0";
    entry.el.style.pointerEvents = "none";
    if (!entry._memberAttached) {
      entry._memberAttached = true;
      // Keep the group open while the mouse is over a member.
      entry.el.addEventListener("pointerenter", () => {
        const a = buttons[entry.groupMemberOf]; if (a && a._groupOpen) a._groupOpen();
      });
      entry.el.addEventListener("pointerleave", () => {
        const a = buttons[entry.groupMemberOf]; if (a && a._groupClose) a._groupClose();
      });
    }
  }

  // Toggle by click/touch (hover already expands on desktop).
  function toggleGroup(anchorKey) {
    const a = buttons[anchorKey];
    if (!a) return;
    if (a._fanned) fanIn(a); else fanOut(a);
  }

  function remove(key) {
    const entry = buttons[key];
    if (!entry) return;
    entry.el.remove();
    delete buttons[key];
    destroyHostIfEmpty();
  }

  // NOTE: the buttons' CLICK lives in onPointerUp (the !wasDragged branch), so
  // onPointerDown must ALWAYS arm isDragging — the "fixed" mode (buttonsMovable
  // OFF) is gated in onPointerMove: with no movement, wasDragged stays false and
  // the click still fires. (Gating it here broke ALL the buttons.)
  function onPointerDown(e, entry) {
    entry.isDragging = true;
    entry.wasDragged = false;
    entry.dragStartX = e.clientX;
    entry.dragStartY = e.clientY;
    const rect = entry.el.getBoundingClientRect();
    entry.btnStartX = rect.left;
    entry.btnStartY = rect.top;
    if (movable) entry.el.classList.add("dragging"); // cursor grabbing solo si se puede mover
    entry.el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!movable) return; // botones fijos (default): no se mueven, el click sigue vivo
    for (const entry of Object.values(buttons)) {
      if (!entry.isDragging) continue;
      const dx = e.clientX - entry.dragStartX;
      const dy = e.clientY - entry.dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) entry.wasDragged = true;
      const newX = Math.max(0, Math.min(window.innerWidth - 42, entry.btnStartX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 42, entry.btnStartY + dy));
      entry.el.style.left = newX + "px";
      entry.el.style.top = newY + "px";
      entry.el.style.right = "auto";
      entry.el.style.bottom = "auto";
    }
  }

  function onPointerUp(_e) {
    for (const entry of Object.values(buttons)) {
      if (!entry.isDragging) continue;
      entry.isDragging = false;
      entry.el.classList.remove("dragging");

      if (entry.wasDragged) {
        entry.dragged = true;
        const rect = entry.el.getBoundingClientRect();
        chrome.storage.local.set({ [entry.posKey]: { left: rect.left, top: rect.top } });
      } else {
        entry.onClick(entry);
      }
    }
  }

  // FIXED toast bottom-center (does not depend on the button that triggers it).
  let toastTimer = null;
  // Raises the toast so it sits ABOVE the player bar (same criterion as the
  // contributor label). If there is no bar (other pages), it uses the CSS
  // bottom (24px).
  function positionToast() {
    if (!toast) return;
    const bar = findPlayerBar();
    if (bar) {
      const barTop = bar.getBoundingClientRect().top;
      toast.style.bottom = Math.max(24, window.innerHeight - barTop + 8) + "px";
    } else {
      toast.style.bottom = "";
    }
  }
  function showToast(_entryOrKey, msg, duration = 2500) {
    ensureHost();
    if (!toast) return;
    toast.textContent = msg;
    positionToast();
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
  }

  // Bubble anchored to a button (to its left). Used by Save & Send for the 2nd
  // confirmation click, alongside the bottom toast.
  let bubbleTimer = null;
  function showBubble(entry, msg, duration = 3000) {
    ensureHost();
    if (!bubble || !entry || !entry.el) return;
    bubble.textContent = msg;
    const r = entry.el.getBoundingClientRect();
    bubble.style.top = (r.top + r.height / 2) + "px";
    bubble.style.right = (window.innerWidth - r.left + 10) + "px";
    bubble.classList.add("show");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble && bubble.classList.remove("show"), duration);
  }
  function hideBubble() {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (bubble) bubble.classList.remove("show");
  }

  function setIcon(entry, icon, cls, duration) {
    entry.el.innerHTML = icon;
    if (cls) entry.el.classList.add(cls);
    if (duration) {
      setTimeout(() => {
        entry.el.innerHTML = entry.defaultIcon;
        if (cls) entry.el.classList.remove(cls);
      }, duration);
    }
  }

  // Fixed last-contributor label: text already formatted by the caller
  // (buttons-mxm.js, which has the i18n). Lives bottom-right, below the lowest
  // button.
  function setContributorLabel(text, hint) {
    ensureHost();
    if (!contribLabel) return;
    contribLabel.textContent = text || "";
    if (hint) contribLabel.dataset.hint = hint; else delete contribLabel.dataset.hint;
    contribLabel.classList.toggle("show", !!text);
    positionContribLabel();
  }
  function hideContributorLabel() {
    if (contribLabel) { contribLabel.classList.remove("show"); contribLabel.textContent = ""; delete contribLabel.dataset.hint; }
  }

  // Places the contributor label JUST above the bottom player bar (play +
  // timeline + duration + slow-snail), stably against resize/zoom. Anchor: the
  // timeline is a [role="slider"]; it walks up to the outermost ancestor that is
  // wide (≥50% of the viewport) and in the lower half = the full-width bar.
  // Fallback: bottom:50px.
  function findPlayerBar() {
    const slider = document.querySelector('[role="slider"]');
    if (!slider) return null;
    let el = slider, best = null;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.5 && r.top >= window.innerHeight * 0.5) best = el;
      el = el.parentElement;
    }
    return best;
  }
  // Centered EXACTLY halfway between the top of the player bar and the bottom
  // edge of the lowest floating button (before, it stuck to/overlapped the last
  // button). If there are no visible buttons, it falls back to the previous
  // behavior (just above the bar).
  function lowestButtonBottom() {
    let max = -Infinity;
    for (const entry of Object.values(buttons)) {
      const r = entry.el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) max = Math.max(max, r.bottom);
    }
    return max === -Infinity ? null : max;
  }
  function positionContribLabel() {
    if (!contribLabel || !contribLabel.classList.contains("show")) return;
    const bar = findPlayerBar();
    const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight - 50;
    const btnBottom = lowestButtonBottom();
    if (btnBottom != null && btnBottom < barTop) {
      // midpoint of the gap between the last button and the bar
      const h = contribLabel.offsetHeight || 16;
      const centerY = (btnBottom + barTop) / 2;
      contribLabel.style.bottom = Math.max(8, window.innerHeight - centerY - h / 2) + "px";
    } else {
      contribLabel.style.bottom = Math.max(8, window.innerHeight - barTop + 8) + "px";
    }
  }
  window.addEventListener("resize", positionContribLabel);

  window.MXMButtons = {
    register,
    remove,
    has(key) { return !!buttons[key]; },
    get(key) { return buttons[key] || null; },
    showToast,
    showBubble,
    hideBubble,
    setIcon,
    playIntro,
    playExit,
    setContributorLabel,
    hideContributorLabel,
    toggleGroup,
  };

  // ── EXIT animation (fixed, not configurable) ─────────────────────────────
  // On leaving the editor the buttons hide off the right side instead
  // of disappearing abruptly. When each finishes it stays hidden
  // (visibility) and done() is called ONCE so the caller removes them.
  let exiting = false;
  function playExit(done) {
    const entries = Object.values(buttons);
    if (!entries.length || exiting) { if (done) done(); return; }
    exiting = true;
    // COLLAPSED group members are not animated: the exit keyframe starts at
    // opacity:1 and made them "appear" right when closing the task.
    // They are hidden abruptly; only the actually visible ones are animated
    // miembros desplegados en ese momento).
    const animated = [];
    for (const entry of entries) {
      const anchor = entry.groupMemberOf ? buttons[entry.groupMemberOf] : null;
      const collapsedMember = entry.groupMemberOf && (!anchor || !anchor._fanned);
      if (collapsedMember) {
        if (entry._fanAnim) { try { entry._fanAnim.cancel(); } catch (_) {} }
        entry.el.style.opacity = "0";
        entry.el.style.visibility = "hidden";
      } else {
        animated.push(entry);
      }
    }
    if (!animated.length) { exiting = false; if (done) done(); return; }
    let pending = animated.length;
    const finishOne = (entry) => {
      entry.el.style.visibility = "hidden";
      if (--pending === 0) { exiting = false; if (done) done(); }
    };
    // Simple, fast exit — ALL at once (no stagger), they slide
    // al borde derecho y se desvanecen en 200ms.
    animated.forEach((entry) => {
      const rect = entry.el.getBoundingClientRect();
      const dx = window.innerWidth - rect.left + 60; // hasta pasar el borde derecho
      try {
        const a = entry.el.animate(
          [
            { transform: "none", opacity: 1 },
            { transform: `translateX(${dx}px)`, opacity: 0 },
          ],
          { duration: 200, easing: "ease-in" }
        );
        a.onfinish = a.oncancel = () => finishOne(entry);
      } catch (_) {
        finishOne(entry);
      }
    });
  }

  // ── Entrance animation (btn-anims.js) ───────────────────────────────────
  // Called by buttons-mxm.js when the stack goes from 0 to N buttons (entering
  // the editor). Waits a moment for the async positions (saved btnPos) to be
  // applied and animates ONLY transform/opacity toward the natural state.
  function playIntro() {
    chrome.storage.local.get("btnAnimation", (d) => {
      let name = d.btnAnimation || "random"; // default: aleatorio (lote 3)
      if (name === "none") return;
      const anims = window.MXMBtnAnims || {};
      if (name === "random") {
        // Guaranteed rotation: never repeat the last drawn animation (the user
        // noticed repeats when reopening tasks).
        let keys = Object.keys(anims);
        if (!keys.length) return;
        let last = null;
        try { last = sessionStorage.getItem("mxmLastIntroAnim"); } catch (_) {}
        if (last && keys.length > 1) keys = keys.filter((k) => k !== last);
        name = keys[Math.floor(Math.random() * keys.length)];
        try { sessionStorage.setItem("mxmLastIntroAnim", name); } catch (_) {}
      }
      const fn = anims[name];
      if (typeof fn !== "function") return;
      // Hide until the animation starts (avoids the flash at the final position).
      // Grouped members do NOT enter: they stay hidden until the anchor is hovered.
      const entries = Object.values(buttons).filter((e) => !e.groupMemberOf);
      for (const e of entries) e.el.style.opacity = "0";
      setTimeout(() => {
        for (const e of entries) e.el.style.opacity = "";
        try { fn(entries.map((e) => ({ el: e.el }))); } catch (_) {}
      }, 250);
    });
  }

  // Position reset from the popup (when a btnPos:<key> key is deleted the button
  // returns to its place in the stack) + live drag toggle.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.buttonsMovable) movable = changes.buttonsMovable.newValue === true;
    for (const k in changes) {
      if (!k.startsWith("btnPos:") || changes[k].newValue !== undefined) continue;
      const entry = buttons[k.slice("btnPos:".length)];
      if (entry) { entry.dragged = false; applyPosition(entry, stackPos(entry.stackIndex)); }
    }
  });
})();
