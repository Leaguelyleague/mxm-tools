// Batch 11: (#1) grouping switch explanation (ⓘ in the cluster header),
// (#2) Track info ONLY via ⓘ (no fallback to the menu), (#3) toast above the
// bar, (#4) contributor anchor icon outline, (#5) Save&Send bubble + i18n.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-l11-"));
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

// ── Source: direct assertions against the code ──
const src = async (f) => await p.evaluate(async (u) => await (await fetch(chrome.runtime.getURL(u))).text(), f);
await p.goto(`chrome-extension://${extId}/options.html`);
const core = await src("mxm-core.js");
ok(!/clickHeaderMenuItem\("track_info"\)/.test(core), "#2 openTrackPage NO LONGER falls back to the ⋯ menu for Track info");
ok(/Track info is a SEPARATE panel/.test(core), "#2 comment makes clear Track info goes via the ⓘ");
const btns = await src("buttons-mxm.js");
// Phase 5: group membership lives in btn-defs.js; buttons-mxm.js only maps the
// anchor ICON (GROUP_ICON) and the member's (ICON_CLICK).
ok(/contributorOutlineIcon/.test(btns) && /contribGroup:\s*contributorOutlineIcon/.test(btns), "#4 the group anchor uses the outline icon");
ok(/contributorName:\s*\{ icon: contributorIcon/.test(btns), "#4 the contributorName member keeps the filled icon");
ok(/fill="none" stroke="currentColor"/.test(btns.split("contributorOutlineIcon")[1].slice(0, 200)), "#4 the outline icon is empty (fill none + stroke)");
const mb = await src("mxm-buttons.js");
ok(/function positionToast/.test(mb) && /showToast[\s\S]{0,120}positionToast\(\)/.test(mb), "#3 showToast repositions the toast above the bar");
ok(/function showBubble/.test(mb) && /showBubble,/.test(mb), "#5 showBubble exists and is exported");
const sl = await src("save-lyrics.js");
ok(/ui\.showBubble\(entry, t\("toast\.saveSendConfirmShort"\)/.test(sl), "#5 onSaveSend shows the bubble on the 1st click");

// ── Popup: the group header has the ⓘ with the explanation ──
await p.goto(`chrome-extension://${extId}/popup.html`);
await p.waitForTimeout(400);
// go to the Buttons tab
await p.evaluate(() => { const b = [...document.querySelectorAll('[data-tab],button,.tab')].find(e => /button/i.test(e.textContent||"") ); if (b) b.click(); });
await p.waitForTimeout(300);
const grp = await p.evaluate(() => {
  const head = document.querySelector(".blk-group .group-head");
  if (!head) return { head: false };
  const info = head.querySelector(".info");
  const tip = info ? (info.querySelector(".tip") || {}).textContent : "";
  return { head: true, hasInfo: !!info, tip: (tip || "").slice(0, 40) };
});
ok(grp.head, "#1 there is at least one group cluster in the popup");
ok(grp.hasInfo, "#1 the group header has the explanation ⓘ");
ok(grp.tip && grp.tip.length > 10, "#1 the ⓘ has explanatory text (" + JSON.stringify(grp.tip) + "…)");

// i18n: new keys in the 10 languages
const cnt = await p.evaluate(async () => {
  const txt = await (await fetch(chrome.runtime.getURL("i18n-strings.js"))).text();
  return {
    short: (txt.match(/"toast\.saveSendConfirmShort":/g) || []).length,
    grp: (txt.match(/"popup\.info\.groupSwitch":/g) || []).length,
  };
});
ok(cnt.short === 26, "#5 saveSendConfirmShort in 26 languages (" + cnt.short + ")");
ok(cnt.grp === 26, "#1 groupSwitch in 26 languages (" + cnt.grp + ")");

await ctx.close(); fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
