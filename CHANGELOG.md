# Changelog

All notable changes to Waymark are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (before 1.0, a minor version can change behavior).

"D" numbers point to entries in [docs/DECISIONS.md](docs/DECISIONS.md); "#" numbers are pull requests and issues.

## [Unreleased]

### Added
- Each version is published on the repository's Releases page, with the extension zip, its SHA-256 checksum and the notes from this file (D56).
- A privacy policy ([docs/PRIVACY.md](docs/PRIVACY.md)) that says exactly what Waymark stores and what can leave your device, and a draft Chrome Web Store listing ([docs/STORE.md](docs/STORE.md)) (D57).
- A new README: what Waymark is, how to install it from a release, and a quick start.
- Undo for deleting a guide or a step: a message with Undo shows for 8 seconds. A deleted guide can still be restored from a side panel opened again in that time (D100).
- A **Completed** badge on guides you have finished, **Restart** (in the list and while a guide plays), and **Start from step N** in a guide's More menu (D101).
- Tag chips under the search box filter the library; the editor has a Tags field (D102).
- Duplicate for your own guides (More menu) and for steps in the editor (D103).
- Export a guide as a text how-to, in Markdown or as a printable page, after the same review as packs; text that looks like data is flagged in the review (D104).
- Keyboard shortcuts: Alt+R starts or stops recording in the current tab, Alt+W opens the side panel. Both can be changed at chrome://extensions/shortcuts (D105).
- Replay voice and Repeat step buttons in the tooltip (D106).
- Light motion and press feedback in the side panel, Settings and the Practice page: buttons squeeze when pressed, rows lift on hover, folds and toasts slide in, reordered steps glide, a check pops in after Saved and Copied, and the REC dot pulses softly. Everything is short (80–240 ms) and turns into plain fades when the system asks for reduced motion (D130, D131).
- On the page, the spotlight ring glides from one step to the next (the dim no longer flashes between steps), the tooltip rises into place, its progress bar eases, a press on the highlighted element ripples, and the REC pill's dot pulses softly. None of it delays a step or covers the element; all of it is off with reduced motion (D133).
- The on-page `?` launcher pops in, presses and opens its menu with the same light motion (D134).

### Changed
- The built-in tutorials' page is plainly called **Tutorial page**, with no made-up company names; the done card is compact (the check beside "Done!", one Close); the shade around a highlighted element is 20% lighter (D89).

### Fixed
- Move up / Move down in the editor no longer drop keyboard focus to the page (D131).
- The tooltip's mute button can be pressed again in the same step to unmute; before, it kept the state from when the step was drawn (D106).

### For developers
- CI runs once per change instead of twice, cancels superseded pull request runs and skips docs-only changes, to stay within the Free plan's Actions minutes (D54).
- GitHub Actions moved to their Node 24 majors (D55).
- `pnpm motion:bench` measures frame times of the animations with the CPU slowed 4×; `pnpm screens` also shoots motion frame sequences (D132).
- `pnpm release <version>` prepares a release: it bumps the version and moves these notes under it (D56). Feature PRs add their changes here and no longer bump the version.

## [0.3.2] - 2026-11-05

### Fixed
Found by replaying recorded guides on 16 tasks in public demo apps (#13):
- In a one-line field that the app clears on Enter (like a to-do list), pressing Enter now completes the step. Before, the guide waited on that step (D60).
- Drop-downs that open on mouse press, such as MUI's Select, are recorded and advance the guide. Pressing a button and sliding off to cancel still doesn't count as a click (D61).
- Clicking a small icon (such as an edit pencil in a table row) records the button around it, not the icon's drawing (D62).
- Element ids that component libraries number on each page load (Angular Material, Headless UI, React Select and others) are no longer used to find elements. Before, those steps could not be found after a reload (D63).

### For developers
- `pnpm test:real`: an opt-in harness that records and replays scripted tasks on public demo apps and reports wrong, missing and stuck steps ([docs/RELIABILITY.md](docs/RELIABILITY.md)).

## [0.3.1] - 2026-11-05

### Security
- Messages from Waymark's own pages now have entry limits too: pack import choices (10,000) and saved voices (200). Only extension pages can send these, so this is hardening, not a fix for a reachable bug (D53, #14).

## [0.3.0] - 2026-11-05

### Added
- **HD voice (beta, English).** An optional neural voice that runs entirely on your device. Turn it on in Settings: it downloads the voice model (about 170 MB) once from Hugging Face and GitHub, checks every file, then gives back the download permission. Step text is never sent anywhere. A speed check keeps the system voice on devices that are too slow, and the system voice also takes over whenever HD audio is late or fails. **Remove HD voice** deletes the download (D51, #10, fixes #4).

### Changed
- The extension needs the `offscreen` permission (no install warning) for the HD voice, and its pages allow WebAssembly. All code still ships inside the extension.
- The download is about 3.2 MB (was 0.5 MB), because the voice engine's WebAssembly is bundled.

### For developers
- Waymark's own English G2P over the misaki lexicon, so no GPL code ships (D51).
- `scripts/check-no-cdn.mjs` fails the build if any script names a code CDN.
- CI runs the checks and two end-to-end shards in parallel and caches the Playwright browser: about 2.7 minutes instead of 4.5 (D52, #12).
- One e2e flake under CPU load fixed (D50, #9).

## [0.2.4] - 2026-11-05

### Changed
- The side panel opens much faster with many guides: it reads a small index instead of every guide (535 ms → 3 ms with 500 guides). Badges, search, imports and library refreshes use the index too (D49, #11).
- **Copy link** now says so when a guide has no start page to link to, instead of doing nothing.
- Error messages are one readable sentence. When Waymark doesn't answer, the panel says so.

### For developers
- `pnpm bench`: a performance harness with 500 guides of 50 steps (not part of `pnpm check`).

## [0.2.3] - 2026-11-04

### Security
- Security and privacy audit with a written threat model ([docs/SECURITY.md](docs/SECURITY.md)) (D48, #8). Fixes include:
  - a page can no longer fill Waymark's session storage by creating iframes in a loop;
  - the team library download has a size limit, a 30-second timeout and a redirect check;
  - the one-click **Allow** for an imported pack or library lists every site with a checkbox, and asks for at most 50;
  - guide ids and start pages from packs are validated, and links in step titles are shown as plain text;
  - other sites never learn which guide is running, and steps are only spoken on the guide's own sites.

## [0.2.2] - 2026-11-04

### Changed
- A click on something Waymark could never find again (no name, text, label or id) is no longer recorded. The REC pill says "Not recorded" and suggests clicking a button, link or field instead. **Re-pick** refuses such elements too, and guides recorded earlier report those steps as not found at once (D47, #7, fixes #6).

### Added
- A demo app for manual testing: `pnpm demo` (#7).

## [0.2.1] - 2026-11-04

### Changed
- Waymark picks the best voice on your device automatically: natural or enhanced voices first, on-device before online, then your region (D46, #5, part of #4).
- Settings shows which voice is in use and how to install better voices on your system.
- Online voices (such as Edge's "Online (Natural)") stay off until you turn on **Allow online voices**.

## [0.2.0] - 2026-11-04

The first build for hands-on testing ([docs/TESTING.md](docs/TESTING.md)).

### Added
- **Finding guides:** a badge on the toolbar icon counts the guides for the current page; "For this page" and search in the side panel; an optional **?** button on the page, turned on per site (#3).
- **Sharing:** **Copy link** to start a guide from a link; export selected guides as a pack after a review of everything it contains; import packs; subscribe to a team library URL that refreshes every 6 hours. One **Allow** covers the sites of an imported pack or library.
- A popup fallback for browsers without a side panel (D43).

### For developers
- CI uploads the production build as the `waymark-extension` artifact.

## [0.1.0] - 2026-11-04

The first version: record a walkthrough of a web app and play it back on the live page.

### Added
- **Site access one site at a time**, granted from the side panel. Waymark has no access to any site until you allow it (#1).
- **Recorder:** records clicks, typing (never the typed values), choices, checkboxes and form submits, across page loads, new tabs, iframes and shadow DOM. A live step list in the side panel and a REC pill on the page (#2).
- **Player:** spotlights the real element with a short note, moves on when you do the step, and keeps going across pages and tabs. Clear cards when a step can't be found or you've left the guide's pages, and **Report broken step**. Keyboard shortcuts `Alt+.`, `Alt+,` (#2).
- **Editor:** edit, reorder and delete steps, add note-only steps, **Test step** and **Re-pick** an element (#2).
- **Voice:** each step is read aloud once with your device's voices; online voices are off by default (#2).

### For developers
- WXT, strict TypeScript, Manifest V3 with no `content_scripts` and no `host_permissions` (checked in CI). Typed, validated messages with per-sender allowlists.
- Element fingerprints and a matcher that prefers "not found" to a wrong element, with a robustness suite (D1–D41).

[Unreleased]: https://github.com/ThomasDevJS/Waymark/commits/main
[0.3.2]: https://github.com/ThomasDevJS/Waymark/pull/13
[0.3.1]: https://github.com/ThomasDevJS/Waymark/pull/14
[0.3.0]: https://github.com/ThomasDevJS/Waymark/pull/10
[0.2.4]: https://github.com/ThomasDevJS/Waymark/pull/11
[0.2.3]: https://github.com/ThomasDevJS/Waymark/pull/8
[0.2.2]: https://github.com/ThomasDevJS/Waymark/pull/7
[0.2.1]: https://github.com/ThomasDevJS/Waymark/pull/5
[0.2.0]: https://github.com/ThomasDevJS/Waymark/pull/3
[0.1.0]: https://github.com/ThomasDevJS/Waymark/pull/1
