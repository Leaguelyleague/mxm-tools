// The prompts of the 2 Gemini Gems (transcription/review and contributor
// message) must be ON THE "Useful information" PAGE (info.html, section 4),
// the only surface distributed with the extension that the user sees. They
// used to be left in docs/gem-prompts.md, which does NOT go into the zip
// (docs/ is excluded in tools/pack.mjs) — they never arrived. The prompt body
// is fixed text (not i18n): it is pasted verbatim into Gemini and does not
// depend on the UI language; only the section titles are translated.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-info-prompts-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

// ── Source lock: info.html carries the prompts and no longer the placeholders ──
const html = fs.readFileSync(path.join(EXT, "info.html"), "utf8");
ok(!html.includes("[PROMPT POR DEFECTO"), "info.html: no '[PROMPT POR DEFECTO...]' placeholders");
ok(!/Pendiente/.test(html), "info.html: no 'Pendiente' word");
ok(html.includes("PROCESADOR, TRANSCRIPTOR Y EDITOR MUSICAL DE ÉLITE (V14.3)"), "info.html: contains the transcription prompt (V14.3)");
ok(html.includes("Sos un asistente de un curador de letras de Musixmatch"), "info.html: contains the contributor message prompt");
ok(html.includes("aplícale directamente los Puntos de Control"), "info.html: the prompt has the corrected 'aplícale' (not the Bengali glitch)");
ok(!/\bwhen actúan\b/.test(html), "info.html: 'when actúan' glitch fixed to 'cuando actúan'");
ok(!/ADJUPCIÓN/.test(html), "info.html: 'ADJUPCIÓN' glitch fixed to 'ADJUNCIÓN'");

// ── docs/gem-prompts.md no longer exists (it was the wrong place) ──
ok(!fs.existsSync(path.join(EXT, "docs", "gem-prompts.md")), "docs/gem-prompts.md was removed");

// ── Real behavior: load info.html as an extension page ──
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("pe: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("con: " + m.text()); });

// Spanish UI language to exercise the section titles' translation
await p.goto(`chrome-extension://${extId}/options.html`);
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ uiLangAuto: false, uiLang: "es" }, r)));

await p.goto(`chrome-extension://${extId}/info.html`);
await p.waitForTimeout(400); // info.js applies i18n

const es = await p.evaluate(() => {
  const pres = Array.from(document.querySelectorAll("pre")).map((e) => e.textContent);
  return {
    preCount: pres.length,
    pre0: pres[0] || "", pre1: pres[1] || "",
    bodyHasPendiente: /Pendiente/.test(document.body.innerText),
    gem1h: document.querySelector('[data-i18n="info.s4.gem1h"]')?.textContent || "",
    gem2h: document.querySelector('[data-i18n="info.s4.gem2h"]')?.textContent || "",
  };
});
ok(es.preCount === 2, `there are exactly 2 <pre> blocks (the 2 prompts) -> ${es.preCount}`);
ok(es.pre0.includes("V14.3") && es.pre0.includes("[SIN_LETRA]") && es.pre0.includes("[ERROR_VIDEO]"),
  "the 1st <pre> renders the full transcription prompt (V14.3 + output markers)");
ok(es.pre1.includes("Sos un asistente de un curador") && es.pre1.includes("español rioplatense"),
  "the 2nd <pre> renders the contributor message prompt");
ok(!es.bodyHasPendiente, "the rendered page does not show 'Pendiente'");
ok(/transcripción/i.test(es.gem1h) && /contribuyente/i.test(es.gem2h),
  "the section titles were translated to Spanish (gem1h/gem2h)");

// ── In English: the title changes, the prompt BODY does NOT (it is verbatim) ──
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ uiLang: "en" }, r)));
await p.waitForTimeout(400);
const en = await p.evaluate(() => ({
  gem1h: document.querySelector('[data-i18n="info.s4.gem1h"]')?.textContent || "",
  pre0: document.querySelector("pre")?.textContent || "",
}));
ok(/Transcription/i.test(en.gem1h), "with the UI in English the section title changes (Transcription Gem)");
ok(en.pre0.includes("PROCESADOR, TRANSCRIPTOR Y EDITOR MUSICAL DE ÉLITE"),
  "with the UI in English the prompt BODY stays verbatim in Spanish (not translated)");

if (errs.length) { console.log("page errors:", errs.slice(0, 5)); fails.push("console/page errors"); }
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
