// =============================================================================
// Merge/split lines — Content Script
// Configurable shortcuts (defaults ⌥A merge, ⌥S split; see mxm-shortcuts.js)
//
// Flujo:
//   1. Read the active element's text
//   2. Clear the active element
//   3. Transform: trim + lowercase the first letter
//   4. Find the previous text element in the DOM
//   5. Concatenate the transformed text at the end of the previous element
//   6. Dispatch events so React/Vue/etc. register the change
//   7. Move the focus to the join point (between both texts)
// =============================================================================

(function () {
  "use strict";

  // ── Shortcut configuration ──────────────────────────────────────────────
  // Configurable shortcuts (see mxm-shortcuts.js). Defaults: ⌥A (merge), ⌥S
  // (split). With e.code they work even if ⌥+letter produces a special character.
  let shortcut = window.MXMShortcuts.get("unir");
  let shortcutSplit = window.MXMShortcuts.get("split");
  let shortcutParens = window.MXMShortcuts.get("unirParens");
  let shortcutWrap = window.MXMShortcuts.get("wrapParens");
  let shortcutWrapQ = window.MXMShortcuts.get("wrapQuestion");
  let shortcutWrapE = window.MXMShortcuts.get("wrapExclaim");
  window.MXMShortcuts.onChange((all) => {
    shortcut = all.unir;
    shortcutSplit = all.split;
    shortcutParens = all.unirParens;
    shortcutWrap = all.wrapParens;
    shortcutWrapQ = all.wrapQuestion;
    shortcutWrapE = all.wrapExclaim;
  });

  // ── On/off state (controlled from the popup) ───────────────
  // SEPARATE flags for merge, split and merge-in-parentheses: each function has
  // its own toggle. unirParensUpper decides whether the text left inside the
  // parentheses starts uppercase (popup checkbox; default lowercase).
  let unirEnabled = true; // por defecto: activado
  let splitEnabled = true; // por defecto: activado
  let unirParensEnabled = true; // por defecto: activado
  let unirParensUpper = false; // por defecto: minúscula
  let wrapParensEnabled = true; // por defecto: activado (⌥F, selección entre paréntesis)
  let wrapParensUpper = false; // por defecto: minúscula
  // Wrap the selection in question marks ¿ ? and exclamation marks ¡ !
  // : same pattern as ⌥F, each with its upper/lower toggle.
  let wrapQuestionEnabled = true;
  let wrapQuestionUpper = false;
  let wrapExclaimEnabled = true;
  let wrapExclaimUpper = false;
  chrome.storage.local.get(["unirEnabled", "splitEnabled", "unirParensEnabled", "unirParensUpper", "wrapParensEnabled", "wrapParensUpper", "wrapQuestionEnabled", "wrapQuestionUpper", "wrapExclaimEnabled", "wrapExclaimUpper"], (d) => {
    unirEnabled = d.unirEnabled !== false;
    splitEnabled = d.splitEnabled !== false;
    unirParensEnabled = d.unirParensEnabled !== false;
    unirParensUpper = d.unirParensUpper === true;
    wrapParensEnabled = d.wrapParensEnabled !== false;
    wrapParensUpper = d.wrapParensUpper === true;
    wrapQuestionEnabled = d.wrapQuestionEnabled !== false;
    wrapQuestionUpper = d.wrapQuestionUpper === true;
    wrapExclaimEnabled = d.wrapExclaimEnabled !== false;
    wrapExclaimUpper = d.wrapExclaimUpper === true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.unirEnabled) unirEnabled = changes.unirEnabled.newValue !== false;
    if (changes.splitEnabled) splitEnabled = changes.splitEnabled.newValue !== false;
    if (changes.unirParensEnabled) unirParensEnabled = changes.unirParensEnabled.newValue !== false;
    if (changes.unirParensUpper) unirParensUpper = changes.unirParensUpper.newValue === true;
    if (changes.wrapParensEnabled) wrapParensEnabled = changes.wrapParensEnabled.newValue !== false;
    if (changes.wrapParensUpper) wrapParensUpper = changes.wrapParensUpper.newValue === true;
    if (changes.wrapQuestionEnabled) wrapQuestionEnabled = changes.wrapQuestionEnabled.newValue !== false;
    if (changes.wrapQuestionUpper) wrapQuestionUpper = changes.wrapQuestionUpper.newValue === true;
    if (changes.wrapExclaimEnabled) wrapExclaimEnabled = changes.wrapExclaimEnabled.newValue !== false;
    if (changes.wrapExclaimUpper) wrapExclaimUpper = changes.wrapExclaimUpper.newValue === true;
  });

  // ── Utilidades ───────────────────────────────────────────────────────────

  /** Determines whether an element is editable (input, textarea or contenteditable) */
  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" && isTextInput(el)) return true;
    if (tag === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /** Filters out non-text inputs (checkbox, radio, etc.) */
  function isTextInput(input) {
    const textTypes = [
      "text", "search", "url", "tel", "email", "password", "", undefined,
    ];
    return textTypes.includes(input.type);
  }

  /** Reads the text of an editable element */
  function getText(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return el.value;
    }
    // contenteditable
    return el.innerText || el.textContent || "";
  }

  /** Writes text into an element and dispatches events for reactive frameworks */
  function setText(el, text) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      // React hack: override the native value setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === "INPUT"
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype,
        "value"
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
    } else {
      // contenteditable
      el.innerText = text;
    }

    dispatchChangeEvents(el);
  }

  /**
   * Dispatches the full event sequence so React, Vue, Angular and other
   * frameworks detect the change.
   */
  function dispatchChangeEvents(el) {
    // InputEvent — the most important one for React 16+
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
      })
    );

    // Event generico de change
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Enter KeyboardEvent (some editors use it to confirm)
    // Not included by default to avoid side effects.
  }

  /**
   * Transforms the captured text:
   *   - trim
   *   - first real LETTER to lowercase, skipping leading marks
   *     like ( ¿ ¡ ? ! " ' — etc. (keeps the rest of the text)
   */
  function transformText(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return "";
    // Find the first real letter (Unicode, includes accents: á, ñ, ü...)
    const idx = trimmed.search(/\p{L}/u);
    if (idx === -1) return trimmed; // sin letras: dejar igual
    return (
      trimmed.slice(0, idx) +
      trimmed.charAt(idx).toLowerCase() +
      trimmed.slice(idx + 1)
    );
  }

  /**
   * Symmetric to transformText: trim + first real LETTER to uppercase, skipping
   * leading opening marks like ( ¿ ¡ ? ! " ' — etc. (when splitting a line that
   * starts with "(", charAt(0) was not a letter and did not capitalize).
   * capitalizaba nada).
   */
  function transformToUpperFirst(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return "";
    const idx = trimmed.search(/\p{L}/u);
    if (idx === -1) return trimmed; // sin letras: dejar igual
    return (
      trimmed.slice(0, idx) +
      trimmed.charAt(idx).toUpperCase() +
      trimmed.slice(idx + 1)
    );
  }

  /** Reads the caret position. Inverse mirror of placeCursorAt. */
  function getCursorPos(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return el.selectionStart ?? 0;
    }
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return 0;
      const range = sel.getRangeAt(0);
      let pos = 0;
      for (const node of el.childNodes) {
        if (node === range.startContainer) {
          return pos + range.startOffset;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.contains?.(range.startContainer) || node === range.startContainer) {
            return pos + range.startOffset;
          }
          pos += node.length;
        } else if (node.contains && node.contains(range.startContainer)) {
          // startContainer esta anidado: aproximamos al inicio de este nodo
          return pos + range.startOffset;
        }
      }
      return pos;
    }
    return 0;
  }

  // ── Finding the previous element ───────────────────────────────────────

  /**
   * Collects all the visible editable elements on the page,
   * in DOM order (document order).
   */
  function getAllEditableElements() {
    const selectors = [
      'input[type="text"]',
      "input:not([type])",
      "textarea",
      "[contenteditable=true]",
      '[contenteditable="true"]',
      "[contenteditable=plaintext-only]",
      '[contenteditable="plaintext-only"]',
    ];

    const candidates = document.querySelectorAll(selectors.join(", "));
    const result = [];

    for (const el of candidates) {
      // Filtrar elementos ocultos
      if (el.offsetParent === null && el.style.position !== "fixed") continue;
      // Filter out non-text inputs
      if (el.tagName === "INPUT" && !isTextInput(el)) continue;
      result.push(el);
    }

    return result;
  }

  // ── Focus and cursor ────────────────────────────────────────────────────────

  /** Places the cursor at the given position within an element's content */
  function placeCursorAt(el, pos) {
    el.focus();
    MXMLog.log("[Unir Lineas] placeCursorAt tag=" + el.tagName + " isContentEditable=" + el.isContentEditable + " pos=" + pos + " valueLength=" + (el.value?.length ?? el.textContent?.length));

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.setSelectionRange(pos, pos);
      MXMLog.log("[Unir Lineas] selectionStart después de setSelectionRange:", el.selectionStart);
    } else if (el.isContentEditable) {
      const range = document.createRange();
      const sel = window.getSelection();
      // Find the text node and the position within it
      let remaining = pos;
      let placed = false;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (remaining <= node.length) {
            range.setStart(node, remaining);
            placed = true;
            break;
          }
          remaining -= node.length;
        }
      }
      if (!placed) {
        // Fallback: end of the content
        if (el.childNodes.length > 0) {
          const last = el.childNodes[el.childNodes.length - 1];
          if (last.nodeType === Node.TEXT_NODE) {
            range.setStart(last, last.length);
          } else {
            range.setStartAfter(last);
          }
        } else {
          range.setStart(el, 0);
        }
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // ── Logica principal ─────────────────────────────────────────────────────

  /**
   * Given an editable element, finds the first previous element that has text
   * (skipping empty fields).
   * Returns null if there is none with text.
   */
  function findPreviousNonEmpty(currentEl) {
    const all = getAllEditableElements();
    const index = all.indexOf(currentEl);

    if (index <= 0) return null;

    // Walk upward skipping empty fields
    for (let i = index - 1; i >= 0; i--) {
      const text = getText(all[i]).trim();
      if (text.length > 0) return all[i];
    }

    return null;
  }

  /**
   * Simula un click "real" sobre un elemento (pointerdown/mousedown/mouseup/click).
   * On sites like Musixmatch Studio, this fires the handler that marks the line
   * as active (removes readonly and moves the focus).
   */
  function simulateClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
    try { el.focus(); } catch (_) {}
  }

  /**
   * Tries to position the cursor several times to survive re-renders
   * tardios de React. Reintenta en rAF y en setTimeout(0).
   */
  function placeCursorPersistent(el, pos) {
    const attempt = () => {
      if (!el || !el.isConnected) return;
      placeCursorAt(el, pos);
    };
    attempt();
    requestAnimationFrame(attempt);
    requestAnimationFrame(() => requestAnimationFrame(attempt));
    setTimeout(attempt, 0);
    setTimeout(attempt, 30);
  }

  function mergeLine(opts = {}) {
    const active = document.activeElement;

    if (!isEditable(active)) return;

    const currentText = getText(active);
    if (!currentText || currentText.trim().length === 0) return;

    const targetEl = findPreviousNonEmpty(active);
    if (!targetEl) {
      MXMLog.warn("[Unir Lineas] No hay linea anterior con texto. Operacion cancelada.");
      return;
    }

    // Parentheses variant (⌥D): the merged text goes inside ( ) and its first
    // letter is upper or lowercase per the popup checkbox.
    let transformed = opts.parens && unirParensUpper
      ? transformToUpperFirst(currentText)
      : transformText(currentText);
    if (transformed.length === 0) return;
    if (opts.parens) transformed = "(" + transformed + ")";

    let targetText = getText(targetEl);
    const junctionPos = targetText.trimEnd().length;
    if (targetText.length > 0 && !targetText.endsWith(" ")) targetText += " ";
    const newText = targetText + transformed;

    // Snapshot of the number of editable fields before deleting the row.
    const beforeCount = getAllEditableElements().length;

    setText(active, "");
    simulateClick(targetEl);

    requestAnimationFrame(() => {
      let dest = targetEl;
      if (!dest.isConnected) {
        const focused = document.activeElement;
        if (isEditable(focused)) dest = focused;
      }
      setText(dest, newText);
      removeEmptyRow(active, dest, junctionPos, beforeCount);
    });

    MXMLog.log("[Unir Lineas] Linea unida.");
  }

  /**
   * Removes the row left empty after merging, imitating the human gesture:
   * cursor at the start of the empty row + Backspace (the editor merges with the
   * one above and deletes the row). Reuses dispatchBackspace and invokeReactKeyDown.
   * If the site rejects synthetic events (isTrusted), it degrades gracefully:
   * the row stays empty (previous behavior).
   */
  function removeEmptyRow(emptyEl, dest, junctionPos, beforeCount) {
    const finish = () => {
      const target = dest.isConnected ? dest : document.activeElement;
      if (isEditable(target)) placeCursorPersistent(target, junctionPos);
    };

    if (!emptyEl || !emptyEl.isConnected) {
      finish();
      return;
    }

    // Cursor at the start of the empty row + Backspace (synthetic + React bypass).
    emptyEl.focus();
    placeCursorAt(emptyEl, 0);
    dispatchBackspace(emptyEl);
    invokeReactKeyDown(emptyEl, "Backspace");

    setTimeout(() => {
      const afterCount = getAllEditableElements().length;
      if (afterCount < beforeCount || !emptyEl.isConnected) {
        finish(); // fila eliminada correctamente
      } else {
        MXMLog.warn(
          "[Unir Lineas] No se pudo borrar el renglon vacio " +
          "(posible bloqueo isTrusted). Queda vacio."
        );
        finish();
      }
    }, 60);
  }

  /** Despacha Backspace sintetico completo: KeyboardEvent + beforeinput + input. */
  function dispatchBackspace(el) {
    const keyInit = {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      which: 8,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
    el.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true, cancelable: true, composed: true,
    }));
    el.dispatchEvent(new KeyboardEvent("keypress", keyInit));
    el.dispatchEvent(new InputEvent("input", {
      inputType: "deleteContentBackward",
      bubbles: true, cancelable: true, composed: true,
    }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
  }

  /** Despacha Enter sintetico completo: KeyboardEvent + beforeinput + input. */
  function dispatchEnter(el) {
    const keyInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
    el.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "insertLineBreak",
      bubbles: true, cancelable: true, composed: true,
    }));
    el.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "insertParagraph",
      bubbles: true, cancelable: true, composed: true,
    }));
    el.dispatchEvent(new KeyboardEvent("keypress", keyInit));
    el.dispatchEvent(new InputEvent("input", {
      inputType: "insertLineBreak",
      bubbles: true, cancelable: true, composed: true,
    }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
  }

  /** Reads the props React attaches to the DOM (__reactProps$xxx key). */
  function getReactProps(el) {
    if (!el) return null;
    for (const key of Object.keys(el)) {
      if (key.startsWith("__reactProps$")) return el[key];
    }
    return null;
  }

  /**
   * Bypass isTrusted: busca handlers (onKeyDown / onKeyPress / onBeforeInput)
   * that React hooked onto the textarea or some parent, and invokes them directly.
   * Logs which ones it found for diagnostics.
   */
  function invokeReactKeyDown(el, key) {
    const found = [];
    let node = el;
    while (node && node !== document.body) {
      const props = getReactProps(node);
      if (props) {
        for (const name of ["onKeyDown", "onKeyPress", "onBeforeInput"]) {
          if (typeof props[name] === "function") {
            found.push({ node, name, fn: props[name] });
          }
        }
      }
      node = node.parentElement;
    }
    MXMLog.log(
      "[Unir Lineas DEBUG] React handlers para",
      key,
      ":",
      found.map((f) => f.name + "@" + (f.node.tagName || ""))
    );

    const keyCode = key === "Enter" ? 13 : key === "Backspace" ? 8 : 0;
    let invokedAny = false;
    for (const { fn, name, node: targetNode } of found) {
      try {
        if (name === "onBeforeInput") {
          fn({
            inputType: key === "Enter" ? "insertLineBreak" : "deleteContentBackward",
            target: el,
            currentTarget: targetNode,
            preventDefault() {}, stopPropagation() {},
            isDefaultPrevented: () => false, isPropagationStopped: () => false,
          });
        } else {
          fn({
            key, code: key, keyCode, which: keyCode,
            target: el, currentTarget: targetNode,
            nativeEvent: { key, code: key, keyCode, which: keyCode },
            bubbles: true, cancelable: true, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() {},
            isDefaultPrevented: () => false, isPropagationStopped: () => false,
          });
        }
        invokedAny = true;
      } catch (e) {
        MXMLog.warn("[Unir Lineas]", name, "lanzo:", e);
      }
    }
    return invokedAny;
  }

  /** Third path: synthetic paste with multi-line text. */
  function dispatchPasteMultiline(el, leftText, rightText) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", leftText + "\n" + rightText);
      const ev = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      el.dispatchEvent(ev);
      return true;
    } catch (e) {
      MXMLog.warn("[Unir Lineas] paste sintetico fallo:", e);
      return false;
    }
  }

  /**
   * Wraps the SELECTED text in a pair of marks (open/close). The first letter
   * of the enclosed text is upper or lowercase per `upper` (popup checkbox).
   * Text fields only (input/textarea): there the selection is read with
   * selectionStart/End. The spaces at the edges of the selection stay OUTSIDE
   * the marks.
   *   ⌥F  → ( )   ·   question → ¿ ?   ·   exclamation → ¡ !
   */
  function wrapSelection(open, close, upper) {
    const active = document.activeElement;
    if (!isEditable(active)) return;
    if (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA") {
      MXMLog.warn("[Unir Lineas] Envolver selección: solo input/textarea.");
      return;
    }
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (start === end) {
      MXMLog.warn("[Unir Lineas] Sin selección, nada que encerrar.");
      return;
    }
    const text = getText(active);
    const sel = text.slice(start, end);
    const inner = upper ? transformToUpperFirst(sel) : transformText(sel);
    if (inner.length === 0) return;
    const leadWs = sel.match(/^\s*/)[0];
    const trailWs = sel.match(/\s*$/)[0];
    const wrapped = leadWs + open + inner + close + trailWs;
    setText(active, text.slice(0, start) + wrapped + text.slice(end));
    placeCursorPersistent(active, start + wrapped.length);
    MXMLog.log("[Unir Lineas] Selección envuelta en", open, close);
  }

  function splitLine() {
    const active = document.activeElement;

    if (!isEditable(active)) return;

    const text = getText(active);
    if (!text || text.length === 0) return;

    const pos = getCursorPos(active);

    // Edge cases: cursor at the start or end (no text to move)
    if (pos <= 0 || pos >= text.length) {
      MXMLog.warn("[Unir Lineas] Cursor al inicio/final, nada que dividir.");
      return;
    }

    let leftRaw = text.slice(0, pos);
    let rightRaw = text.slice(pos);

    // If the cut lands on a ", " or ". " separator, we remove the punctuation
    // from both lines and let the word below start uppercase.
    const sepRight = rightRaw.match(/^\s*[,.]\s+/);
    if (sepRight) {
      rightRaw = rightRaw.slice(sepRight[0].length);
    }
    const sepLeft = leftRaw.match(/[,.]\s*$/);
    if (sepLeft) {
      leftRaw = leftRaw.slice(0, leftRaw.length - sepLeft[0].length);
    }

    const left = leftRaw.trimEnd();
    const right = transformToUpperFirst(rightRaw);

    if (right.length === 0) {
      MXMLog.warn("[Unir Lineas] Mitad derecha vacia, operacion cancelada.");
      return;
    }

    // Snapshot antes
    const beforeAll = getAllEditableElements();
    const beforeCount = beforeAll.length;
    const idxBefore = beforeAll.indexOf(active);
    const nextBefore =
      idxBefore >= 0 && idxBefore + 1 < beforeAll.length
        ? beforeAll[idxBefore + 1]
        : null;
    const nextHadContent = nextBefore && getText(nextBefore).trim().length > 0;

    const findInsertedRow = () => {
      const after = getAllEditableElements();
      if (after.length <= beforeCount) return null;
      const newOnes = after.filter((el) => !beforeAll.includes(el));
      return (
        newOnes.find((el) => getText(el).trim().length === 0) ||
        newOnes[0] ||
        null
      );
    };

    const finalize = (destino, fuente) => {
      setText(destino, right);
      placeCursorAt(destino, right.length);
      MXMLog.log("[Unir Lineas] Linea dividida (" + fuente + ").");
    };

    // PATH 1: put "\n" into the textarea value. If Musixmatch has paste-
    // multiline detection en onChange, va a partir en filas automaticamente.
    setText(active, left + "\n" + right);

    setTimeout(() => {
      let destino = findInsertedRow();
      if (destino) return finalize(destino, "value con \\n");

      // PATH 2: if PATH 1 failed, restore the original text and try synthetic paste.
      setText(active, text);
      placeCursorAt(active, pos);
      dispatchPasteMultiline(active, left, right);

      setTimeout(() => {
        destino = findInsertedRow();
        if (destino) return finalize(destino, "paste multilinea");

        // PATH 3: the one below was empty — easy case, no need to create a row.
        if (nextBefore && !nextHadContent) {
          setText(active, left);
          return finalize(nextBefore, "siguiente vacia");
        }

        // PATH 4: synthetic Enter + React bypass (probably useless given the log,
        // pero por si acaso).
        setText(active, left);
        dispatchEnter(active);
        invokeReactKeyDown(active, "Enter");

        setTimeout(() => {
          destino = findInsertedRow();
          if (destino) return finalize(destino, "Enter+React");

          const focused = document.activeElement;
          if (
            isEditable(focused) &&
            focused !== active &&
            getText(focused).trim().length === 0
          ) {
            return finalize(focused, "focus changed");
          }

          // Todo fallo. Restaurar estado original.
          MXMLog.warn(
            "[Unir Lineas] Musixmatch rechaza todos los metodos sinteticos " +
            "(probablemente chequea isTrusted). Estado restaurado. " +
            "Unica solucion: agregar permiso 'debugger' al manifest y usar " +
            "chrome.debugger.attach() + CDP Input.dispatchKeyEvent."
          );
          setText(active, text);
          placeCursorAt(active, pos);
        }, 60);
      }, 60);
    }, 60);
  }

  // ── Keyboard shortcut listener ────────────────────────────────────────

  document.addEventListener(
    "keydown",
    function (e) {
      if (!unirEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcut)) return;

      // Prevent the default behavior (move cursor, etc.)
      e.preventDefault();
      e.stopPropagation();

      mergeLine();
    },
    true // useCapture: interceptar antes que la pagina
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!splitEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcutSplit)) return;

      e.preventDefault();
      e.stopPropagation();

      splitLine();
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!unirParensEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcutParens)) return;

      e.preventDefault();
      e.stopPropagation();

      mergeLine({ parens: true });
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!wrapParensEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcutWrap)) return;

      e.preventDefault();
      e.stopPropagation();

      wrapSelection("(", ")", wrapParensUpper);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!wrapQuestionEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcutWrapQ)) return;

      e.preventDefault();
      e.stopPropagation();

      wrapSelection("¿", "?", wrapQuestionUpper);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!wrapExclaimEnabled) return;
      if (!window.MXMShortcuts.matches(e, shortcutWrapE)) return;

      e.preventDefault();
      e.stopPropagation();

      wrapSelection("¡", "!", wrapExclaimUpper);
    },
    true
  );

  // Trigger from the popup (▶ trigger).
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "MXM_RUN") return;
    if (msg.action === "unir" && unirEnabled) mergeLine();
    else if (msg.action === "split" && splitEnabled) splitLine();
    else if (msg.action === "unirParens" && unirParensEnabled) mergeLine({ parens: true });
    else if (msg.action === "wrapParens" && wrapParensEnabled) wrapSelection("(", ")", wrapParensUpper);
    else if (msg.action === "wrapQuestion" && wrapQuestionEnabled) wrapSelection("¿", "?", wrapQuestionUpper);
    else if (msg.action === "wrapExclaim" && wrapExclaimEnabled) wrapSelection("¡", "!", wrapExclaimUpper);
  });

  // Shared editing primitives (React-bypass). Consumed by instrumental.js at
  // runtime to insert text at the cursor.
  window.MXMEdit = {
    isEditable,
    getText,
    setText,
    getCursorPos,
    placeCursorAt,
    placeCursorPersistent,
  };

})();
