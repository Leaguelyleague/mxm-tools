// youtube.js — YouTube search without an API key or quota.
// Fetches the results page and parses the `ytInitialData` blob.
// RISK: YouTube may change the markup or serve a consent page.
// The parser is tolerant; if it fails, return [] and it is handled upstream.

const RESULTS_URL = "https://www.youtube.com/results?search_query=";

// Noise words that do not contribute to song/artist similarity.
const NOISE = /\b(official|oficial|video|videoclip|audio|lyrics?|letra|hd|hq|4k|8k|mv|live|en\s*vivo|ft|feat|featuring|remaster(?:ed)?|version|visualizer|explicit|clip|topic)\b/g;

// ---- Search ----------------------------------------------------------------

export async function searchYouTube(query, limit = 5) {
  const url = RESULTS_URL + encodeURIComponent(query);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("YouTube responded " + res.status);
  const html = await res.text();
  const data = extractInitialData(html);
  if (!data) throw new Error("Could not extract ytInitialData (new markup or consent page?)");
  const all = collectVideoRenderers(data);
  const seen = new Set();
  const out = [];
  for (const vr of all) {
    const c = toCandidate(vr);
    if (!c || seen.has(c.videoId)) continue;
    seen.add(c.videoId);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

function extractInitialData(html) {
  // Usual form: `var ytInitialData = {...};</script>`
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// Recursively walks the tree looking for `videoRenderer` objects.
function collectVideoRenderers(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (node.videoRenderer && node.videoRenderer.videoId) acc.push(node.videoRenderer);
  for (const k in node) {
    const v = node[k];
    if (v && typeof v === "object") collectVideoRenderers(v, acc);
  }
  return acc;
}

function toCandidate(vr) {
  const videoId = vr.videoId;
  if (!videoId) return null;
  const title = runsText(vr.title) || "";
  const channel =
    runsText(vr.ownerText) ||
    runsText(vr.longBylineText) ||
    runsText(vr.shortBylineText) ||
    "";
  const duration = vr.lengthText?.simpleText || "";
  return {
    videoId,
    title,
    channel,
    duration,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function runsText(obj) {
  if (!obj) return "";
  if (obj.simpleText) return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text).join("");
  return "";
}

// ---- Verification / scoring ------------------------------------------------

// Returns the candidates sorted by score (0–100) descending, with the `score`
// property added.
export function scoreCandidates(query, candidates) {
  const q = tokenize(query);
  return candidates
    .map((c) => {
      // Title + channel tokens: so the artist counts even if it is in the channel.
      const t = tokenize(c.title + " " + c.channel);
      const score = Math.round(dice(q, t) * 100);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics
    .replace(NOISE, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  const set = new Set();
  for (const w of normalize(s).split(" ")) if (w) set.add(w);
  return set;
}

// Sørensen–Dice coefficient over token sets.
function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}
