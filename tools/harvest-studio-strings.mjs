#!/usr/bin/env node
// =============================================================================
// harvest-studio-strings.mjs — Regenerates studio-strings.js from Musixmatch
// Studio's public bundle. Not shipped with the extension.
//
// Studio embeds its i18n dictionaries (26 languages) as JSON.parse('…')
// literals inside its Next.js page chunk. This script downloads the chunk,
// extracts and parses those literals, gathers the variants of each anchor
// string the extension needs to recognize, and writes studio-strings.js.
//
// Usage:
//   node tools/harvest-studio-strings.mjs [chunk-URL]
//
// The URL changes with each Studio deploy (hash in the name). To get the
// current one: open Studio → DevTools → Network → filter "all]]-" (the chunk
// pages/[[...all]]-<hash>.js), or look at the document's <script src>.
// =============================================================================

const DEFAULT_CHUNK_URL =
  "https://curators.musixmatch.com/_next/static/chunks/pages/%5B%5B...all%5D%5D-91af5581b07eb657.js";

// Each anchor gathers the variants of one or more dictionary paths (a path =
// nested keys joined with "."). "prefix" = the extension matches by prefix (the
// original value carries a {{…}} placeholder that is trimmed off).
const ANCHORS = [
  { key: "find_replace", paths: ["contribution_tools_header.find_replace", "contribution_tools_header_v2.find_replace"] },
  { key: "restart_sync", paths: ["contribution_tools_header.restart_sync", "contribution_tools_header_v2.restart_sync"] },
  { key: "instrumental", paths: ["contribution_tools_header.instrumental", "contribution_tools_header_v2.instrumental"] },
  { key: "track_info", paths: ["song_info"] },
  { key: "contribution_history", paths: ["contribution_history.title"] },
  { key: "no_contributions", paths: ["contribution_history.no_contributions"] },
  { key: "assistant", paths: ["contribution_history.assistant"] },
  { key: "modal_tab_lyrics", paths: ["contribution_history.lyrics"] },
  { key: "modal_tab_sync", paths: ["contribution_history.sync"] },
  { key: "modal_tab_structure_tags", paths: ["contribution_history.structure_tags"] },
  { key: "last_edit", paths: ["contribution_history.last_edit"], prefix: true },
  { key: "thanks_title", paths: ["saving_success.title"] },
  { key: "continue_btn", paths: ["components.switch_tool.continue", "continue"] },
  { key: "draft_title", paths: ["draft_found.title"] },
  { key: "draft_saved", paths: ["contribution_tools_header.draft_saved", "contribution_tools_header_v2.draft_saved", "contribution_tools_header.saving_draft", "contribution_tools_header_v2.saving_draft"] },
  { key: "discard", paths: ["draft_found.discard"] },
  { key: "sending_contributions", paths: ["contribution_tools.sending_contributions"] },
  { key: "exit_dialog_title", paths: ["contribution_tools.discard_changes_title"] },
  { key: "exit_dialog_desc", paths: ["contribution_tools.discard_changes_description", "contribution_tools.discard_changes_description_no_draft"] },
  { key: "title_label", paths: ["song_info_dialog.title"] },
  { key: "abstrack", paths: ["song_info_dialog.abstrack"] },
  { key: "tab_transcript", paths: ["contribution_tools_header_v2.edit"] },
  { key: "tab_timesync", paths: ["contribution_tools_header_v2.sync"] },
  // Editor's Send button. It is NOT in the contribution_tools dictionaries; the
  // only key is the top-level "send" (14 variants, lowercase — the button shows
  // them capitalized via CSS, hence the case-insensitive match).
  { key: "send_btn", paths: ["send"] },
  // Lyrics textarea placeholder (Transcript). Also translated; without this,
  // isOnTranscript/getTranscriptTextarea would fail outside English.
  { key: "lyrics_placeholder", paths: ["edit_tool.placeholder"] },
];

// ── Unescape a single-quoted JS string literal (what sits between the quotes of
// JSON.parse('…')) into the real JSON text the app parses ────────────────────
const CTRL = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
function jsUnescape(s) {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const d = s[i + 1];
      if (d === "x") { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 4; continue; }
      if (d === "u") { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue; }
      if (d in CTRL) { out += CTRL[d]; i += 2; continue; }
      out += d; i += 2; continue; // \' \\ \" and unknowns → the bare char
    }
    out += c; i += 1;
  }
  return out;
}

function walk(obj, path, out) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) walk(v, path ? path + "." + k : k, out);
  } else if (typeof obj === "string") {
    out.push([path, obj]);
  }
}

const url = process.argv[2] || DEFAULT_CHUNK_URL;
console.log("Downloading:", url);
const res = await fetch(url);
if (!res.ok) { console.error("HTTP", res.status, "- did the chunk hash change? See the instructions above."); process.exit(1); }
const src = await res.text();

const lits = [...src.matchAll(/JSON\.parse\('((?:\\.|[^'\\])*)'\)/g)].map((m) => m[1]);
console.log("JSON.parse literals found:", lits.length);
if (!lits.length) { console.error("The bundle no longer embeds the dictionaries this way — check the structure."); process.exit(1); }

const pairs = [];
let failed = 0;
for (const lit of lits) {
  try { walk(JSON.parse(jsUnescape(lit)), "", pairs); } catch (e) { failed++; }
}
if (failed) { console.error(`⚠️  ${failed}/${lits.length} literals did not parse — result possibly incomplete.`); process.exit(1); }

const STR = {};
for (const { key, paths, prefix } of ANCHORS) {
  const vals = new Set();
  for (const [p, v] of pairs) {
    if (!paths.includes(p)) continue;
    let val = v.trim();
    if (prefix) val = val.split("{{")[0].trim(); // "Last edit {{date}}" → "Last edit"
    if (val) vals.add(val);
  }
  if (!vals.size) { console.error(`⚠️  anchor with no variants: ${key} (did the dictionary path change?)`); process.exit(1); }
  STR[key] = [...vals].sort();
}

const prefixKeys = ANCHORS.filter((a) => a.prefix).map((a) => a.key);

const out = `// =============================================================================
// studio-strings.js — GENERATED by tools/harvest-studio-strings.mjs. Do NOT
// edit by hand: regenerate with \`node tools/harvest-studio-strings.mjs [URL]\`
// when Studio changes its text or adds languages.
//
// Studio UI strings in ALL of its languages (~26), extracted from the i18n
// dictionary embedded in Studio's public bundle. The extension matches against
// all variants at once, without detecting the locale.
// =============================================================================

(function () {
  "use strict";
  if (window.MXMStudioI18n) return;

  const STR = ${JSON.stringify(STR, null, 2).replace(/\n/g, "\n  ")};

  // Keys matched by PREFIX (the rest, by exact equality).
  const PREFIX_KEYS = new Set(${JSON.stringify(prefixKeys)});

  const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
  const cache = {};

  // RegExp that recognizes the anchor's text in any Studio language.
  function rx(key) {
    if (!cache[key]) {
      const alts = (STR[key] || []).map(esc).join("|");
      cache[key] = new RegExp("^(?:" + alts + ")" + (PREFIX_KEYS.has(key) ? "" : "$"), "i");
    }
    return cache[key];
  }

  function test(key, text) {
    return rx(key).test((text || "").trim());
  }

  // Does any anchor variant appear as a SUBSTRING of text? (case-insensitive).
  // For banners searched over the full document.body.textContent.
  function has(key, text) {
    const hay = (text || "").toLowerCase();
    return (STR[key] || []).some((v) => hay.includes(v.toLowerCase()));
  }

  // RegExp joining the variants of several keys. mode:
  //   "substr" (default) — matches anywhere (leave dialog).
  //   "start"            — anchored to the start (labels with a variable tail: date).
  //   "exact"            — full equality.
  // Cached per combination of keys + mode.
  function union(keys, mode) {
    const m = mode || "substr";
    const ck = "∪" + m + ":" + keys.join(",");
    if (!cache[ck]) {
      const alts = keys.flatMap((k) => STR[k] || []).map(esc).join("|");
      const pre = m === "exact" || m === "start" ? "^" : "";
      const post = m === "exact" ? "$" : "";
      cache[ck] = new RegExp(pre + "(?:" + alts + ")" + post, "i");
    }
    return cache[ck];
  }

  window.MXMStudioI18n = { STR, rx, test, has, union };
})();
`;

const { writeFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { dirname, join } = await import("node:path");
const dest = join(dirname(dirname(fileURLToPath(import.meta.url))), "studio-strings.js");
writeFileSync(dest, out);
console.log("Written:", dest);
for (const { key } of ANCHORS) console.log(`  ${key}: ${STR[key].length} variants`);
