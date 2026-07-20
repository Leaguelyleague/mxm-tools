// =============================================================================
// MxM Tools — Central keyboard-shortcut registry
//
// A single place where these live: the default shortcuts, the matcher (compare
// a pressed key against a shortcut), the formatting to display them (⌥A, etc.)
// and the persistence in chrome.storage.local (key "mxmShortcuts").
//
// Injected as the FIRST content script of every group that uses shortcuts and
// also loaded in the popup (via <script>). Exposes window.MXMShortcuts.
//
// Defaults: ⌥ + a left-hand letter (a single hand, they do not clash with
// Chrome or macOS). With e.code the shortcut works even if ⌥+letter produces a
// special character (⌥A -> "å", etc.).
//
//   unir ⌥A    split ⌥S    wordCounter ⌥X (on/off)    gem ⌥G
//
// Any of them can be reconfigured from the extension's popup.
// =============================================================================

(function () {
  "use strict";

  // Avoid re-initializing if the module was already injected in this isolated world.
  if (window.MXMShortcuts) return;

  const STORE_KEY = "mxmShortcuts";

  // id -> default shortcut. A shortcut is { code, alt, ctrl, shift, meta }.
  const DEFAULTS = {
    unir:         { code: "KeyJ", alt: true, ctrl: false, shift: false, meta: false },
    split:        { code: "KeyK", alt: true, ctrl: false, shift: false, meta: false },
    unirParens:   { code: "KeyD", alt: true, ctrl: false, shift: false, meta: false },
    wrapParens:   { code: "KeyF", alt: true, ctrl: false, shift: false, meta: false },
    wrapQuestion: { code: "KeyQ", alt: true, ctrl: false, shift: false, meta: false },
    wrapExclaim:  { code: "KeyE", alt: true, ctrl: false, shift: false, meta: false },
    wordCounter:  { code: "KeyX", alt: true, ctrl: false, shift: false, meta: false },
    gem:          { code: "KeyG", alt: true, ctrl: false, shift: false, meta: false },
    instrumental: { code: "KeyY", alt: true, ctrl: false, shift: false, meta: false },
  };

  // id -> i18n key of the label (the popup translates it with MXMI18n.t()).
  // Same order as DEFAULTS.
  const META = {
    unir:         { labelKey: "sc.unir" },
    split:        { labelKey: "sc.split" },
    unirParens:   { labelKey: "sc.unirParens" },
    wrapParens:   { labelKey: "sc.wrapParens" },
    wrapQuestion: { labelKey: "sc.wrapQuestion" },
    wrapExclaim:  { labelKey: "sc.wrapExclaim" },
    wordCounter:  { labelKey: "sc.wordCounter" },
    gem:          { labelKey: "sc.gem" },
    instrumental: { labelKey: "sc.instrumental" },
  };

  function clone(b) {
    return { code: b.code, alt: !!b.alt, ctrl: !!b.ctrl, shift: !!b.shift, meta: !!b.meta };
  }

  // Live cache of the current shortcuts. Starts with the defaults and updates
  // as soon as storage.local arrives and on any later change.
  const bindings = {};
  for (const id in DEFAULTS) bindings[id] = clone(DEFAULTS[id]);

  const subs = new Set();
  function notify() {
    subs.forEach((cb) => {
      try { cb(bindings); } catch (_) { /* do not break because of one subscriber */ }
    });
  }

  // Merges the stored values over the defaults (anything unset uses the default).
  function applyStored(stored) {
    for (const id in DEFAULTS) {
      bindings[id] = stored && stored[id] ? clone(stored[id]) : clone(DEFAULTS[id]);
    }
  }

  try {
    chrome.storage.local.get(STORE_KEY, (d) => {
      applyStored(d && d[STORE_KEY]);
      notify();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORE_KEY]) {
        applyStored(changes[STORE_KEY].newValue);
        notify();
      }
    });
  } catch (_) {
    /* no chrome.storage (unexpected context): the defaults remain */
  }

  // ── Matcher: does this keydown event correspond to this shortcut? ──────────
  function matches(e, b) {
    if (!b || !b.code) return false;
    return (
      e.code === b.code &&
      e.altKey === !!b.alt &&
      e.ctrlKey === !!b.ctrl &&
      e.shiftKey === !!b.shift &&
      e.metaKey === !!b.meta
    );
  }

  // ── Formatting for display (⌃⌥⇧⌘ + key) ────────────────────────────────────
  const KEYLABEL = {
    Space: "Space",
    Slash: "/",
    Backslash: "\\",
    Period: ".",
    Comma: ",",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
    Enter: "↵",
    Tab: "⇥",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    NumpadDivide: "Num /",
    NumpadMultiply: "Num *",
    NumpadSubtract: "Num -",
    NumpadAdd: "Num +",
  };
  function keyLabel(code) {
    if (!code) return "?";
    if (KEYLABEL[code]) return KEYLABEL[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "Num " + code.slice(6);
    return code;
  }
  // OS detection to show the correct modifiers: on mac the ⌃⌥⇧⌘ symbols are
  // used; on Windows/Linux, text (Ctrl/Alt/Shift/Win).
  const IS_MAC = (() => {
    const p = (navigator.userAgentData && navigator.userAgentData.platform)
      || navigator.platform || "";
    return /mac/i.test(p);
  })();
  function format(b) {
    if (!b || !b.code) return "—";
    if (IS_MAC) {
      let s = "";
      if (b.ctrl) s += "⌃";
      if (b.alt) s += "⌥";
      if (b.shift) s += "⇧";
      if (b.meta) s += "⌘";
      return s + keyLabel(b.code);
    }
    const parts = [];
    if (b.ctrl) parts.push("Ctrl");
    if (b.alt) parts.push("Alt");
    if (b.shift) parts.push("Shift");
    if (b.meta) parts.push("Win");
    parts.push(keyLabel(b.code));
    return parts.join("+");
  }

  // ── Helpers for the shortcut recorder (popup) ──────────────────────────────
  function fromEvent(e) {
    return { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey };
  }
  function isModifierOnly(e) {
    return (
      e.key === "Shift" || e.key === "Alt" || e.key === "Control" || e.key === "Meta" ||
      /^(Shift|Alt|Control|Meta)(Left|Right)$/.test(e.code)
    );
  }
  function eq(a, b) {
    return (
      !!a && !!b &&
      a.code === b.code &&
      !!a.alt === !!b.alt &&
      !!a.ctrl === !!b.ctrl &&
      !!a.shift === !!b.shift &&
      !!a.meta === !!b.meta
    );
  }

  // ── Persistence (used by the popup) ────────────────────────────────────────
  async function save(id, binding) {
    const d = await chrome.storage.local.get(STORE_KEY);
    const map = d && d[STORE_KEY] ? d[STORE_KEY] : {};
    map[id] = clone(binding);
    await chrome.storage.local.set({ [STORE_KEY]: map });
  }
  async function reset(id) {
    const d = await chrome.storage.local.get(STORE_KEY);
    const map = d && d[STORE_KEY] ? d[STORE_KEY] : {};
    delete map[id];
    await chrome.storage.local.set({ [STORE_KEY]: map });
  }

  window.MXMShortcuts = {
    DEFAULTS,
    META,
    IDS: Object.keys(DEFAULTS),
    get(id) { return bindings[id]; },
    all() { return bindings; },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    matches,
    format,
    fromEvent,
    isModifierOnly,
    eq,
    save,
    reset,
    IS_MAC,
  };
})();
