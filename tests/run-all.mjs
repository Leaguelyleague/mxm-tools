#!/usr/bin/env node
// Suite runner: runs all tests/test_*.mjs in sequence and fails if any of
// them fail (exit code ≠ 0 or a "✗" in the output — double safety net). Usage:
//   npm test               → all suites
//   npm test -- <pattern>  → only the ones matching (substring)
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const files = readdirSync(dir)
  .filter((f) => /^test_.*\.mjs$/.test(f) && f.includes(filter))
  .sort();
if (!files.length) { console.log("No suites match:", filter); process.exit(1); }

const failed = [];
const t0 = Date.now();
for (const f of files) {
  const s = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: "utf8",
    timeout: 240000,
    env: process.env,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const bad = r.status !== 0 || /^✗ /m.test(out);
  console.log(`${bad ? "✗" : "✓"} ${f} (${((Date.now() - s) / 1000).toFixed(1)}s)`);
  if (bad) {
    failed.push(f);
    console.log(out.split("\n").slice(-25).join("\n"));
  }
}
console.log(`\n${files.length - failed.length}/${files.length} suites OK in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (failed.length) { console.log("Failed:", failed.join(", ")); process.exit(1); }
