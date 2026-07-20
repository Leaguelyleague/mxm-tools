// Configurable Gemini prompts. buildGeminiPrompt (compare.js, contributor
// message) and the gemReview message (buttons-mxm.js, lyrics review) had the
// text HARDCODED in Spanish. Now they are templates in Advanced options
// (storage.sync contributorMessageTemplate / gemReviewTemplate), same pattern
// as the transcriber's message_template: {x} placeholders substituted with
// .replaceAll(). The defaults reproduce EXACTLY the text that was hardcoded
// (verified by literal equality, not just "contains").
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-gemprompt-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];

// The EXACT text that was hardcoded (to compare against the real substitution).
const ORIGINAL_MSG_TEXT = (contributor, song, artist, abstrack, curatorName, original, edited) => [
  "Contribuyente: " + contributor,
  "Canción: " + song + " — " + artist,
  "Abstrack: " + abstrack,
  "Firma del curador: " + curatorName,
  "",
  "Escribí el mensaje para este contribuyente, dirigido a él por su nombre, según tus instrucciones.",
  "",
  "=== LETRA ORIGINAL (del contribuyente) ===",
  original,
  "",
  "=== LETRA CORREGIDA (del curador) ===",
  edited,
].join("\n");
const ORIGINAL_REVIEW_TEXT = (song, artist, lyrics) => [
  "Revisá y corregí la siguiente letra ya transcripta según tus instrucciones",
  "(esta vez no hay link de YouTube: la letra va pegada acá).",
  "Devolvé SOLO la letra corregida, sin comentarios.",
  "",
  "Canción: " + song + " — " + artist,
  "",
  lyrics,
].join("\n");

const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pe: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.waitForTimeout(500);

// ── Defaults: exactly the text that was hardcoded (with placeholders) ──
const defaults = await p.evaluate(() => ({
  msg: document.getElementById("contributorMessageTemplate").value,
  review: document.getElementById("gemReviewTemplate").value,
}));
ok(defaults.msg === [
  "Contribuyente: {contributor}", "Canción: {song} — {artist}", "Abstrack: {abstrack}",
  "Firma del curador: {curatorName}", "", "Escribí el mensaje para este contribuyente, dirigido a él por su nombre, según tus instrucciones.",
  "", "=== LETRA ORIGINAL (del contribuyente) ===", "{original}", "", "=== LETRA CORREGIDA (del curador) ===", "{edited}",
].join("\n"), "contributorMessageTemplate default = EXACTLY the text that was hardcoded (with placeholders)");
ok(defaults.review === [
  "Revisá y corregí la siguiente letra ya transcripta según tus instrucciones",
  "(esta vez no hay link de YouTube: la letra va pegada acá).",
  "Devolvé SOLO la letra corregida, sin comentarios.", "", "Canción: {song} — {artist}", "", "{lyrics}",
].join("\n"), "gemReviewTemplate default = EXACTLY the text that was hardcoded (with placeholders)");

// ── The saved default as-is + substitution === exact historical text ──
const msgFilled = defaults.msg
  .replaceAll("{contributor}", "John Smith").replaceAll("{song}", "Eres").replaceAll("{artist}", "Café Tacvba")
  .replaceAll("{abstrack}", "12345").replaceAll("{curatorName}", "Marina")
  .replaceAll("{original}", "original lyrics").replaceAll("{edited}", "edited lyrics");
ok(msgFilled === ORIGINAL_MSG_TEXT("John Smith", "Eres", "Café Tacvba", "12345", "Marina", "original lyrics", "edited lyrics"),
  "default + substitution === exact historical text (contributor message)");

const reviewFilled = defaults.review.replaceAll("{song}", "Eres").replaceAll("{artist}", "Café Tacvba").replaceAll("{lyrics}", "full lyrics");
ok(reviewFilled === ORIGINAL_REVIEW_TEXT("Eres", "Café Tacvba", "full lyrics"),
  "default + substitution === exact historical text (gemReview)");

// ── Source lock: compare.js and buttons-mxm.js use .replaceAll over a
//    template read from storage.sync, not hardcoded arrays ──
const cmpSrc = fs.readFileSync(path.join(EXT, "compare.js"), "utf8");
ok(cmpSrc.includes("function buildGeminiPrompt(p, template)") && cmpSrc.includes('.replaceAll("{contributor}"'),
  "compare.js: buildGeminiPrompt substitutes over a template (does not build the text by hand)");
ok(cmpSrc.includes('"contributorMessageTemplate"'), "compare.js: doDiffgenie reads contributorMessageTemplate from sync");
const btnSrc = fs.readFileSync(path.join(EXT, "buttons-mxm.js"), "utf8");
ok(btnSrc.includes('"gemReviewTemplate"') && btnSrc.includes('.replaceAll("{lyrics}"'),
  "buttons-mxm.js: doGemReview reads gemReviewTemplate from sync and substitutes {lyrics}");

// ── Round-trip via options.html: write into the textarea, save, reload ──
await p.evaluate(() => {
  const ta = document.getElementById("gemReviewTemplate");
  ta.value = "Review: {song} - {artist}\n{lyrics}";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.waitForTimeout(700); // save debounce (400ms) + margin
await p.reload();
await p.waitForTimeout(500);
const reloaded = await p.evaluate(() => document.getElementById("gemReviewTemplate").value);
ok(reloaded === "Review: {song} - {artist}\n{lyrics}", "the custom template persists after reloading options.html -> " + JSON.stringify(reloaded));

// ── Export/import: the 2 new keys travel (SYNC_KEYS). chrome.storage.
//    sync.get(SYNC_KEYS) (array form, no default merging) only carries keys
//    that were ALREADY written at some point — same pre-existing behavior as
//    any other sync key, nothing new here; it is written explicitly here to
//    test the real round-trip. ──
await p.evaluate(() => new Promise((r) => chrome.storage.sync.set({ contributorMessageTemplate: "Hola {contributor}!" }, r)));
const [download] = await Promise.all([p.waitForEvent("download"), p.click("#export")]);
const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
ok(exported.sync.gemReviewTemplate === "Review: {song} - {artist}\n{lyrics}", "export includes the custom gemReviewTemplate");
ok(exported.sync.contributorMessageTemplate === "Hola {contributor}!", "export includes the custom contributorMessageTemplate");

if (errs.length) { console.log("errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
