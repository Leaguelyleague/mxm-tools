// Find & Replace autofills the 1st field with the selected text.
// We verify the real exported functions — but doFindReplace lives in
// buttons-mxm's closure; we test the BEHAVIOR by mounting a DOM that imitates:
//   lyrics textarea with a selection → open the panel (a new input appears) →
//   the input gets filled with the selection.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-fr-"));
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium", // full Chromium: the headless shell does not load MV3 extensions
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const extId = new URL(sw.url()).host;
const p = await ctx.newPage();
p.on("pageerror", (e) => { if (!/setting 'value'/.test(e.message)) fails.push("pageerror: " + e.message); });
await p.setViewportSize({ width: 900, height: 700 });
await p.goto(`chrome-extension://${extId}/options.html`);

// The real doFindReplace source, to check the implementation is there.
const src = await p.evaluate(async () => await (await fetch(chrome.runtime.getURL("buttons-mxm.js"))).text());
ok(src.includes("function currentSelection()"), "captures the selection (currentSelection)");
// Fills ALL new fields (find + replace), focus on the 2nd.
ok(src.includes("const before = new Set(findFields())") && src.includes("filter((el) => !before.has(el))"), "detects ALL new panel fields");
ok(src.includes("for (const f of fields) setFieldValue(f, sel)"), "fills the selection into find AND replace");
ok(src.includes("(fields[1] || fields[0]).focus()"), "focus on the 2nd field (replace)");
ok(src.includes('Object.getOwnPropertyDescriptor(proto, "value").set'), "sets the value via the native setter (React)");

// Functional test: we replicate currentSelection + setFieldValue + the "first
// new field" logic with the real DOM and verify the fill.
const result = await p.evaluate(async () => {
  document.body.innerHTML = "";
  // helpers identical to the content script's
  function currentSelection() {
    const el = document.activeElement;
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && typeof el.selectionStart === "number" && el.selectionEnd > el.selectionStart) {
      const s = el.value.substring(el.selectionStart, el.selectionEnd);
      if (s.trim()) return s;
    }
    const w = (window.getSelection && window.getSelection().toString()) || "";
    return w.trim() ? w : "";
  }
  function setFieldValue(el, value) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    } else el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; };
  const findFields = () => Array.from(document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"], textarea, [contenteditable="true"]')).filter(isVis);

  // lyrics textarea with a selection
  const ta = document.createElement("textarea");
  ta.value = "first line\nSECOND selected\nthird";
  ta.style.cssText = "width:400px;height:120px";
  document.body.appendChild(ta);
  ta.focus();
  const start = ta.value.indexOf("SECOND");
  ta.setSelectionRange(start, start + "SECOND selected".length);

  const sel = currentSelection();
  const before = new Set(findFields());

  // "open panel": a new search input + a replace one appear
  const panel = document.createElement("div");
  const find = document.createElement("input"); find.type = "text"; find.placeholder = "Find";
  const repl = document.createElement("input"); repl.type = "text"; repl.placeholder = "Replace";
  panel.append(find, repl); document.body.appendChild(panel);

  // the content script: detects ALL new fields and fills both
  const fields = findFields().filter((el) => !before.has(el));
  let inputFired = false; find.addEventListener("input", () => { inputFired = true; });
  for (const f of fields) setFieldValue(f, sel);
  (fields[1] || fields[0]).focus();

  return {
    sel, count: fields.length,
    findFilled: find.value, replFilled: repl.value,
    focusIsSecond: document.activeElement === repl, inputFired,
  };
});
ok(result.sel === "SECOND selected", "captured the textarea's selection → " + result.sel);
ok(result.count === 2, "detected the 2 new fields → " + result.count);
ok(result.findFilled === "SECOND selected", "the 'find' field ended up with the selection");
ok(result.replFilled === "SECOND selected", "the 'replace' field ALSO ended up with the selection");
ok(result.focusIsSecond, "focus ended up on the 2nd field (replace)");
ok(result.inputFired, "fires the input event (React registers it)");

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
