// =============================================================================
// MxM Tools — Custom i18n layer
//
// chrome.i18n/_locales follows the BROWSER language and is not user-configurable,
// so the extension brings its own layer: JS dictionaries in i18n-strings.js
// (window.MXM_STRINGS) + this module (window.MXMI18n).
//
// - Language chosen in chrome.storage.local key "uiLang".
// - Default: match navigator.language against the supported languages, else "en".
// - "en" is the canonical dictionary: every missing key falls back to en, and if
//   it is not there either the raw key is shown (useful to spot untranslated strings).
// - t(key, params) interpolates {name} with params.name.
// - applyDom(root) fills [data-i18n], [data-i18n-placeholder] and [data-i18n-title].
//
// ALWAYS injected after i18n-strings.js.
// =============================================================================

(function () {
  "use strict";

  if (window.MXMI18n) return;

  const STORE_KEY = "uiLang";
  // Automatic language: if ON (default), uiLang is ignored and
  // navigator.language is followed (the same signal Studio uses for its 26
  // languages). Picking a language by hand (setLang) turns auto off.
  const AUTO_KEY = "uiLangAuto";

  // Musixmatch Studio's 26 languages (same set and codes). "en" is the
  // canonical one; the rest fall back to "en" for missing keys (see t()).
  const LANGS = [
    { code: "en", name: "English" },
    { code: "es", name: "Español" },
    { code: "zh", name: "中文" },
    { code: "hi", name: "हिन्दी" },
    { code: "fr", name: "Français" },
    { code: "it", name: "Italiano" },
    { code: "ru", name: "Русский" },
    { code: "sv", name: "Svenska" },
    { code: "ja", name: "日本語" },
    { code: "pt", name: "Português" },
    { code: "ar", name: "العربية" },
    { code: "bn", name: "বাংলা" },
    { code: "cs", name: "Čeština" },
    { code: "da", name: "Dansk" },
    { code: "de", name: "Deutsch" },
    { code: "fa", name: "فارسی" },
    { code: "id", name: "Bahasa Indonesia" },
    { code: "ko", name: "한국어" },
    { code: "nl", name: "Nederlands" },
    { code: "pl", name: "Polski" },
    { code: "ro", name: "Română" },
    { code: "ta", name: "தமிழ்" },
    { code: "th", name: "ไทย" },
    { code: "tl", name: "Tagalog" },
    { code: "tr", name: "Türkçe" },
    { code: "vi", name: "Tiếng Việt" },
  ];

  function browserDefault() {
    const nav = (navigator.language || "en").toLowerCase();
    const hit = LANGS.find((l) => nav === l.code || nav.startsWith(l.code + "-"));
    return hit ? hit.code : "en";
  }

  let lang = browserDefault();
  let auto = true;      // default ON
  let savedLang = null; // saved uiLang (used only if auto is OFF)

  const subs = new Set();
  function notify() {
    subs.forEach((cb) => {
      try { cb(lang); } catch (_) { /* do not break because of one subscriber */ }
    });
  }

  function recompute() {
    lang = auto ? browserDefault() : (savedLang || browserDefault());
  }

  try {
    chrome.storage.local.get([STORE_KEY, AUTO_KEY], (d) => {
      if (d) {
        savedLang = d[STORE_KEY] || null;
        auto = d[AUTO_KEY] !== false; // default ON
      }
      recompute();
      notify();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[STORE_KEY] && !changes[AUTO_KEY]) return;
      if (changes[STORE_KEY]) savedLang = changes[STORE_KEY].newValue || null;
      if (changes[AUTO_KEY]) auto = changes[AUTO_KEY].newValue !== false;
      recompute();
      notify();
    });
  } catch (_) {
    /* no chrome.storage: the browser default remains */
  }

  function t(key, params) {
    const dicts = window.MXM_STRINGS || {};
    const d = dicts[lang] || {};
    const en = dicts.en || {};
    let s = d[key] != null ? d[key] : (en[key] != null ? en[key] : key);
    if (params) {
      for (const k in params) s = s.split("{" + k + "}").join(String(params[k]));
    }
    return s;
  }

  function applyDom(root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    r.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    r.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.getAttribute("data-i18n-title"));
    });
    // Inline-HTML variant (<kbd>, <strong>…) for the info page.
    // Only used with the extension's OWN strings (never external input).
    r.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
  }

  window.MXMI18n = {
    LANGS,
    t,
    getLang() { return lang; },
    // Picking a language by hand turns auto off.
    async setLang(code) { await chrome.storage.local.set({ [STORE_KEY]: code, [AUTO_KEY]: false }); },
    isAuto() { return auto; },
    async setAuto(on) { await chrome.storage.local.set({ [AUTO_KEY]: !!on }); },
    onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
    applyDom,
  };
})();
