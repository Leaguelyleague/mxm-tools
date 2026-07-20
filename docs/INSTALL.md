# Installation — MxM Tools

This guide is for any platform user who receives the extension already packaged
(the `.zip` from a **Release**, in the repository's Releases tab), not for
development. If you are going to touch the code, use the `## Installation`
section of `README.md` (loading the repo folder unpacked).

## 0. Before installing

This repository is public on GitHub: you can see the Releases and download the
`.zip` without needing an invitation.

Make sure you do not already have another copy of this extension enabled in
`chrome://extensions`. Two copies running at once produce duplicate buttons,
shortcuts and original-snapshot captures.

## 1. Download and install

1. Go to the repo's **Releases** tab and download the `.zip` of the most recent
   release (`mxm-tools-vX.Y.Z.zip`).
2. Unzip it into a **permanent** folder — not in `Downloads` or any place you
   are going to empty or delete. Chrome/Brave keeps pointing at that folder: if
   you move or delete it later, the extension stops working (it goes gray in
   `chrome://extensions` until you point it there again).
3. Open `brave://extensions` (or `chrome://extensions` if you use Chrome) and
   enable **Developer mode** (switch at the top right).
4. **Load unpacked** → pick the folder you unzipped (the one that has
   `manifest.json` inside, not the `.zip`).
5. Confirm that "MxM Tools" appears in the list, without the error triangle.
   Open a task on `curators.musixmatch.com` and check that the floating buttons
   appear.

## 2. Initial configuration

Right-click the extension icon → **Options** (or from the popup, if it has a
shortcut). At a minimum, so the features that depend on Gemini do not fail:

`gem_url` and `messageGemUrl` point to your own Gemini Gems — you have to create
them first (gemini.google.com/gems → create a Gem → paste the corresponding
instructions into the "Instructions" field) and then copy each one's URL here.
The exact instruction texts for each Gem are inside the extension itself: popup
→ **Useful information** → section 4 "Setting up the Gems (step by step)".

| Section | Field | What it is |
|---|---|---|
| Song → Gem | **Transcription Gem URL** (`gem_url`) | The Gemini Gem that transcribes the song. Open it in Gemini and copy the URL from the address bar. |
| Comparison and contributor message | **Contributor message Gem URL** (`messageGemUrl`) | The Gem that writes the contributor message — used by the **Diffgenie** button. |
| Comparison and contributor message | **Curator signature** (`curatorName`) | Your signature, inserted into the generated messages. |
| Forms (Typeform) | **Your name** / **Your email** (`reportName` / `reportEmail`) | Prefill the shared Typeforms (Slack invite, etc.). |

The rest of the Options fields have reasonable defaults — the full map of what
each `setting` does is in `README.md` (`## Settings map`).

## 3. Defaults that come enabled

These features act on their own as soon as you install the extension, without
you turning them on. They are not bugs — they are design decisions of this
version — but if it is your first time using it they may surprise you. They can
all be turned off from the popup → **Functions** tab:

- **Auto-detect contributor on open** (`contributorAutoCheck`): when you open a
  task, it briefly opens the history modal (⋯) for ~5 seconds to read the last
  contributor, then closes it again.
- **Auto-click "Continue" on send** (`autoContinueThanks`): when you send a
  task, it clicks "Continue" by itself on the "Thanks for your contribution"
  banner.
- **Auto-close the Assistant panel** (`autoCloseAssistant`): closes Studio's AI
  Assistant panel when you open a task.

Separately, the **Find & Replace** and **Reset sync** floating buttons come
visible by default (like the rest of the 21 buttons, except Save and Copy) —
they do not act on their own, but **Reset sync** is destructive: it asks for
confirmation with a dialog before restarting synchronization, so pay attention
to that dialog before accepting.

If you prefer to start with everything off and enable feature by feature, go to
the popup → **Functions** and uncheck what you do not want before you start
working.

## 4. Updating to a new version

The extension does not have a fixed ID (there is no `key` in `manifest.json`):
Chrome computes it from the folder path. That determines how your configuration
behaves when updating:

- **Overwriting the same folder** (you unzip the new `.zip` over the old one):
  the ID does not change → it is enough to click the reload (⟳) icon of the
  extension in `chrome://extensions`, and your configuration (Options,
  shortcuts, toggles) stays intact.
- **Using a new folder**: Chrome treats it as a different extension → your
  previous configuration does NOT carry over on its own. Before removing the old
  one, do Options → **Backup → Export**; after loading the new one, do Options →
  **Backup → Import** that file. Only then remove the old version from
  `chrome://extensions`.

See `CHANGELOG.md` to find out what changed in each version.

## 5. Common problems

- **The floating buttons do not appear on the task**: confirm that you are on a
  task URL of `curators.musixmatch.com` (not the listing), and that the
  extension did not go gray in `chrome://extensions` (folder moved/deleted —
  repeat step 4 of section 1).
- **Duplicate buttons or clashing shortcuts appear**: another copy of this
  extension is still enabled — disable it.
- **The ⋯ menu does not react to a click**: Musixmatch changes the editor DOM
  from time to time; report it to whoever maintains the extension with a
  screenshot, it is not something you can fix from your end.
- **Options Export/Import**: Options → **Backup**, useful to migrate your
  configuration to another machine or as a backup before updating.
