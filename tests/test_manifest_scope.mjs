// Shortcuts scoped to a site list. Before, an <all_urls> group ran
// unir-lineas/word-counter/gem-shortcut.js on THE WHOLE web — any site, with
// 723KB of i18n injected. On top of that, since <all_urls> is a superset of
// EVERY specific match pattern (musixmatch/gemini/diffchecker/typeform),
// i18n-strings.js (with no double-execution guard) got re-parsed/re-executed
// TWICE on those 4 sites. This test verifies: without <all_urls>, each host
// is covered EXACTLY once across all groups, and the 4 target sites have the
// general shortcuts.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const groups = manifest.content_scripts;

ok(!groups.some((g) => g.matches.includes("<all_urls>")), "no group uses <all_urls>");

// Translates each match pattern to a simple representative test host (the
// patterns here are all *://host/* or https://host/*, with no paths or weird
// intermediate wildcards) to check overlap deterministically.
function samplesFor(pattern) {
  if (pattern === "*://*.musixmatch.com/*") return ["curators.musixmatch.com", "www.musixmatch.com"];
  if (pattern === "*://musixmatch.com/*") return ["musixmatch.com"];
  const m = pattern.match(/^https:\/\/([^/*]+)\/\*$/);
  return m ? [m[1]] : [];
}
const hostToGroups = {};
groups.forEach((g, gi) => {
  const hosts = g.matches.flatMap(samplesFor);
  for (const h of hosts) (hostToGroups[h] ||= []).push(gi);
});
let overlap = null;
for (const [host, gis] of Object.entries(hostToGroups)) {
  if (gis.length > 1) { overlap = `${host}: groups ${gis.join(",")}`; break; }
}
ok(!overlap, "no host is covered by MORE than one group (no double injection)" + (overlap ? " -> " + overlap : ""));

const SITES = {
  "curators.musixmatch.com": groups[0],
  "gemini.google.com": groups.find((g) => g.matches.some((m) => m.includes("gemini.google.com"))),
  "www.diffchecker.com": groups.find((g) => g.matches.some((m) => m.includes("diffchecker.com"))),
  "musixmatch.typeform.com": groups.find((g) => g.matches.some((m) => m.includes("typeform.com"))),
};
for (const [site, group] of Object.entries(SITES)) {
  ok(!!group, `there is a group for ${site}`);
  if (!group) continue;
  const hasShortcuts = ["unir-lineas.js", "word-counter.js", "gem-shortcut.js"].every((f) => group.js.includes(f));
  ok(hasShortcuts, `${site}: has the 3 general shortcuts (unir-lineas/word-counter/gem-shortcut)`);
  const i18nIdx = group.js.indexOf("i18n-strings-content.js");
  const shortcutsIdx = group.js.indexOf("mxm-shortcuts.js");
  ok(i18nIdx > shortcutsIdx && i18nIdx >= 0, `${site}: correct load order (mxm-shortcuts before i18n-strings-content)`);
}

// The rest of the web (any unrelated site) must not be in ANY group.
const covered = new Set(Object.keys(hostToGroups));
ok(!covered.has("example.com"), "an unrelated site (example.com) is not covered by any group");

if (fails.length) fails.forEach((m) => console.log("  failure detail:", m));
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
