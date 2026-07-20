// options.js — Loads and saves the settings in chrome.storage.sync.
// Section 1: Song → Gem (transcription). Section 2: comparison and contributor
// message (messageGemUrl, curatorName, diffMode). Language: uiLang
// (storage.local, via MXMI18n).

// Prompt templates: configurable, same pattern as message_template
// (placeholders {x} substituted with .replaceAll). The defaults are the text
// sent to the Gems; they stay in Spanish because the Gems produce Spanish.
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
const DEFAULT_REVIEW_TEMPLATE = [
  "Revisá y corregí la siguiente letra ya transcripta según tus instrucciones",
  "(esta vez no hay link de YouTube: la letra va pegada acá).",
  "Devolvé SOLO la letra corregida, sin comentarios.",
  "",
  "Canción: {song} — {artist}",
  "",
  "{lyrics}",
].join("\n");

const DEFAULTS = {
  gem_url: "",
  ui_mode: "overlay",
  yt_method: "http", // http (fast fetch) | browser (opens the page and searches by hand)
  auto_always: false,
  auto_threshold: 65,
  message_template: "{url}",
  num_candidates: 5,
  load_delay_ms: 3000,
  open_in_background: true,
  gemReviewTemplate: DEFAULT_REVIEW_TEMPLATE,
  // Comparison and message
  messageGemUrl: "",
  curatorName: "",
  contributorMessageTemplate: DEFAULT_MSG_TEMPLATE,
  diffMode: "direct", // direct | intermediate
  // Typeforms (links updatable from options; default preloaded)
  slackTypeformUrl: "https://musixmatch.typeform.com/to/aPDyFFta",
  // Name + email shared by the Typeforms (prefill; resolve the email step)
  reportName: "",
  reportEmail: "",
};

const $ = (id) => document.getElementById(id);
const I18N = window.MXMI18n;

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("gem_url").value = s.gem_url;
  $("ui_mode").value = s.ui_mode;
  $("yt_method").value = s.yt_method;
  $("auto_always").checked = s.auto_always;
  $("auto_threshold").value = s.auto_threshold;
  $("num_candidates").value = s.num_candidates;
  $("message_template").value = s.message_template;
  $("gemReviewTemplate").value = s.gemReviewTemplate;
  $("load_delay_ms").value = s.load_delay_ms;
  $("open_in_background").checked = s.open_in_background;
  $("messageGemUrl").value = s.messageGemUrl;
  $("curatorName").value = s.curatorName;
  $("contributorMessageTemplate").value = s.contributorMessageTemplate;
  $("diffMode").value = s.diffMode;
  $("slackTypeformUrl").value = s.slackTypeformUrl;
  $("reportName").value = s.reportName;
  $("reportEmail").value = s.reportEmail;
  // savePath, btnAnimation and the auto-Flash toggles live in storage.local.
  const l = await chrome.storage.local.get(["savePath", "btnAnimation",
    "gemFlashAuto_transcriptor", "gemFlashAuto_message", "gemFlashAuto_review"]);
  $("save_path").value = l.savePath || "LyricsBackups";
  $("btn_animation").value = l.btnAnimation || "random"; // default: random
  $("flash_transcriptor").checked = l.gemFlashAuto_transcriptor !== false; // default ON
  $("flash_message").checked = l.gemFlashAuto_message !== false;
  $("flash_review").checked = l.gemFlashAuto_review !== false;
  // Baseline for the scoped save (see save()): just read from storage, so the
  // session's first save() only sends what the user actually changed since the
  // page opened.
  lastSync = currentSyncValues();
  lastLocal = currentLocalValues();
  loadShortcut();
  renderI18n();
}

// The "Song → Gem" shortcut is configured from the popup (⌥G by default). Here
// we only display it, reading it from the shared registry.
function loadShortcut() {
  const SC = window.MXMShortcuts;
  if (!SC) {
    $("shortcut").textContent = "—";
    return;
  }
  const paint = () => { $("shortcut").textContent = SC.format(SC.get("gem")); };
  SC.onChange(paint);
  paint();
}

// Last confirmed read from storage (updated in load() and after each successful
// save()). save() compares against THIS, not a fixed snapshot from load time:
// in multi-device, sync may bring a new value from ANOTHER device while this
// page stays open; writing ALL fields always (with the DOM's already-stale
// values) would clobber that external change. Comparing against the last known
// read and sending only what the user really touched avoids that clash.
let lastSync = {}, lastLocal = {};

function currentSyncValues() {
  return {
    gem_url: $("gem_url").value.trim(),
    ui_mode: $("ui_mode").value,
    yt_method: $("yt_method").value === "browser" ? "browser" : "http",
    auto_always: $("auto_always").checked,
    auto_threshold: clamp(parseInt($("auto_threshold").value, 10), 0, 100, 65),
    num_candidates: clamp(parseInt($("num_candidates").value, 10), 1, 15, 5),
    message_template: $("message_template").value || "{url}",
    gemReviewTemplate: $("gemReviewTemplate").value.trim() || DEFAULT_REVIEW_TEMPLATE,
    load_delay_ms: clamp(parseInt($("load_delay_ms").value, 10), 0, 30000, 3000),
    open_in_background: $("open_in_background").checked,
    messageGemUrl: $("messageGemUrl").value.trim(),
    curatorName: $("curatorName").value.trim(),
    contributorMessageTemplate: $("contributorMessageTemplate").value.trim() || DEFAULT_MSG_TEMPLATE,
    diffMode: $("diffMode").value === "intermediate" ? "intermediate" : "direct",
    slackTypeformUrl: $("slackTypeformUrl").value.trim() || DEFAULTS.slackTypeformUrl,
    reportName: $("reportName").value.trim(),
    reportEmail: $("reportEmail").value.trim(),
  };
}
function currentLocalValues() {
  return {
    savePath: $("save_path").value.trim() || "LyricsBackups",
    btnAnimation: $("btn_animation").value,
    gemFlashAuto_transcriptor: $("flash_transcriptor").checked,
    gemFlashAuto_message: $("flash_message").checked,
    gemFlashAuto_review: $("flash_review").checked,
  };
}
// Subset of `next` whose keys differ from `prev` (simple comparison: all values
// here are string/number/boolean, never nested objects).
function diffOnly(prev, next) {
  const out = {};
  for (const k in next) if (next[k] !== prev[k]) out[k] = next[k];
  return out;
}

async function save() {
  const nextSync = currentSyncValues();
  const nextLocal = currentLocalValues();
  const syncChanges = diffOnly(lastSync, nextSync);
  const localChanges = diffOnly(lastLocal, nextLocal);
  const st = $("status");
  try {
    if (Object.keys(syncChanges).length) await chrome.storage.sync.set(syncChanges);
    if (Object.keys(localChanges).length) await chrome.storage.local.set(localChanges);
    lastSync = nextSync;
    lastLocal = nextLocal;
    st.classList.remove("error");
    st.textContent = I18N.t("opt.saved");
  } catch (e) {
    st.classList.add("error");
    st.textContent = I18N.t("opt.saveError");
    console.warn("[MxM ST] options: save failed:", e);
  }
  setTimeout(() => { st.textContent = ""; st.classList.remove("error"); }, 1500);
}

function clamp(n, min, max, fallback) {
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ── Language ────────────────────────────────────────────────────────────────
const langSelect = $("lang-select");

function renderLangSelect() {
  langSelect.innerHTML = "";
  // Auto language: 1st option of the dropdown, not a separate switch.
  const auto = I18N.isAuto();
  const optAuto = document.createElement("option");
  optAuto.value = "auto"; optAuto.textContent = I18N.t("popup.lang.auto");
  if (auto) optAuto.selected = true;
  langSelect.appendChild(optAuto);
  for (const l of I18N.LANGS) {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.name;
    if (!auto && l.code === I18N.getLang()) opt.selected = true;
    langSelect.appendChild(opt);
  }
}
langSelect.addEventListener("change", () => {
  if (langSelect.value === "auto") I18N.setAuto(true);
  else I18N.setLang(langSelect.value); // setLang already turns auto off
});

function renderI18n() {
  I18N.applyDom(document);
  renderLangSelect();
}
I18N.onChange(renderI18n);

// ── Export / Import of the whole configuration ─────────────────────────────
// storage.local and storage.sync keys that make up the exportable config.
const LOCAL_KEYS = [
  "mxmShortcuts", "uiLang", "uiLangAuto", "floatingButtons", "dotsRightClickAction",
  "unirEnabled", "splitEnabled", "wordCounterEnabled", "songToGemEnabled", "instrumentalEnabled",
  "unirParensEnabled", "unirParensUpper", "wrapParensEnabled", "wrapParensUpper",
  "wrapQuestionEnabled", "wrapQuestionUpper", "wrapExclaimEnabled", "wrapExclaimUpper",
  "hlEnabled", "hlPhrases", "hlAutoMarkOpened", "hlAutoMarkMode", "hlAutoMarkColor", "openedSongs", "openedKeywords",
  "gemFlashAuto_transcriptor", "gemFlashAuto_message", "gemFlashAuto_review",
  "autoCloseAssistant", "autoContinueThanks", "contributorAutoCheck", "contributorFixedLabel",
  "btnOrder", "groupButtons", "groupButtonsBy", "floatingButtonsOn", "buttonsMovable",
  "btnAnimation", "savePath",
];
const SYNC_KEYS = [
  "gem_url", "ui_mode", "yt_method", "auto_always", "auto_threshold", "num_candidates",
  "message_template", "gemReviewTemplate", "load_delay_ms", "open_in_background",
  "messageGemUrl", "curatorName", "contributorMessageTemplate", "diffMode", "btnTabConfig",
  "slackTypeformUrl", "reportName", "reportEmail",
];

function backupStatus(msg) {
  const el = $("backup-status");
  el.textContent = msg;
  setTimeout(() => (el.textContent = ""), 2500);
}

// Positions of dragged buttons: dynamic key "btnPos:<key>", one per button the
// user moved. They are not in LOCAL_KEYS (which ones exist is not known ahead of
// time); they are found by prefix over all of storage.local.
async function getBtnPositions() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const k of Object.keys(all)) if (k.startsWith("btnPos:")) out[k] = all[k];
  return out;
}

async function doExport() {
  const local = await chrome.storage.local.get(LOCAL_KEYS);
  Object.assign(local, await getBtnPositions());
  const sync = await chrome.storage.sync.get(SYNC_KEYS);
  const data = { app: "mxm-tools", version: 2, exportedAt: new Date().toISOString(), local, sync };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mxm-tools-config.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  backupStatus(I18N.t("opt.exported"));
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      // "mxm-specialists-tools" = old name; accepted so previous backups still import.
      if (data.app !== "mxm-tools" && data.app !== "mxm-specialists-tools") throw new Error("foreign file");
      if (data.local) await chrome.storage.local.set(data.local);
      if (data.sync) await chrome.storage.sync.set(data.sync);
      backupStatus(I18N.t("opt.imported"));
      load(); // refresh the visible fields
    } catch (e) {
      backupStatus(I18N.t("opt.importError"));
    }
  };
  reader.readAsText(file);
}

$("export").addEventListener("click", doExport);
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (e) => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; });

// ── Auto-save ───────────────────────────────────────────────────────────────
// There is no Save button: every change persists on its own (short debounce on
// the text/number fields so it does not save on every keystroke).
const FIELD_IDS = [
  "gem_url", "ui_mode", "yt_method", "auto_always", "auto_threshold",
  "num_candidates", "message_template", "gemReviewTemplate", "load_delay_ms",
  "open_in_background",
  "messageGemUrl", "curatorName", "contributorMessageTemplate", "diffMode", "save_path", "btn_animation",
  "slackTypeformUrl", "reportName", "reportEmail",
  "flash_transcriptor", "flash_message", "flash_review",
];
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
for (const id of FIELD_IDS) {
  const el = $(id);
  el.addEventListener("change", scheduleSave);
  if ((el.tagName === "INPUT" && el.type !== "checkbox") || el.tagName === "TEXTAREA") el.addEventListener("input", scheduleSave);
}

document.addEventListener("DOMContentLoaded", load);
