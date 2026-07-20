# Tests

**Isolated** Playwright suite: each `test_*.mjs` spins up a headless Chromium
with the extension loaded from the repo root (`--load-extension`) and verifies
behavior against synthetic DOM/mocks. They **never** touch the real Studio (hard
rule: the real Send and the "Restart current sync?" dialog are never triggered).

## Running

```bash
npm install                                # once (playwright pinned)
npx playwright install chromium --no-shell # once (FULL Chromium)
npm test                                   # the whole suite
npm test -- popup                         # only the suites that match
```

Notes:
- `channel: "chromium"` in the tests is mandatory: Playwright's *headless shell*
  **does not load MV3 extensions** (it fails waiting for the service worker).
- The runner (`run-all.mjs`) fails if a suite exits with a non-zero code **or**
  prints any `✗` (double net).

## Asserts against the source code (refactor locks)

Some suites, besides behavior, read the extension's **source**
(`readFileSync` + `indexOf`/`includes`) to lock in design decisions (e.g. the
capture→observer→Send→Thanks→persist order of Save&Send). They are locks: **they
break on purpose when refactoring** and must be updated in the same commit as the
refactor. The ones that currently do this:

- `test_savesend_order.mjs` (Save&Send flow order)
- `test_openweb_bg.mjs`
- `test_wc_hud.mjs`
- `test_split_parens.mjs`

## Writing a new suite

Copy the skeleton of any suite: import `playwright` (the package, not absolute
paths), relative `EXT` (`fileURLToPath(new URL("..", import.meta.url))`),
`launchPersistentContext` with `headless: true` + `channel: "chromium"` +
`--load-extension`. Asserts with the `ok(cond, msg)` helper and `process.exit(1)`
if there were failures. Naming convention: `test_<topic>.mjs`.
