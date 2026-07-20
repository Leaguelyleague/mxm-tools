// Extracts the canonical EN block (key→text, IN ORDER) from i18n-strings.js and
// info-strings.js into tools/i18n/_canon.json. Source of truth for what to translate.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDict(file, globalName, pick) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const sandbox = { window: {} };
  // Run the IIFE that sets window.MXM_STRINGS / merges INFO.
  const fn = new Function("window", "self", src + "\nreturn window;");
  const w = fn(sandbox.window, sandbox.window);
  return pick(w);
}

// i18n-strings.js defines window.MXM_STRINGS = { en:{...}, ... }
const i18nEN = loadDict("i18n-strings.js", "MXM_STRINGS", (w) => w.MXM_STRINGS.en);
// info-strings.js merges its keys into window.MXM_STRINGS[lang]; we need ONLY the info.*
// Load both into the same window so info merges, and take the new keys.
const both = (() => {
  const w = { MXM_STRINGS: null };
  const s1 = fs.readFileSync(path.join(root, "i18n-strings.js"), "utf8");
  const s2 = fs.readFileSync(path.join(root, "info-strings.js"), "utf8");
  new Function("window", s1 + "\n" + s2)(w);
  return w.MXM_STRINGS;
})();
const infoKeys = Object.keys(both.en).filter((k) => !(k in i18nEN));
const infoEN = {}; for (const k of infoKeys) infoEN[k] = both.en[k];

fs.writeFileSync(path.join(root, "tools/i18n/_canon.json"),
  JSON.stringify({ i18n: i18nEN, info: infoEN }, null, 2));
console.log("i18n keys:", Object.keys(i18nEN).length, "| info keys:", infoKeys.length);
console.log("Wrote tools/i18n/_canon.json");
