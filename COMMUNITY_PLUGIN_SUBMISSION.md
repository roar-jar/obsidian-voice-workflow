# Community plugin submission

This file tracks the Obsidian Community Plugin submission package for Voice Workflow.

## Directory entry

The plugin will appear in Community plugin search only after Obsidian accepts the submission and adds this entry to the Community directory data:

```json
{
  "id": "voice-summary-workflow",
  "name": "Voice Workflow",
  "author": "roar-jar",
  "description": "Capture, transcribe, summarize, and archive voice meeting notes with local or cloud AI providers. - This plugin has not been manually reviewed by Obsidian staff.",
  "repo": "roar-jar/obsidian-voice-workflow"
}
```

## Current status

- `voice-summary-workflow` is available in the current upstream `community-plugins.json`.
- `roar-jar/obsidian-voice-workflow` is not currently listed in the upstream registry.
- The plugin is not visible in Obsidian Community plugin search yet.
- Source repo `main` has been pushed.
- GitHub Release `0.4.0` has been created.
- Release `0.4.0` contains `main.js`, `manifest.json`, and `styles.css` as individual assets.
- Fork `master` has been synced with `obsidianmd/obsidian-releases:master`.
- The accidental fork-internal PR branch `add-voice-summary-workflow` has been deleted.
- GitHub Actions have been disabled on the `roar-jar/obsidian-releases` fork to prevent fork-internal validation emails from accidental PRs.
- Pull requests are currently disabled on `obsidianmd/obsidian-releases`; use the Community directory submission flow instead.
- Local validation passed:
  - `node --check main.js`
  - `git diff --check`
- Runtime testing in an Obsidian vault is still required before marking platform compatibility during submission.

## Release checklist

- [x] Push the latest `main` branch to `roar-jar/obsidian-voice-workflow`.
- [x] Create a GitHub Release named exactly `0.4.0`.
- [x] Attach these files as individual release assets:
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css`
- [x] Confirm the release tag/name does not include a `v` prefix.
- [x] Confirm the release `manifest.json` version is `0.4.0`.
- [x] Confirm `versions.json` includes `0.4.0`.
- [ ] Test installing the release manually in a clean vault.
- [ ] Test the plugin on macOS.
- [ ] Test Windows Speech on Windows before marking Windows compatibility during submission.
- [ ] Keep Android/iOS unchecked because `isDesktopOnly` is `true`.

## Community directory submission

The remaining submission step must be completed by the repository owner because it requires signing in, linking GitHub, and confirming developer policy/support commitments.

Submit this repository URL:

```text
https://github.com/roar-jar/obsidian-voice-workflow
```

Steps:

1. Sign in to https://community.obsidian.md.
2. Link the GitHub account that owns `roar-jar/obsidian-voice-workflow`.
3. Open `Plugins` -> `New plugin`.
4. Enter the repository URL above.
5. Confirm developer policies and submit.
6. Address any automated review feedback.

## Local validation

Run before creating the release:

```sh
node --check main.js
git diff --check
```
