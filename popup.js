// =============================================================================
// MxM Tools — Popup (3 tabs)
//   1) Functions & shortcuts: toggle + trigger (▶) + "i" + shortcut recorder.
//   2) Floating buttons: toggle + trigger + "i" + foreground/background.
//   3) Highlighter: on/off, a list (color/name/shortcut/apply/clear) and
//      automatic marking of opened songs.
// Each action can be triggered from the popup (MXM_RUN message to the tab).
// =============================================================================

const I18N = window.MXMI18n;
const SC = window.MXMShortcuts;
const t = (k, p) => I18N.t(k, p);

// ── Metadata ─────────────────────────────────────────────────────────────────
const FUNCS = [
  { key: "unir",         toggle: "unirEnabled",         sc: "unir",         action: "unir" },
  { key: "split",        toggle: "splitEnabled",        sc: "split",        action: "split" },
  { key: "unirParens",   toggle: "unirParensEnabled",   sc: "unirParens",   action: "unirParens",   upperKey: "unirParensUpper" },
  { key: "wrapParens",   toggle: "wrapParensEnabled",   sc: "wrapParens",   action: "wrapParens",   upperKey: "wrapParensUpper" },
  { key: "wrapQuestion", toggle: "wrapQuestionEnabled", sc: "wrapQuestion", action: "wrapQuestion", upperKey: "wrapQuestionUpper" },
  { key: "wrapExclaim",  toggle: "wrapExclaimEnabled",  sc: "wrapExclaim",  action: "wrapExclaim",  upperKey: "wrapExclaimUpper" },
  { key: "wordCounter",  toggle: "wordCounterEnabled",  sc: "wordCounter",  action: "wordCounter" },
  { key: "instrumental", toggle: "instrumentalEnabled", sc: "instrumental", action: "instrumental" },
  { key: "gem",          toggle: "songToGemEnabled",    sc: "gem",          action: "gem" },
];
// Order/opensTab/default-off/groups: single source in btn-defs.js — this list
// and buttons-mxm.js's DEFS used to be two copies of the same order.
const BTNS = window.MXMBtnDefs.ORDER.map((key) => ({ key, opensTab: !!window.MXMBtnDefs.OPENS_TAB[key] }));

// Opt-in buttons (start OFF); the rest ON if there is no explicit key.
const BTN_DEFAULT_OFF = new Set(window.MXMBtnDefs.DEFAULT_OFF);

// Clusters: shown together in the popup list, with a PER-GROUP switch to
// group/separate them.
const POPUP_GROUPS = window.MXMBtnDefs.GROUPS;
const GROUP_OF = {};
for (const [ak, mem] of Object.entries(POPUP_GROUPS)) for (const k of mem) GROUP_OF[k] = ak;

// ── State ───────────────────────────────────────────────────────────────────
let floatingButtons = {}, btnTabConfig = {}, fnToggles = {};
// "Capitalize first letter" state of the wrap-selection features, by storage
// key (unirParensUpper, wrapParensUpper, wrapQuestionUpper, …).
let upperVals = {};
let autoAssistantOn = true;
let contributorLabelOn = true, autoContinueOn = true; // default ON
let contributorAutoCheckOn = true; // contributor auto-check on task open, default ON
let btnOrder = [];
let groupButtons = true; // legacy: default for each group (grouping is PER group)
let groupButtonsBy = {}; // { gemGroup: bool, … } — overrides the legacy default
let buttonsMasterOn = true; // master switch: show/hide ALL floating buttons
let buttonsMovable = false; // opt-in button drag (default: fixed)
const isGroupOn = (ak) => (groupButtonsBy[ak] === undefined ? groupButtons : groupButtonsBy[ak] !== false);

// Button order: the popup's order also drives the on-screen floating stack.
function orderedBtns() {
  if (!Array.isArray(btnOrder) || !btnOrder.length) return BTNS;
  const pos = (k) => {
    const i = btnOrder.indexOf(k);
    return i === -1 ? btnOrder.length + BTNS.findIndex((b) => b.key === k) : i;
  };
  return [...BTNS].sort((a, b) => pos(a.key) - pos(b.key));
}
let hlEnabled = true, hlAutoMark = true, hlAutoMarkMode = "on-open-not-completed", hlAutoMarkColor = "#b9f0cd";
let openedSongs = []; // auto-marked songs (exact match)
let openedKeywords = []; // manual keywords (substring)
let dotsAction = "highlight"; // right-click on the ⋯
let recording = null; // { kind:'fn', id }

const $ = (id) => document.getElementById(id);

// ── UI helpers ─────────────────────────────────────────────────────────────
function makeToggle(checked, onChange) {
  const l = document.createElement("label"); l.className = "switch";
  const i = document.createElement("input"); i.type = "checkbox"; i.checked = checked;
  i.addEventListener("change", () => onChange(i.checked));
  const s = document.createElement("span"); s.className = "slider";
  l.append(i, s); return l;
}
function makeInfo(tipKey) {
  const wrap = document.createElement("span"); wrap.className = "info"; wrap.textContent = "i";
  const tip = document.createElement("span"); tip.className = "tip"; tip.textContent = t(tipKey);
  wrap.appendChild(tip); return wrap;
}
function makeTrigger(action) {
  const b = document.createElement("button"); b.className = "trigger"; b.textContent = "▶";
  b.title = t("popup.trigger");
  b.addEventListener("click", () => runAction(action));
  return b;
}
function label(name, dotColor) {
  const l = document.createElement("span"); l.className = "row-label";
  if (dotColor) { const d = document.createElement("span"); d.className = "dot"; d.style.background = dotColor; l.appendChild(d); }
  const n = document.createElement("span"); n.className = "name"; n.textContent = name; l.appendChild(n);
  return l;
}

// ── Trigger to the active tab ───────────────────────────────────────────────
function sendToActiveTab(msg) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) { resolve({ error: true }); return; }
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        if (chrome.runtime.lastError || res === undefined) { resolve({ error: true }); return; }
        resolve(res || {});
      });
    });
  });
}
function runAction(action) { sendToActiveTab({ type: "MXM_RUN", action }); }

// ── Shortcut recorder (functions) ─────────────────────────────────────────────
function scWarn(msg) { $("sc-warn").textContent = msg || ""; }
function allBindings() {
  // current function shortcuts, to detect clashes
  const out = [];
  for (const id of SC.IDS) out.push({ kind: "fn", id, name: t(SC.META[id].labelKey), b: SC.all()[id] });
  return out;
}
function conflict(kind, id, b) {
  for (const o of allBindings()) {
    if (o.kind === kind && o.id === id) continue;
    if (SC.eq(b, o.b)) return o.name;
  }
  return null;
}
function onRecordKeydown(e) {
  if (!recording) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === "Escape") { recording = null; scWarn(""); renderActiveTab(); return; }
  if (SC.isModifierOnly(e)) return;
  const b = SC.fromEvent(e);
  const clash = conflict(recording.kind, recording.id, b);
  if (clash) { scWarn(t("popup.sc.conflict", { name: clash })); return; }
  const rec = recording; recording = null; scWarn("");
  if (rec.kind === "fn") SC.save(rec.id, b);
}

// ── Tab 1: functions ──────────────────────────────────────────────────────────
// Each function goes in its own BLOCK (.blk) so it is clear where it starts and
// ends; inside, the main row + "Shortcut:" + extras.
function fnBlock(list) {
  const blk = document.createElement("div"); blk.className = "blk";
  list.appendChild(blk);
  return blk;
}

function renderFunctions() {
  const list = $("functions-list"); list.innerHTML = "";
  const all = SC.all();
  for (const fn of FUNCS) {
    const blk = fnBlock(list);
    const row = document.createElement("div"); row.className = "row";
    const on = fnToggles[fn.toggle] !== false;
    row.appendChild(label(t("popup.fn." + fn.key)));
    row.appendChild(makeInfo("popup.info." + fn.key));
    row.appendChild(makeTrigger(fn.action));
    row.appendChild(makeToggle(on, (v) => { fnToggles[fn.toggle] = v; chrome.storage.local.set({ [fn.toggle]: v }); }));
    blk.appendChild(row);

    const sub = document.createElement("div"); sub.className = "sub-row";
    // Explicit "Shortcut:" label (before, it was unclear what the key was).
    const scLbl = document.createElement("span"); scLbl.className = "sc-label"; scLbl.textContent = t("popup.sc.label");
    const key = document.createElement("button");
    key.className = "sc-key" + (recording && recording.kind === "fn" && recording.id === fn.sc ? " recording" : "");
    key.textContent = recording && recording.kind === "fn" && recording.id === fn.sc ? t("popup.sc.press") : SC.format(all[fn.sc]);
    key.addEventListener("click", () => { scWarn(""); recording = (recording && recording.id === fn.sc) ? null : { kind: "fn", id: fn.sc }; renderFunctions(); });
    const rst = document.createElement("button"); rst.className = "sc-reset"; rst.textContent = "↺";
    rst.title = t("popup.sc.resetTitle", { key: SC.format(SC.DEFAULTS[fn.sc]) });
    rst.addEventListener("click", () => { if (recording && recording.id === fn.sc) recording = null; SC.reset(fn.sc); });
    sub.append(scLbl, key, rst);
    blk.appendChild(sub);

    // Merge/wrap selection: an upper/lowercase-first checkbox inside the marks —
    // each function with its own toggle (unirParensUpper, …).
    if (fn.upperKey) {
      const psub = document.createElement("div"); psub.className = "sub-row";
      const lbl = document.createElement("label"); lbl.className = "chk-label";
      const cb = document.createElement("input"); cb.type = "checkbox";
      cb.checked = upperVals[fn.upperKey] === true;
      cb.addEventListener("change", () => {
        upperVals[fn.upperKey] = cb.checked;
        chrome.storage.local.set({ [fn.upperKey]: cb.checked });
      });
      const sp = document.createElement("span"); sp.textContent = t("popup.parens.upper");
      lbl.append(cb, sp); psub.appendChild(lbl);
      blk.appendChild(psub);
    }
  }

  // Standalone toggles (no shortcut), each in its own block to keep the rhythm.
  const simple = [
    // Auto-close the Assistant panel when a task opens (default ON).
    ["autoAssistant", autoAssistantOn, (v) => { autoAssistantOn = v; chrome.storage.local.set({ autoCloseAssistant: v }); }],
    // Auto-check the last contributor when the task opens (default ON).
    ["contributorAutoCheck", contributorAutoCheckOn, (v) => { contributorAutoCheckOn = v; chrome.storage.local.set({ contributorAutoCheck: v }); }],
    // Fixed last-contributor label bottom-right (default ON).
    ["contributorLabel", contributorLabelOn, (v) => { contributorLabelOn = v; chrome.storage.local.set({ contributorFixedLabel: v }); }],
    // Auto-click "Continue" on the "Thanks..." banner (default ON).
    ["autoContinue", autoContinueOn, (v) => { autoContinueOn = v; chrome.storage.local.set({ autoContinueThanks: v }); }],
  ];
  for (const [key, on, onChange] of simple) {
    const blk = fnBlock(list);
    const row = document.createElement("div"); row.className = "row";
    row.appendChild(label(t("popup.fn." + key)));
    row.appendChild(makeInfo("popup.info." + key));
    row.appendChild(makeToggle(on, onChange));
    blk.appendChild(row);
  }
}

// ── Tab 2: floating buttons ──────────────────────────────────────────────────
// Fixed style: always square + black and white (no options).
function renderBtnStyle() {
  const m = $("btn-master"); if (m) m.checked = buttonsMasterOn;
  const mv = $("btn-movable"); if (mv) mv.checked = buttonsMovable;
}

// "Reorder" mode: the rows are dragged (drag & drop) and the resulting order
// also defines the on-screen floating-button stack.
let reorderMode = false;

function persistOrderFromDom() {
  btnOrder = Array.from($("buttons-list").querySelectorAll(".row[data-key]")).map((el) => el.dataset.key);
  chrome.storage.local.set({ btnOrder });
}

function renderButtons() {
  renderBtnStyle();
  const reorderBtn = $("btn-reorder");
  reorderBtn.textContent = t(reorderMode ? "popup.reorderDone" : "popup.reorder");
  reorderBtn.classList.toggle("active", reorderMode);
  const list = $("buttons-list"); list.innerHTML = "";
  const ordered = orderedBtns();
  for (const def of ordered) {
    // The opt-in ones (BTN_DEFAULT_OFF) start off; the rest ON unless the key is false.
    const on = BTN_DEFAULT_OFF.has(def.key) ? floatingButtons[def.key] === true : floatingButtons[def.key] !== false;

    // In reorder mode the row is just a handle + name, draggable (no blocks).
    if (reorderMode) {
      const row = document.createElement("div"); row.className = "row";
      row.dataset.key = def.key;
      row.classList.add("reorder");
      row.draggable = true;
      const grip = document.createElement("span"); grip.className = "drag-grip"; grip.textContent = "⠿";
      row.appendChild(grip);
      row.appendChild(label(t("popup.btn." + def.key)));
      row.addEventListener("dragstart", (e) => {
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", def.key); } catch (_) {}
      });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); persistOrderFromDom(); });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = list.querySelector(".row.dragging");
        if (!dragging || dragging === row) return;
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        list.insertBefore(dragging, before ? row : row.nextSibling);
      });
      list.appendChild(row);
      continue;
    }

    // Clusters: the groupable buttons go TOGETHER in a group block with a header
    // (name + individual grouping switch). On hitting the 1st member the whole
    // cluster is drawn; the rest are skipped.
    const ak = GROUP_OF[def.key];
    if (ak) {
      if (list.querySelector(`[data-group="${ak}"]`)) continue; // cluster already drawn
      const gblk = document.createElement("div"); gblk.className = "blk blk-group";
      gblk.dataset.group = ak;
      const head = document.createElement("div"); head.className = "row group-head";
      const nm = document.createElement("span"); nm.className = "group-name"; nm.textContent = t("popup.btn." + ak);
      head.appendChild(nm);
      head.appendChild(makeInfo("popup.info.groupSwitch")); // what the grouping switch does
      head.appendChild(makeToggle(isGroupOn(ak), (v) => {
        groupButtonsBy[ak] = v;
        chrome.storage.local.set({ groupButtonsBy });
        renderButtons();
      }));
      head.title = t("popup.btnStyle.groupLabel");
      gblk.appendChild(head);
      // Members in the list's current order.
      for (const mdef of ordered.filter((x) => GROUP_OF[x.key] === ak)) {
        const mon = BTN_DEFAULT_OFF.has(mdef.key) ? floatingButtons[mdef.key] === true : floatingButtons[mdef.key] !== false;
        appendBtnRows(gblk, mdef, mon, true);
      }
      list.appendChild(gblk);
      continue;
    }

    // Standalone button: its own block.
    const blk = document.createElement("div"); blk.className = "blk";
    appendBtnRows(blk, def, on, false);
    list.appendChild(blk);
  }
}

// A button's row (+ sub-rows) inside a block/cluster.
function appendBtnRows(blk, def, on, inGroup) {
  const row = document.createElement("div"); row.className = "row" + (inGroup ? " group-member" : "");
  row.dataset.key = def.key;
  row.appendChild(label(t("popup.btn." + def.key)));
  row.appendChild(makeInfo("popup.info." + def.key));
  // saveSend: no ▶ (triggering it would send a REAL task).
  if (def.key !== "saveSend") row.appendChild(makeTrigger(def.key));
  row.appendChild(makeToggle(on, (v) => { floatingButtons[def.key] = v; chrome.storage.local.set({ floatingButtons }); renderButtons(); }));
  blk.appendChild(row);

  if (def.opensTab && on) {
    const sub = document.createElement("div"); sub.className = "sub-row";
    const s = document.createElement("span"); s.textContent = t("popup.tab.openIn"); sub.appendChild(s);
    const seg = document.createElement("div"); seg.className = "seg";
    // With no saved config, the default is BACKGROUND.
    const isBg = !(btnTabConfig[def.key] && btnTabConfig[def.key].background === false);
    const mk = (labelKey, bg) => {
      const b = document.createElement("button"); b.textContent = t(labelKey); b.className = isBg === bg ? "active" : "";
      b.addEventListener("click", () => { btnTabConfig[def.key] = { background: bg }; chrome.storage.sync.set({ btnTabConfig }); renderButtons(); });
      return b;
    };
    seg.append(mk("popup.tab.foreground", false), mk("popup.tab.background", true));
    sub.appendChild(seg);
    blk.appendChild(sub);
  }

  // Save: the lyrics are saved into a folder by the day's DATE.
  if (def.key === "save" && on) {
    const sub = document.createElement("div"); sub.className = "sub-row";
    const hint = document.createElement("span"); hint.className = "hint"; hint.textContent = t("popup.save.byDate");
    sub.appendChild(hint);
    blk.appendChild(sub);
  }
}

// ── Tab 3: highlighter ────────────────────────────────────────────────────────
// No list system: what remains is the on/off of manual highlighting (right-click
// on a selection) and the auto-marking of already-opened songs with its list.
function renderHighlighter() {
  $("hl-enabled").checked = hlEnabled;
  $("hl-automark").checked = hlAutoMark;
  $("hl-automark-mode-row").style.display = hlAutoMark ? "" : "none";
  $("hl-automark-color-row").style.display = hlAutoMark ? "" : "none";
  $("hl-automark-color").value = hlAutoMarkColor;
  document.querySelectorAll("#hl-automark-mode button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === hlAutoMarkMode);
  });
  renderOpened();
}

// "Opened songs" list (auto-mark): vertical LIST format (batch 9, replaces the
// bubbles): collapsible header with a count, rows with an × on the right
// (selectable text → the whole list can be copied), and "Add" at the bottom.
let openedExpanded = true; // in the popup's memory
function renderOpened() {
  const box = $("hl-opened"); if (!box) return; box.innerHTML = "";

  // Header: caret + title + count (auto + keywords).
  const head = document.createElement("div"); head.className = "songlist-head";
  const caret = document.createElement("button"); caret.className = "hl-caret"; caret.textContent = openedExpanded ? "▾" : "▸";
  const title = document.createElement("span"); title.className = "songlist-title"; title.textContent = t("popup.hl.openedTitle");
  const count = document.createElement("span"); count.className = "hl-count"; count.textContent = String(openedSongs.length + openedKeywords.length);
  head.append(caret, title, count);
  head.addEventListener("click", () => { openedExpanded = !openedExpanded; renderHighlighter(); });
  box.appendChild(head);
  if (!openedExpanded) return;

  const hint = document.createElement("div"); hint.className = "hint"; hint.textContent = t("popup.hl.addHint");
  box.appendChild(hint);

  // Vertical list with scroll; the text is selectable (copy the whole list).
  // Auto (exact match) and manual keywords (substring) are shown together.
  const list = document.createElement("div"); list.className = "songlist";
  if (!openedSongs.length && !openedKeywords.length) {
    const empty = document.createElement("div"); empty.className = "hl-empty songline-empty"; empty.textContent = t("popup.hl.openedEmpty");
    list.appendChild(empty);
  }
  const addLine = (label, onRemove) => {
    const line = document.createElement("div"); line.className = "songline";
    const tx = document.createElement("span"); tx.className = "songline-tx"; tx.textContent = label;
    const x = document.createElement("button"); x.className = "songline-x"; x.textContent = "×";
    x.title = t("popup.hl.openedRemove");
    x.addEventListener("click", onRemove);
    line.append(tx, x); list.appendChild(line);
  };
  for (const key of openedSongs) {
    addLine(key.replace(/ — $/, ""), () => {
      openedSongs = openedSongs.filter((k) => k !== key);
      chrome.storage.local.set({ openedSongs }, renderHighlighter);
    });
  }
  for (const kw of openedKeywords) {
    addLine(kw, () => {
      openedKeywords = openedKeywords.filter((k) => k !== kw);
      chrome.storage.local.set({ openedKeywords }, renderHighlighter);
    });
  }
  box.appendChild(list);

  // A single "add" field (keyword). Type + Enter adds and leaves the field
  // ready for another (list pattern).
  const add = document.createElement("div"); add.className = "hl-additem hl-addsong";
  const inp = document.createElement("input"); inp.className = "hl-additem-inp"; inp.placeholder = t("popup.hl.addEntry");
  const btn = document.createElement("button"); btn.className = "hl-additem-btn"; btn.textContent = "+";
  const doAdd = () => {
    const s = inp.value.trim(); if (!s) return;
    if (!openedKeywords.includes(s)) openedKeywords.push(s);
    inp.value = "";
    chrome.storage.local.set({ openedKeywords }, () => { renderHighlighter(); inp.focus(); });
  };
  btn.addEventListener("click", doAdd);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
  add.append(inp, btn); box.appendChild(add);

  // Clear the whole list (auto + keywords), with a simple confirmation.
  const clear = document.createElement("button"); clear.className = "btn-add"; clear.textContent = t("popup.hl.clearAll");
  clear.addEventListener("click", () => {
    if (!openedSongs.length && !openedKeywords.length) return;
    if (!confirm(t("popup.hl.clearConfirm"))) return;
    openedSongs = []; openedKeywords = [];
    chrome.storage.local.set({ openedSongs, openedKeywords }, renderHighlighter);
  });
  box.appendChild(clear);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
// The active tab is remembered across openings ("popupActiveTab"). The popup
// window POSITION is not controllable: Chrome anchors it to the icon.
function switchTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + name));
  chrome.storage.local.set({ popupActiveTab: name });
}
function renderActiveTab() { renderFunctions(); renderDots(); renderButtons(); renderHighlighter(); }

// ── Baseline (functions tab) ───────────────────────────────────────────
async function refreshBaseline() {
  const el = $("baseline-status"); el.classList.remove("ok"); el.textContent = t("popup.baseline.checking");
  const res = await sendToActiveTab({ action: "baselineStatus" });
  if (res.error || res.exists === undefined) { el.textContent = t("popup.baseline.notTask"); return; }
  if (res.exists) {
    const d = new Date(res.ts);
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    el.classList.add("ok"); el.textContent = t("popup.baseline.saved", { time, song: res.song || "?" });
  } else el.textContent = t("popup.baseline.none");
}
// The "Save original now" button was removed from the popup: the original is
// captured on task open; only the status remains here.

// ── Language / info / options ──────────────────────────────────────────────────
function renderLang() {
  const sel = $("lang-select"); sel.innerHTML = "";
  // Auto language: 1st option of the dropdown, not a separate switch.
  const auto = I18N.isAuto();
  const optAuto = document.createElement("option"); optAuto.value = "auto"; optAuto.textContent = t("popup.lang.auto");
  if (auto) optAuto.selected = true; sel.appendChild(optAuto);
  for (const l of I18N.LANGS) {
    const o = document.createElement("option"); o.value = l.code; o.textContent = l.name;
    if (!auto && l.code === I18N.getLang()) o.selected = true; sel.appendChild(o);
  }
}
$("lang-select").addEventListener("change", (e) => {
  if (e.target.value === "auto") I18N.setAuto(true);
  else I18N.setLang(e.target.value); // setLang already turns auto off
});

// Right-click on the cards' ⋯: a 3-option selector.
function renderDots() {
  document.querySelectorAll("#dots-action button").forEach((b) => {
    b.classList.toggle("active", b.dataset.dots === dotsAction);
  });
}
document.querySelectorAll("#dots-action button").forEach((b) => b.addEventListener("click", () => {
  dotsAction = b.dataset.dots;
  chrome.storage.local.set({ dotsRightClickAction: dotsAction });
  renderDots();
}));
$("info-btn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("info.html") }));
$("options-link").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

// Tabs + highlighter controls
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("hl-enabled").addEventListener("change", (e) => { hlEnabled = e.target.checked; chrome.storage.local.set({ hlEnabled }); });
$("hl-automark").addEventListener("change", (e) => { hlAutoMark = e.target.checked; chrome.storage.local.set({ hlAutoMarkOpened: hlAutoMark }); renderHighlighter(); });
document.querySelectorAll("#hl-automark-mode button").forEach((b) => b.addEventListener("click", () => { hlAutoMarkMode = b.dataset.mode; chrome.storage.local.set({ hlAutoMarkMode }); renderHighlighter(); }));
$("hl-automark-color").addEventListener("input", (e) => { hlAutoMarkColor = e.target.value; chrome.storage.local.set({ hlAutoMarkColor }); });
$("btn-master").addEventListener("change", (e) => { buttonsMasterOn = e.target.checked; chrome.storage.local.set({ floatingButtonsOn: buttonsMasterOn }); });
$("btn-movable").addEventListener("change", (e) => { buttonsMovable = e.target.checked; chrome.storage.local.set({ buttonsMovable }); });
$("btn-reorder").addEventListener("click", () => { reorderMode = !reorderMode; renderButtons(); });
$("btn-reset-pos").addEventListener("click", () => {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((k) => k.startsWith("btnPos:"));
    if (keys.length) chrome.storage.local.remove(keys);
  });
});

// ── Full render ───────────────────────────────────────────────────────────
function renderAll() { I18N.applyDom(document); renderLang(); renderActiveTab(); refreshBaseline(); }

window.addEventListener("keydown", onRecordKeydown, true);
SC.onChange(renderFunctions);
I18N.onChange(renderAll);

// ── Hydration ───────────────────────────────────────────────────────────────
const FN_KEYS = FUNCS.map((f) => f.toggle);
const UPPER_KEYS = FUNCS.filter((f) => f.upperKey).map((f) => f.upperKey);
chrome.storage.local.get(["floatingButtons", "hlEnabled", "openedSongs", "openedKeywords", "dotsRightClickAction", "hlAutoMarkOpened", "hlAutoMarkMode", "hlAutoMarkColor", ...UPPER_KEYS,
  "autoCloseAssistant", "contributorFixedLabel", "contributorAutoCheck", "autoContinueThanks", "popupActiveTab", "btnOrder", "groupButtons", "groupButtonsBy", "floatingButtonsOn", "buttonsMovable", ...FN_KEYS], (local) => {
  floatingButtons = local.floatingButtons || {};
  for (const k of FN_KEYS) fnToggles[k] = local[k];
  for (const k of UPPER_KEYS) upperVals[k] = local[k] === true;
  autoAssistantOn = local.autoCloseAssistant !== false;        // default ON
  contributorLabelOn = local.contributorFixedLabel !== false;  // default ON
  contributorAutoCheckOn = local.contributorAutoCheck !== false; // default ON
  autoContinueOn = local.autoContinueThanks !== false;         // default ON
  btnOrder = Array.isArray(local.btnOrder) ? local.btnOrder : [];
  groupButtons = local.groupButtons !== false; // legado (default de cada grupo)
  groupButtonsBy = local.groupButtonsBy && typeof local.groupButtonsBy === "object" ? local.groupButtonsBy : {};
  buttonsMasterOn = local.floatingButtonsOn !== false; // default ON
  buttonsMovable = local.buttonsMovable === true; // default OFF (fixed)
  if (local.popupActiveTab) switchTab(local.popupActiveTab);
  hlEnabled = local.hlEnabled !== false;
  openedSongs = Array.isArray(local.openedSongs) ? local.openedSongs : [];
  openedKeywords = Array.isArray(local.openedKeywords) ? local.openedKeywords : [];
  dotsAction = local.dotsRightClickAction || "highlight";
  hlAutoMark = local.hlAutoMarkOpened !== false; // default ON
  hlAutoMarkMode = local.hlAutoMarkMode || "on-open-not-completed";
  hlAutoMarkColor = local.hlAutoMarkColor || "#b9f0cd";
  chrome.storage.sync.get("btnTabConfig", (sync) => { btnTabConfig = sync.btnTabConfig || {}; renderAll(); });
});
