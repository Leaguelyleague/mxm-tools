// Phase 5, item 2: unique card selectors in mxm-core. Before, highlighter.js
// and mxm_menu.js EACH had their own identical copy of CARD_TITLE_SEL/
// CARD_META_SEL/CARD_ARTIST_SEL (real risk: updating one copy without the
// other after an MxM redesign). mxm_menu.js also had its OWN single-string
// DOTS_PATH_PREFIX, without the redeploy tolerance that DOTS_PATH_PREFIXES
// (a list) already has in mxm-core since the ⋯ bug fix (Phase 1). Source
// lock: neither file re-declares its own copy anymore.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const EXT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
const fails = []; const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails.push(m); };

const core = fs.readFileSync(path.join(EXT, "mxm-core.js"), "utf8");
ok(core.includes('const CARD_TITLE_SEL = ".r-1inkyih.r-1kfrs79";'), "mxm-core.js defines CARD_TITLE_SEL");
ok(core.includes('const CARD_META_SEL = ".r-dd0y9b";'), "mxm-core.js defines CARD_META_SEL");
ok(core.includes('const CARD_ARTIST_SEL = ":scope > div.r-a023e6";'), "mxm-core.js defines CARD_ARTIST_SEL");
ok(/window\.MXMCore = \{[\s\S]*?CARD_TITLE_SEL,[\s\S]*?CARD_META_SEL,[\s\S]*?CARD_ARTIST_SEL,/.test(core),
  "mxm-core.js exposes all 3 on window.MXMCore");
ok(/window\.MXMCore = \{[\s\S]*?DOTS_PATH_PREFIXES,/.test(core), "mxm-core.js exposes DOTS_PATH_PREFIXES (list)");

const hl = fs.readFileSync(path.join(EXT, "highlighter.js"), "utf8");
ok(!hl.includes('const CARD_TITLE_SEL = ".r-1inkyih.r-1kfrs79"'), "highlighter.js does NOT re-declare CARD_TITLE_SEL");
ok(!hl.includes('const CARD_META_SEL = ".r-dd0y9b"'), "highlighter.js does NOT re-declare CARD_META_SEL");
ok(hl.includes("const { CARD_TITLE_SEL, CARD_META_SEL, CARD_ARTIST_SEL } = core;"), "highlighter.js takes them from core");

const mm = fs.readFileSync(path.join(EXT, "mxm_menu.js"), "utf8");
ok(!mm.includes('const TITLE_SEL = ".r-1inkyih.r-1kfrs79"'), "mxm_menu.js does NOT re-declare TITLE_SEL");
ok(!mm.includes('const DOTS_PATH_PREFIX = "M8 12c0 1.1";'), "mxm_menu.js does NOT re-declare its own DOTS_PATH_PREFIX (single string)");
ok(mm.includes("DOTS_PATH_PREFIXES } = core;") || mm.includes("DOTS_PATH_PREFIXES} = core;"),
  "mxm_menu.js takes DOTS_PATH_PREFIXES (list) from core, not its own string");
ok(mm.includes("DOTS_PATH_PREFIXES.some((prefix)"), "mxm_menu.js checks AGAINST THE LIST (redeploy-tolerant), not a single prefix");

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nOK");
process.exit(fails.length ? 1 : 0);
