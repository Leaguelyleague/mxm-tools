// Inserts/updates the NEW language blocks in i18n-strings.js and
// info-strings.js from tools/i18n/<lang>.json (format { i18n:{...}, info:{...} }).
// The 10 original languages are NOT touched. Verifies key and placeholder parity.
// Idempotent: replaces the content between the GEN-I18N markers.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "tools/i18n");
const canon = JSON.parse(fs.readFileSync(path.join(dir, "_canon.json"), "utf8"));
const i18nKeys = Object.keys(canon.i18n);
const infoKeys = Object.keys(canon.info);

// Order of the 16 new languages per Studio (the 10 old ones stay as they are).
const ALL_NEW = ["ar","bn","cs","da","de","fa","id","ko","nl","pl","ro","ta","th","tl","tr","vi"];
const ph = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Assemble ONLY the languages whose .json already exists (incremental work).
const NEW = ALL_NEW.filter((c) => fs.existsSync(path.join(dir, c + ".json")));
const missing = ALL_NEW.filter((c) => !NEW.includes(c));
if (missing.length) console.log("Not yet translated:", missing.join(", "));

let problems = [];
const langs = {};
for (const code of NEW) {
  const f = path.join(dir, code + ".json");
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  langs[code] = d;
  for (const k of i18nKeys) {
    if (!(k in (d.i18n || {}))) problems.push(`${code}: missing i18n "${k}"`);
    else if (!eq(ph(canon.i18n[k]), ph(d.i18n[k]))) problems.push(`${code}: placeholders differ from en "${k}"`);
  }
  for (const k of infoKeys) {
    if (!(k in (d.info || {}))) problems.push(`${code}: missing info "${k}"`);
    else if (!eq(ph(canon.info[k]), ph(d.info[k]))) problems.push(`${code}: placeholders differ from en "${k}"`);
  }
  const extra = [...Object.keys(d.i18n || {}).filter((k) => !(k in canon.i18n)),
                 ...Object.keys(d.info || {}).filter((k) => !(k in canon.info))];
  for (const k of extra) problems.push(`${code}: extra key "${k}"`);
}
if (problems.length) {
  console.error("PROBLEMS (" + problems.length + "):");
  problems.slice(0, 40).forEach((p) => console.error("  - " + p));
  process.exit(1);
}

const genBlock = (code, keys, dict, indent) => {
  const pad = " ".repeat(indent), pad2 = " ".repeat(indent + 2);
  const lines = keys.map((k) => `${pad2}${JSON.stringify(k)}: ${JSON.stringify(dict[k])},`);
  return `${pad}${code}: {\n${lines.join("\n")}\n${pad}},`;
};

function splice(file, indent, keysSel, endAnchor) {
  const p = path.join(root, file);
  let src = fs.readFileSync(p, "utf8");
  const START = `${" ".repeat(indent)}/* GEN-I18N-START (16 Studio languages) */`;
  const END = `${" ".repeat(indent)}/* GEN-I18N-END */`;
  const blocks = NEW.map((c) => genBlock(c, keysSel, keysSel === i18nKeys ? langs[c].i18n : langs[c].info, indent)).join("\n");
  const gen = `${START}\n${blocks}\n${END}\n`;
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n", "m");
  if (re.test(src)) { src = src.replace(re, gen); }
  else { src = src.replace(endAnchor, gen + endAnchor); }
  fs.writeFileSync(p, src);
}

// i18n-strings.js: blocks at 2 spaces; insert before the object's final "};".
splice("i18n-strings.js", 2, i18nKeys, "};\n");
// info-strings.js: blocks at 4 spaces; insert before INFO's "  };".
splice("info-strings.js", 4, infoKeys, "  };\n");
console.log("Assembled", NEW.filter((c) => langs[c]).length, "new languages in both files.");

// ── i18n-strings-content.js: a subset with ONLY the keys the content scripts
// use (toast/banner/dc/sf/hud/label/slack.needConfig/popup.btn — the last one by
// prefix: the dynamic "popup.btn."+key tooltip keys for the floating buttons).
// The full file (all keys, 26 languages) is still needed by
// popup/options/info/diff.html; the content scripts (injected on every
// musixmatch/gemini/diffchecker/typeform page) load ONLY this. mxm-i18n.js does
// not change: both files define the same window.MXM_STRINGS, they only differ in
// how many keys each language carries.
const CONTENT_PREFIXES = ["toast.", "banner.", "dc.", "sf.", "hud.", "label.", "slack.needConfig.", "popup.btn.", "overlay."];
const fullSrc = fs.readFileSync(path.join(root, "i18n-strings.js"), "utf8");
const fullWindow = new Function("window", fullSrc + "\nreturn window;")({});
const CONTENT = {};
for (const [lang, dict] of Object.entries(fullWindow.MXM_STRINGS)) {
  const sub = {};
  for (const [k, v] of Object.entries(dict)) {
    if (CONTENT_PREFIXES.some((p) => k.startsWith(p))) sub[k] = v;
  }
  CONTENT[lang] = sub;
}
const contentLangCount = Object.keys(CONTENT).length;
const contentKeyCount = Object.keys(CONTENT.en || {}).length;
const contentOut = `// =============================================================================
// i18n-strings-content.js — GENERATED by tools/assemble-i18n.mjs from
// i18n-strings.js. Do NOT edit by hand: run assemble-i18n.mjs to regenerate it
// after any change to i18n-strings.js.
//
// Subset of i18n-strings.js with ONLY the keys the content scripts use
// (toast.*, banner.*, dc.*, sf.*, hud.*, label.*, slack.needConfig.*,
// popup.btn.* — floating-button tooltips). The full file (26 languages × all
// keys) still lives in i18n-strings.js, loaded only by popup/options/info/
// diff.html. Same window.MXM_STRINGS as i18n-strings.js — mxm-i18n.js works the
// same with either one.
// ${contentLangCount} languages × ${contentKeyCount} keys.
// =============================================================================

window.MXM_STRINGS = ${JSON.stringify(CONTENT, null, 2)};
`;
fs.writeFileSync(path.join(root, "i18n-strings-content.js"), contentOut);
console.log(`Wrote i18n-strings-content.js (${contentLangCount} languages × ${contentKeyCount} keys).`);
