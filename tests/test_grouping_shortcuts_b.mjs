// Batch 10b: the 4 Functions toggles ON by default + swapped join/split
// shortcuts (join=⌥J, split=⌥K).
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-10b-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push("popup: " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("popup console: " + m.text()); });
await p.setViewportSize({ width: 400, height: 1000 });
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.waitForTimeout(900);

// swapped default shortcuts
const defs = await p.evaluate(() => ({ unir: window.MXMShortcuts.DEFAULTS.unir.code, split: window.MXMShortcuts.DEFAULTS.split.code }));
ok(defs.unir === "KeyJ", "join lines default = ⌥J → " + defs.unir);
ok(defs.split === "KeyK", "split lines default = ⌥K → " + defs.split);

// the 4 toggles ON by default: these are the toggles of the rows WITHOUT sc-key (blocks at the end)
const toggles = await p.evaluate(() => {
  // block rows whose label matches the 4 texts
  const wanted = ["Auto-close Assistant panel", "Auto-check contributor on open", "Fixed contributor label", "Auto-click"];
  const out = {};
  for (const blk of document.querySelectorAll("#functions-list .blk")) {
    const name = blk.querySelector(".row-label .name")?.textContent || "";
    const w = wanted.find((x) => name.includes(x));
    if (w) out[w] = blk.querySelector(".switch input")?.checked;
  }
  return out;
});
ok(toggles["Auto-close Assistant panel"] === true, "Auto-close Assistant ON by default");
ok(toggles["Auto-check contributor on open"] === true, "Auto-check contributor ON by default");
ok(toggles["Fixed contributor label"] === true, "Fixed contributor label ON by default");
ok(toggles["Auto-click"] === true, "Auto-click Continue ON by default");

// tooltip without the "off by default" tail
const tip = await p.evaluate(() => window.MXMI18n.t("popup.info.contributorAutoCheck"));
ok(!/off by default/i.test(tip), "tooltip no longer says 'off by default'");

// sources: the content scripts read with default ON (!== false)
const srcs = await p.evaluate(async () => {
  const g = async (f) => await (await fetch(chrome.runtime.getURL(f))).text();
  return { a: await g("assistant.js"), c: await g("compare.js"), k: await g("auto-continue.js") };
});
ok(srcs.a.includes("autoCloseAssistant !== false"), "assistant.js default ON");
ok(srcs.c.includes("contributorAutoCheck !== false"), "compare.js default ON");
ok(srcs.k.includes("autoContinueThanks !== false"), "auto-continue.js default ON");

ok(errs.length === 0, "zero console errors → " + (errs.join(" | ") || "none"));
await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
