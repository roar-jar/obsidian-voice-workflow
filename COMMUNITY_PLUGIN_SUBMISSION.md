# Community plugin submission

This file tracks the Obsidian Community Plugin submission package for Voice Workflow.

## Registry entry

Add this object to `community-plugins.json` in `obsidianmd/obsidian-releases`:

```json
{
  "id": "voice-summary-workflow",
  "name": "Voice Workflow",
  "author": "roar-jar",
  "description": "Capture, transcribe, summarize, and archive voice meeting notes with local or cloud AI providers.",
  "repo": "roar-jar/obsidian-voice-workflow"
}
```

## Current status

- `voice-summary-workflow` is available in the current upstream `community-plugins.json`.
- `roar-jar/obsidian-voice-workflow` is not currently listed in the upstream registry.
- No matching open upstream PR was found for this plugin.
- Local validation passed:
  - `node --check main.js`
  - `git diff --check`
- GitHub Release `0.4.0` has not been created yet.
- Runtime testing in an Obsidian vault is still required before checking the platform boxes in the upstream PR template.

## Release checklist

- [ ] Push the latest `main` branch to `roar-jar/obsidian-voice-workflow`.
- [ ] Create a GitHub Release named exactly `0.4.0`.
- [ ] Attach these files as individual release assets:
  - [ ] `main.js`
  - [ ] `manifest.json`
  - [ ] `styles.css`
- [ ] Confirm the release tag/name does not include a `v` prefix.
- [ ] Confirm the release `manifest.json` version is `0.4.0`.
- [ ] Confirm `versions.json` includes `0.4.0`.
- [ ] Test installing the release manually in a clean vault.
- [ ] Test the plugin on macOS.
- [ ] Test Windows Speech on Windows before checking Windows in the PR template.
- [ ] Keep Android/iOS unchecked because `isDesktopOnly` is `true`.

## Pull request body

Use the official Community Plugin PR template from `obsidianmd/obsidian-releases`:

```md
# I am submitting a new Community Plugin

- [ ] I attest that I have done my best to deliver a high-quality plugin, am proud of the code I have written, and would recommend it to others. I commit to maintaining the plugin and being responsive to bug reports. If I am no longer able to maintain it, I will make reasonable efforts to find a successor maintainer or withdraw the plugin from the directory.

## Repo URL

Link to my plugin: https://github.com/roar-jar/obsidian-voice-workflow

## Release Checklist

- [ ] I have tested the plugin on
  - [ ] Windows
  - [ ] macOS
  - [ ] Linux
  - [ ] Android _(if applicable)_
  - [ ] iOS _(if applicable)_
- [ ] My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
  - [ ] `main.js`
  - [ ] `manifest.json`
  - [ ] `styles.css` _(optional)_
- [ ] GitHub release name matches the exact version number specified in my manifest.json (_**Note:** Use the exact version number, don't include a prefix `v`_)
- [ ] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [ ] My README.md describes the plugin's purpose and provides clear usage instructions.
- [ ] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugin's adherence to these policies.
- [ ] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [ ] I have added a license in the LICENSE file.
- [ ] My project respects and is compatible with the original license of any code from other plugins that I'm using. I have given proper attribution to these other projects in my `README.md`.
```

## Local validation

Run before creating the release:

```sh
node --check main.js
git diff --check
```
