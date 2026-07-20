// Central gated logger. Before, ~60 console.log/warn fired ALWAYS on every
// page (3 of them even with an unconditional "extension loaded" banner). Now
// MXMLog.log/warn only print if storage.local.debugLogs === true (default
// OFF, no UI — enabled by hand from the console); MXMLog.error ALWAYS prints
// (real problems).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-log-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;

const p = await ctx.newPage();
const consoleMsgs = [];
p.on("console", (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
await p.goto(`chrome-extension://${extId}/options.html`);
await p.waitForTimeout(300);

// manifest.json: mxm-log.js in all 4 content_scripts groups (same position as
// mxm-shortcuts/i18n-strings-content/mxm-i18n).
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
ok(manifest.content_scripts.every((g) => g.js.includes("mxm-log.js")), "mxm-log.js is in all 4 content_scripts groups");

// ── debugLogs OFF (default): MXMLog.log/warn do NOT print; error DOES ──
await p.evaluate(() => new Promise((r) => chrome.storage.local.remove("debugLogs", r))); // default = absent = OFF
await p.addScriptTag({ url: `chrome-extension://${extId}/mxm-log.js` });
await p.waitForTimeout(200);
consoleMsgs.length = 0;
await p.evaluate(() => { window.MXMLog.log("should not be visible"); window.MXMLog.warn("neither this"); });
await p.waitForTimeout(100);
ok(consoleMsgs.length === 0, `debugLogs OFF (default): MXMLog.log/warn print nothing (there were ${consoleMsgs.length})`);

await p.evaluate(() => { window.MXMLog.error("this ONE, always"); });
await p.waitForTimeout(100);
ok(consoleMsgs.some((m) => m.type === "error" && m.text.includes("this ONE, always")),
  "MXMLog.error ALWAYS prints, even with debugLogs OFF");

// ── debugLogs ON: MXMLog.log/warn DO print ──
consoleMsgs.length = 0;
await p.evaluate(() => new Promise((r) => chrome.storage.local.set({ debugLogs: true }, r)));
await p.waitForTimeout(200); // onChanged
await p.evaluate(() => { window.MXMLog.log("visible now"); window.MXMLog.warn("this too"); });
await p.waitForTimeout(100);
ok(consoleMsgs.some((m) => m.type === "log" && m.text.includes("visible now")), "with debugLogs ON, MXMLog.log DOES print");
ok(consoleMsgs.some((m) => m.type === "warning" && m.text.includes("this too")), "with debugLogs ON, MXMLog.warn DOES print");

// ── No unconditional "extension loaded" banners ──
for (const f of ["unir-lineas.js", "word-counter.js", "gem-shortcut.js"]) {
  const src = fs.readFileSync(path.join(EXT, f), "utf8");
  ok(!/cargad[oa]|loaded/i.test(src.split("\n").filter((l) => /console\.(log|warn)|MXMLog\.(log|warn)/.test(l)).join("\n")),
    `${f}: no unconditional load banner`);
}

// ── console.error/warn intentionally NOT migrated (real problems / the only
//    notice channel) stay intact ──
const bg = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
ok((bg.match(/console\.error\(/g) || []).length === 3, "background.js: the 3 console.error (real failures) stay intact");
ok(bg.includes('console.warn("[Song→Gem]", text)') && bg.includes('func: (t) => console.warn("[Song→Gem]", t)'),
  "background.js: notifyTab (the only user-notice channel) not gated");

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
await ctx.close();
process.exit(fails.length ? 1 : 0);
