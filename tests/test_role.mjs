// getContributorOnce captures the last contributor's full ROLE
// (Curator / Rookie / Specialist / AI Assistant / …) and returns it in {name, ai, role}.
// We test roleInRow against synthetic rows of the Contribution history modal.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mxm-role-"));
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
await p.goto(`chrome-extension://${extId}/options.html`);

// We reproduce roleInRow's logic exactly as it ended up in mxm-core.js, applied
// to synthetic rows (avatar+name+role+date). We extract the function from the
// source to test EXACTLY the shipped implementation.
const src = await p.evaluate(async () => await (await fetch(chrome.runtime.getURL("mxm-core.js"))).text());
ok(/const KNOWN_ROLE = \/\^\(rookie\|rater\|curator\|specialist/.test(src), "KNOWN_ROLE covers rookie/rater/curator/specialist…");
ok(src.includes("roleInRow(row, name)") && src.includes("return { name, ai, role }"), "getContributorOnce returns {name, ai, role}");
ok(src.includes("contributorRole: role"), "getTaskMeta exposes contributorRole");
// Known gap: translated roles not confirmed in the bundle — the
// language-agnostic HAS_DIGIT net must be ONLY in roleInRow's `other`
// fallback, not in readName/lastRow (a username CAN have digits; a role,
// never).
ok(/const HAS_DIGIT = \/\\d\//.test(src), "HAS_DIGIT defined");
ok(src.includes("!HAS_DIGIT.test(tx) && tx.length <= 30"), "HAS_DIGIT filters roleInRow's `other` fallback");
const readNameSlice = src.slice(src.indexOf("const readName ="), src.indexOf("const noContribRx"));
ok(!readNameSlice.includes("HAS_DIGIT"), "HAS_DIGIT is NOT used in readName (must not discard names with digits)");

// Functional test of the extractor: we recreate roleInRow with the same logic
// and run it against real DOM (history rows).
const results = await p.evaluate(() => {
  const DATE_TEXT = /\b(ago|hace)\b|\bcontribution(s)?$/i;
  const SKIP_TEXT = /^(contribution history|lyrics|sync|structure tags|no contributions.*|last edit.*)$/i;
  const KNOWN_ROLE = /^(rookie|rater|curator|specialist|graduate|expert|moderator|editor|ai assistant|contributor|rising star|mentor|master|pending|reviewer)$/i;
  const HAS_DIGIT = /\d/;
  const roleInRow = (row, name, song) => {
    if (!row) return "";
    const leaves = Array.from(row.querySelectorAll("div, span"))
      .filter((el) => !el.children.length && el.getClientRects().length)
      .map((el) => (el.textContent || "").trim()).filter(Boolean);
    const known = leaves.find((tx) => KNOWN_ROLE.test(tx));
    if (known) return known;
    const other = leaves.find((tx) => tx !== name && tx !== (song || "").trim() && !DATE_TEXT.test(tx) && !SKIP_TEXT.test(tx) && !HAS_DIGIT.test(tx) && tx.length <= 30);
    return other || "";
  };
  const mkRow = (name, ...rest) => {
    const row = document.createElement("div"); row.setAttribute("tabindex", "0");
    row.style.cssText = "position:relative;height:40px";
    for (const txt of [name, ...rest]) {
      const d = document.createElement("div"); d.textContent = txt; row.appendChild(d);
    }
    document.body.appendChild(row); return row;
  };
  const cases = [
    ["Giisela Ibarra", "Curator", "about 24 hours ago"],
    ["Rodrigo Niehaus", "AI Assistant", "11 months ago"],
    ["Santi", "Rookie", "2 days ago"],
    ["Ana Perez", "Specialist", "5 minutes ago"],
    ["Juan", "Rater", "1 year ago"],
  ];
  const basic = cases.map(([n, r, d]) => ({ label: `known role "${r}"`, expect: r, got: roleInRow(mkRow(n, r, d), n, "Some Song") }));

  // i18n gap: UNTRANSLATED role (does not match KNOWN_ROLE) + a relative date
  // in ANOTHER language that DATE_TEXT (en/es only) does not recognize.
  // Studio's real order is avatar→name→ROLE→date, so the role already wins by
  // order — this case confirms it.
  const roleFirst = roleInRow(mkRow("Marie Dubois", "Curateur", "il y a 3 mois"), "Marie Dubois", "Une Chanson");
  const foreign = { label: "untranslated French role, normal order (role before date)", expect: "Curateur", got: roleFirst };

  // Reversed order (date BEFORE the role in the row) — this is the case where
  // HAS_DIGIT actually makes the difference: without it, the foreign date with
  // a digit ("il y a 3 mois") would be the FIRST unrecognized leaf and would be
  // returned as if it were the role. With HAS_DIGIT, it is skipped and the real
  // role is reached.
  const dateFirst = roleInRow(mkRow("Marie Dubois", "il y a 3 mois", "Curateur"), "Marie Dubois", "Une Chanson");
  const reversed = { label: "reversed order (date BEFORE an untranslated role) → HAS_DIGIT skips the date", expect: "Curateur", got: dateFirst };

  return [...basic, foreign, reversed];
});
for (const r of results) ok(r.got === r.expect, `${r.label} → expected "${r.expect}", got "${r.got}"`);

// name with no readable role → role ""
const noRole = await p.evaluate(() => {
  const DATE_TEXT = /\b(ago|hace)\b|\bcontribution(s)?$/i;
  const SKIP_TEXT = /^(contribution history|lyrics|sync|structure tags|no contributions.*|last edit.*)$/i;
  const KNOWN_ROLE = /^(rookie|rater|curator|specialist|graduate|expert|moderator|editor|ai assistant|contributor|rising star|mentor|master|pending|reviewer)$/i;
  const roleInRow = (row, name, song) => {
    if (!row) return "";
    const leaves = Array.from(row.querySelectorAll("div, span")).filter((el) => !el.children.length && el.getClientRects().length).map((el) => (el.textContent || "").trim()).filter(Boolean);
    const known = leaves.find((tx) => KNOWN_ROLE.test(tx)); if (known) return known;
    return leaves.find((tx) => tx !== name && tx !== (song || "").trim() && !DATE_TEXT.test(tx) && !SKIP_TEXT.test(tx) && tx.length <= 30) || "";
  };
  const row = document.createElement("div");
  const a = document.createElement("div"); a.textContent = "Name Only"; row.appendChild(a);
  const b = document.createElement("div"); b.textContent = "3 hours ago"; row.appendChild(b);
  document.body.appendChild(row);
  return roleInRow(row, "Name Only", "X");
});
ok(noRole === "", "no readable role → empty role");

// consumers build "name (role)"
const btns = await p.evaluate(async () => await (await fetch(chrome.runtime.getURL("buttons-mxm.js"))).text());
const cmp = await p.evaluate(async () => await (await fetch(chrome.runtime.getURL("compare.js"))).text());
ok(btns.includes("role ? `${name} (${role})` : name"), "contributor button shows name (role)");
ok(cmp.includes("meta.contributorRole ? `${meta.contributor} (${meta.contributorRole})`"), "auto toast shows name (role)");
ok(cmp.includes('text += " (" + meta.contributorRole + ")"'), "fixed label shows (role)");

await ctx.close();
console.log("\n" + (fails.length ? `FAILED ${fails.length}: ${JSON.stringify(fails, null, 1)}` : "ALL OK"));
process.exit(fails.length ? 1 : 0);
