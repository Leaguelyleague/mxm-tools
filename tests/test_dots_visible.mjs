// Regression for the ⋯ menu bug (Phase 1, 2026-07-19): findHeaderDotsButton must
// PICK the visible header ⋯ and IGNORE the hidden clones (display:none,
// visibility:hidden, negative top) that Studio's SPA leaves in the DOM. Builds a
// synthetic header with 1 visible ⋯ + 3 ghosts and verifies the pick.
// (about:blank: no CSP, allows injecting mxm-core.js; the test does not need the
// extension loaded, only document/getComputedStyle.)
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  headless: true,
  channel: "chromium", // full Chromium: CI only installs this channel (--no-shell)
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1300, height: 900 });
await page.goto("about:blank");
await page.addScriptTag({ path: path.join(EXT, "mxm-log.js") });
await page.addScriptTag({ path: path.join(EXT, "mxm-core.js") });
ok(await page.evaluate(() => !!(window.MXMCore && window.MXMCore.findHeaderDotsButton)), "MXMCore.findHeaderDotsButton loaded");

const DOTS_D = "M8 12c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z";
const pick = await page.evaluate((d) => {
  const W = window.innerWidth;
  const mkDots = (style) => {
    const btn = document.createElement("div"); btn.setAttribute("tabindex", "0"); btn.style.cssText = style;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="${d}"></path></svg>`;
    return btn;
  };
  const host = document.createElement("div"); host.id = "synthetic-header"; document.body.appendChild(host);
  // Ghosts FIRST in the DOM (the ones that broke selection with [0]):
  host.appendChild(mkDots(`position:fixed;top:-991px;left:${W - 60}px;width:48px;height:48px;`)); // outside viewport
  host.appendChild(mkDots(`position:fixed;top:6px;left:${W - 60}px;width:48px;height:48px;visibility:hidden;`)); // hidden
  host.appendChild(mkDots(`position:fixed;top:6px;left:${W - 60}px;width:48px;height:48px;display:none;`)); // display:none
  // The REAL one, visible, at the end of the DOM:
  const real = mkDots(`position:fixed;top:6px;left:${W - 55}px;width:48px;height:48px;`);
  real.id = "the-real-dots"; host.appendChild(real);

  const chosen = window.MXMCore.findHeaderDotsButton();
  return { isReal: chosen && chosen.id === "the-real-dots", chosenId: chosen ? (chosen.id || "(no id)") : null,
           chosenTop: chosen ? Math.round(chosen.getBoundingClientRect().top) : null };
}, DOTS_D);

ok(pick.isReal, `picks the VISIBLE ⋯, not a ghost — picked: ${pick.chosenId} @top ${pick.chosenTop}`);
ok(pick.chosenTop != null && pick.chosenTop >= 0, "the picked ⋯ is within the viewport (top>=0)");

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK (3/3)");
process.exit(fails.length ? 1 : 0);
