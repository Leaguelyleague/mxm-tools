# MxM Tools

Chrome extension (MV3, vanilla JS, no build) for Musixmatch curators
(curators.musixmatch.com). Adds floating buttons, keyboard shortcuts, a
highlighter, lyrics comparison and contributor-message helpers to the Studio
task editor.

> ⚠️ **Do not run two copies of this extension at once**: if another copy is
> enabled you get duplicate buttons, shortcuts and original-snapshot captures.

## Installation

> This is for development (loading the repo as-is). If you received the `.zip`
> from a **Release** (see the repository's Releases tab), follow
> `docs/INSTALL.md` instead of these steps.

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this folder.

## Features

### Floating buttons (on a task page; each with a toggle in the popup)

21 buttons, grouped into 4 collapsible clusters (they expand on hover; each
cluster has its own grouping switch in the popup). All of them can be reordered
(by dragging the row in the popup) and, if `buttonsMovable` is on, dragged
around the screen.

| Button | Action |
|---|---|
| Save & Send | Saves the lyrics and presses Send — asks for confirmation with a 2nd click |
| Copy | Copies `Song - Artist` to the clipboard |
| Save | Downloads the current lyrics as `.txt` |
| Find & Replace | Opens the editor's "Find and replace"; if there is a selection, autofills both fields |
| Reset sync | Restarts synchronization (Time-sync) — **destructive**, confirmed by the user |
| **Contributor cluster** | |
| ↳ Contributor name | Shows the last contributor's name + role |
| ↳ Go to profile | Opens the last contributor's public profile |
| Open on the web | Opens (and copies) the public lyrics page |
| **Gems cluster** | |
| ↳ Song → Gem | Finds the video on YouTube and sends it to your transcription Gem |
| ↳ Review with Gem | Sends the current lyrics to the Gem for review |
| Diffgenie | All-in-one: Diffchecker diff + link + contributor message via the Gem |
| Compare | Diff of original vs. edited (Diffchecker or built-in view, per options) |
| Google | `song artist` search on Google |
| **Streaming cluster** | |
| ↳ YouTube / Spotify / Apple Music / Amazon Music | Searches for the song and opens the best result (YouTube scores by similarity) |
| **Typeforms cluster** | |
| ↳ Typeform 1 | Slack Curators Invitation Request (automatic prefill) |
| ↳ Typeform 2-4 | Not defined yet |

### Shortcut features (toggle + shortcut configurable from the popup)

| Feature | Default shortcut |
|---|---|
| Merge lines | ⌥J |
| Split lines | ⌥K |
| Merge inside parentheses | ⌥D |
| Wrap selection in `( )` | ⌥F |
| Wrap selection in `¿ ?` | ⌥Q |
| Wrap selection in `¡ !` | ⌥E |
| Word counter (⌘A ×2 to show it; the shortcut toggles it on/off) | ⌥X |
| Insert `#INSTRUMENTAL` | ⌥Y |
| Song → Gem | ⌥G |

### Original capture

When you **open** a task, a snapshot of the Transcript is captured (once per
`task_id`, with an anti-hydration wait). If the automatic capture fails, you can
save it manually from the popup.

### Song → Gem (transcription)

With text selected (⌥G, context menu, the "Song → Gem" button, or a configurable
right-click on a card's ⋯): it searches for the video on YouTube, scores the
candidates (Sørensen–Dice) and sends the link + duration to your Gemini Gem.
Fine-tuning in **Advanced options**, including the prompt text (a template with
placeholders, same as the contributor message and the lyrics review).

## Languages

The UI can be set to **26 languages** from the popup or options — the same ones
Musixmatch Studio has (custom i18n layer, `uiLang` key; with `uiLangAuto` it
follows Studio's language automatically, which is the default): English,
Spanish, Chinese, Hindi, French, Italian, Russian, Swedish, Japanese,
Portuguese, Arabic, Bengali, Czech, Danish, German, Persian, Indonesian,
Korean, Dutch, Polish, Romanian, Tamil, Thai, Tagalog, Turkish and Vietnamese.

The extension also **recognizes Studio's UI in any of its 26 languages**
(language-agnostic selectors via `studio-strings.js`, harvested from Studio's
public bundle — see `tools/harvest-studio-strings.mjs`).

## Settings map

The exact key names live in the code (`options.js`, `popup.js`, each feature);
here is the map by purpose.

**storage.local** (per device, does not sync):
- Language: `uiLang`, `uiLangAuto`.
- Shortcuts: `mxmShortcuts`.
- Floating buttons: `floatingButtons`, `floatingButtonsOn`, `btnOrder`,
  `btnPos:<key>`, `btnAnimation`, `buttonsMovable`, `groupButtons`,
  `groupButtonsBy`, `dotsRightClickAction`.
- Feature toggles: `unirEnabled`, `splitEnabled`, `unirParensEnabled(+Upper)`,
  `wrapParensEnabled(+Upper)`, `wrapQuestionEnabled(+Upper)`,
  `wrapExclaimEnabled(+Upper)`, `wordCounterEnabled`, `instrumentalEnabled`,
  `songToGemEnabled`.
- Highlighter: `hlEnabled`, `hlPhrases`, `hlAutoMarkOpened`, `hlAutoMarkMode`,
  `hlAutoMarkColor`, `openedSongs`, `openedKeywords`.
- Editor automations: `autoCloseAssistant`, `contributorAutoCheck`,
  `contributorFixedLabel`, `autoContinueThanks`.
- Auto-Flash on the Gems: `gemFlashAuto_transcriptor`, `gemFlashAuto_message`,
  `gemFlashAuto_review`.
- Saving: `savePath`.
- Per-task cache (auto-cleared after 30 days, `chrome.alarms`):
  `baseline:<taskId>`, `meta:<taskId>`, `savedLyric:<songKey>`.
- Ephemeral cross-tab payloads: `diffcheckerPayload`, `geminiPayload`,
  `comparePayload`, `goProfilePending`, `slackInvitePending`,
  `slackInviteProfile`.
- UI: `popupActiveTab`.
- Diagnostics (no UI, enabled by hand from the console): `debugLogs`.

**storage.sync** (travels across the same Chrome user's devices):
- Song → Gem: `gem_url`, `ui_mode`, `yt_method`, `auto_always`,
  `auto_threshold`, `num_candidates`, `message_template`, `load_delay_ms`,
  `open_in_background`.
- Contributor message / Diffgenie: `messageGemUrl`, `curatorName`,
  `contributorMessageTemplate`, `diffMode`.
- Lyrics review: `gemReviewTemplate`.
- Per-button tab config (foreground/background): `btnTabConfig`.
- Typeforms: `slackTypeformUrl`, `reportName`, `reportEmail`.

**storage.session**: `gemPayload_<tabId>` (per-tab transcriber payload; clears
itself once consumed).

Full export/import of both storages from Options → Backup.

## Permissions

Audited in Phase 4 (2026-07-20): the 8 permissions and the 5 host_permissions
are all genuinely in use, none left over.

| Permission | What for |
|---|---|
| `contextMenus` | "Highlighter MxM Tools" right-click-on-selection item (`background.js`). |
| `storage` | All configuration and state (`storage.local`/`sync`/`session`) — used in practically every file. |
| `activeTab` | The popup needs to know which tab to send its `MXM_RUN`/`baselineStatus` messages to when the user opens it. |
| `scripting` | ON-DEMAND injection of `overlay.js`/`overlay.css` (YouTube candidate picker) and of the in-page search function into a YouTube tab — neither is a declarative content script. |
| `tabs` | Opening/closing/updating tabs the extension itself creates (Gem, YouTube, Diffchecker, Track info) and messaging them — more than `activeTab` alone gives, because those tabs are not necessarily active. |
| `clipboardWrite` | Copying to the clipboard (song name, links, prompts) in 5 different files. |
| `downloads` | Saving the lyrics as `.txt` (Save / Save & Send buttons). |
| `alarms` | Daily cleanup of old `baseline:*`/`meta:*`/`savedLyric:*` (the MV3 service worker does not live long enough for a `setInterval`). |

`host_permissions` covers exactly the 5 sites the extension interacts with
(musixmatch, youtube, gemini, diffchecker, typeform) — `youtube.com` is used by
`background.js` (fetch + `scripting.executeScript`), not a declarative content
script, so it was left untouched when scoping down the shortcuts (see the
manifest's `content_scripts`).

## Privacy

The extension does not send data to any server of its own — everything that
leaves your browser goes to the third-party services you already use for
curation, with the minimum information each flow needs:

- **Diffchecker**: the diff (original vs. edited lyrics) is stored on
  diffchecker.com with a title that includes **the last contributor's name**,
  the song, the artist and the Abstrack. The diff stays accessible through that
  link (per the expiration setting you pick in Diffchecker when saving — the
  extension does not touch it).
- **Gemini**: the full lyrics (original + edited) and the contributor data are
  sent as a text prompt to your Gemini Gem (Google), to generate the message or
  review the transcription. The prompt is configurable (Advanced options) but
  always includes that data unless you edit the template to remove it.
- **Slack Typeform**: your name and email (the ones you configure in Options)
  are passed **as query params in the URL** to prefill the form — they stay
  visible in that tab's URL (browser history, and any log Typeform keeps on
  their side).
- **Contributor profile**: "Go to profile"/Slack invite navigate to the public
  profile page on musixmatch.com to read the link — that is information
  Musixmatch already exposes publicly on that page.

None of this can be fully disabled without giving up the corresponding feature
(it is the very mechanism of the feature), but every button that sends something
to a third party has its own toggle to turn it off if you are not going to use
it.

## Architecture

- **Manifest**: 4 `content_scripts` groups, one per site
  (`*.musixmatch.com`, `gemini.google.com`, `diffchecker.com`,
  `musixmatch.typeform.com`) — no `<all_urls>` (see Phase 4 of the cleanup).
  Each group first loads the shared infrastructure
  (`mxm-shortcuts` → `i18n-strings-content` → `mxm-i18n` → `mxm-log`) and then
  its features. `i18n-strings-content.js` is a SUBSET of the full dictionary
  (only the keys the content scripts use); the full dictionary
  (`i18n-strings.js`) is loaded only by `popup.html`/`options.html`/
  `info.html`/`diff.html`.
- Shared modules as IIFE `window.MXM*`: `MXMCore` (helpers/Studio selectors +
  single SPA navigation dispatcher, `onNavigate`), `MXMButtons` (floating-button
  engine), `MXMBtnDefs` (single registry of the 21 buttons' metadata: order,
  whether it opens a tab, default-off, groups — consumed by `buttons-mxm.js`
  and `popup.js`, previously two copies), `MXMBtnColors`, `MXMLog` (logger gated
  by `debugLogs`), `MXMShortcuts`, `MXMI18n`, `MXMStudioI18n` (recognizes
  Studio's UI in its 26 languages). Only ES module: `youtube.js` (imported only
  by the background).
- `gemini-inject.js` serves both Gemini flows and disambiguates by payload
  (first `GEM_READY` per tab; if null, polls `geminiPayload`).
- Fragile DOM selectors are centralized at the top of each file, with a
  robustness hierarchy: SVG icon/structure > multi-language text
  (`MXMStudioI18n`) > English literal.
- `tools/` (not shipped): `harvest-studio-strings.mjs` regenerates
  `studio-strings.js` from Studio's bundle; `extract-canon.mjs` +
  `assemble-i18n.mjs` maintain the extension's 26 languages (10 hand-maintained
  + 16 generated from `tools/i18n/*.json`) and regenerate the content-scripts
  subset.
- `tests/`: isolated Playwright suite (real extension loaded, synthetic DOM) —
  see `tests/README.md`. `npm test` runs everything; CI on GitHub Actions on
  every push.
