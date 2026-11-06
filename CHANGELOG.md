# Changelog

All notable changes to Waymark are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (before 1.0, a minor version can change behavior).

"D" numbers point to entries in [docs/DECISIONS.md](docs/DECISIONS.md); "#" numbers are pull requests and issues.

## [Unreleased]

### Added
- Menus that open when you point at them (such as a side nav's flyout): recording adds a **Point at** step before the click on the menu's item, and playing it moves on when you point at the item or Tab to it. Guide files with such steps need this version of Waymark (D204, #94).

### Changed
- Starting a guide from another page of its site: **Open start page** fills in ids such as the organisation number from the page you are on, instead of showing a pattern (D203).

## [0.7.0] - 2026-11-06

### Added
- Add a forgotten step to a guide: **Add a step** picks it on the page, **Record steps** records more steps into the guide at that place (D202, #89).

## [0.6.1] - 2026-11-06

### Added
- Google Sites: after a site is republished, the side panel says so plainly and keeps the one-click Allow (D201).
- Settings → Appearance: choose the theme, System (the default), Light or Dark (D200, #88).
- The printable how-to has links: the start page, “Open this page” where a step’s page changes, and links in notes to the guide’s own sites (D159, #85).
- In the HTML how-to, click a screenshot to see it full size (D159, #86).
- The team library can be a Google Drive file shared as “Anyone with the link”: paste its share link in Settings → Team library (D157, #83).

### Changed
- The step number on a how-to screenshot sits beside the highlighted element, never over it (D158, #87).
- A team library address that answers with a web page (a sign-in or sharing page) now says so plainly (D157).

### For developers
- CI on pull requests and `main` runs the fast checks only; the end-to-end suite runs by hand and in the Release workflow, which publishes only when it passes. Every change still runs it locally first (D161, #80).

## [0.6.0] - 2026-11-06

### Added
- Embedded apps (for example in Google Sites): when a page shows content from other sites, the side panel offers **Allow** for them, so you can record and play guides inside the embed (D155, #77).

### Changed
- **Printable how-to with screenshots, reworked** after testing on a real frame-based app (D190–D199, #78):
  - a step's screenshot is now the **whole visible page** (at most 1600 px wide, under 250 KB) with the step's element **highlighted** (a ring, a soft dim and the step's number), instead of a small blurred crop;
  - **steps inside frames** get a screenshot too, from recording, Test step and Capture: the element is placed through its frames. Field text is hidden in every frame Waymark runs in; only frames of sites Waymark isn't allowed on are greyed out;
  - a **preview page** opens from the export (Printable how-to → **Preview how-to**). It shows the how-to exactly as it will be saved; per step you can **Leave out**, **Blur** (light, so the layout stays readable; off by default) or **Zoom to the element**. Then **Save as PDF** or **Download HTML**. Steps without a screenshot say how to get one;
  - the printed page is light only, has the step count and the date under the title, never splits a step across pages, and fits two steps per page;
  - screenshots taken by 0.5.0 (close-ups) still print, and are marked in the preview and the editor with **Capture again**.

### Fixed
- The recording outline no longer slows down large pages: its check takes under a millisecond instead of about a third of a second (D156).

## [0.5.0] - 2026-11-06

### Added
- While recording, an outline shows what a click will record, with a warning when it would be hard to find or not recorded. On by default; Settings → Highlight turns it off (D153, #70).
- When a page has 6 or more guides, the on-page **?** menu and the side panel's **For this page** list get a search box and up to three tag chips. In the menu, type to filter, use the arrow keys and press Enter to start a guide; Esc clears the search, a second Esc closes the menu (D170, D171, #69).
- **Step screenshots in the printable how-to**, off by default: turn on **Capture screenshots for the printable export** when you record or in the editor (after a notice that screenshots can show customer data). Each step keeps a small picture around its element (under 60 KB), with Waymark's own UI and the text inside fields hidden. The printable how-to shows it with the element outlined; the export review lists every picture, lets you leave any out, and blurs everything but the element unless you turn that off. Pictures stay in the browser and never go into guide files, packs or the team library. The browser allows them only on a tab where you clicked the Waymark icon or used a shortcut; elsewhere the panel and the REC pill say "Screenshots need one click on the Waymark icon (or Alt+W) on this tab." **Test step** or **Capture** in the editor takes a step's picture again (D180–D188, #68).

### Changed
- The on-page **?** button is on by default on sites where a page has guides; turn it off per site in the side panel (D150, #66).
- The shade around a highlighted step is **Lighter** by default; Medium and Darker stay in Settings and the editor (D151).
- Search ignores accents: "creme" finds "Crème brûlée", in the panel and in the menu (D172).

### Fixed
- **Test step** works on apps that rebuild their frames: it no longer says "Waymark is not running on this page" for a step in a frame the app replaced (D152).

### Security
- Pages can read only the on/off switch of the recording outline, never any other recording setting (D154, #74).

## [0.4.1] - 2026-11-05

### Added
- The first time a tutorial or an English guide starts reading, Waymark offers the HD voice once, on the Tutorial page or in the side panel: **Listen to a sample** (a short clip that ships with Waymark), **Download** (about 170 MB, in the background: the usual voice keeps reading and the next step switches to HD when it's ready) or **Not now**. Only for an English browser on a computer that looks fast enough; never at install (D140, D141, D143).
- Tutorials are read with the HD voice once it's installed (D142).
- Choose how dark the page around a highlighted step is: **Settings → Highlight** for every guide and tutorial (Follow each guide, Lighter, Medium, Darker), or per guide in the editor (**Shade around the highlight**), which is saved in the guide and travels in guide files. A learner's own choice wins over the guide's (D144–D147).

### Changed
- The built-in tutorials' page is plainly called **Tutorial page**, with no made-up company names; the done card is compact (the check beside "Done!", one Close); the shade around a highlighted element is 20% lighter (D89).

### Fixed
- A step the HD voice model returns as silence (NaN audio) is now read by the system voice instead of playing silently (D148).

### For developers
- CI asks the Ubuntu mirror only for what is missing, and its browser and Xvfb steps time out within minutes. Two e2e shards had hit the 15-minute limit before any test ran (D59, #60).
- The Release workflow can be started by hand (**Actions → Release → Run workflow**, with the version and the release merge commit). It creates the tag after the same checks as a pushed tag (D160, #61, #62).

## [0.4.0] - 2026-11-05

### Added
- **Built-in tutorials**: five short tutorials (How Waymark works, Record your first guide, Edit a guide, Share a guide, What the warnings mean) play on a bundled Practice page, so you can learn Waymark without allowing it on any site. They are in the panel under **Tutorials**, and can be hidden (D128, D129, #41, fixes #37).
- **Debug log**, off by default (Settings → Problems → **Keep a debug log**): what the recorder, matcher and player decided and why, to paste into a bug report. It is kept only until the browser closes and never holds typed values or page text beyond step titles. While it is on, the not-found card can copy that page's part (D110–D112, #35, fixes #33).
- **Help** in the panel header, and short "?" explanations next to Allow and sharing (D122, #40).
- Settings lists the **Sites** Waymark may run on, each with Remove (D92, #24).
- The Waymark mark and extension icons (D94, #28).
- Light motion and press feedback in the side panel, Settings and the Practice page: buttons squeeze when pressed, rows lift on hover, folds and toasts slide in, reordered steps glide, a check pops in after Saved and Copied, and the REC dot pulses softly. Everything is short (80–240 ms) and turns into plain fades when the system asks for reduced motion (D130, D131).
- On the page, the spotlight ring glides from one step to the next (the dim no longer flashes between steps), the tooltip rises into place, its progress bar eases, a press on the highlighted element ripples, and the REC pill's dot pulses softly. None of it delays a step or covers the element; all of it is off with reduced motion (D133).
- The on-page `?` launcher pops in, presses and opens its menu with the same light motion (D134).
- Undo for deleting a guide or a step: a message with Undo shows for 8 seconds. A deleted guide can still be restored from a side panel opened again in that time (D100).
- A **Completed** badge on guides you have finished, **Restart** (in the list and while a guide plays), and **Start from step N** in a guide's More menu (D101).
- Tag chips under the search box filter the library; the editor has a Tags field (D102).
- Duplicate for your own guides (More menu) and for steps in the editor (D103).
- Export a guide as a text how-to, in Markdown or as a printable page, after the same review as packs; text that looks like data is flagged in the review (D104).
- Keyboard shortcuts: Alt+R starts or stops recording in the current tab, Alt+W opens the side panel. Both can be changed at chrome://extensions/shortcuts (D105).
- Replay voice and Repeat step buttons in the tooltip (D106).
- Each version is published on the repository's Releases page, with the extension zip, its SHA-256 checksum and the notes from this file (D56).
- A privacy policy ([docs/PRIVACY.md](docs/PRIVACY.md)) that says exactly what Waymark stores and what can leave your device (D57).
- A new README: what Waymark is, how to install it from a release, and a quick start.

### Changed
- A new look, light and dark, with WCAG AA contrast: the side panel and editor (D91, #19), Settings (D92, #24), and the spotlight, tooltip, REC pill and ? launcher on the page (D93, #26). All icons and fonts are bundled (D90, D94).
- A simpler panel (#40, part of #37):
  - one main action per state; site options are folded away, and a site Waymark can't run on says **Off here** instead of "Not allowed" (D120);
  - the welcome is one card (D121);
  - library rows show **Edit**, **More** and **Start**; Share…, Copy link and Duplicate are under More, and **Export…** lets you pick guides (D124);
  - in the editor, steps fold to one line; steps with a warning start open (D125);
  - the export review lists element paths under **Technical details** (D126);
  - the tooltip says what to do on the page ("Click the highlighted element to continue."), and names read plainly: sites by their host, "guide file" for a pack (D123, D127).
- A click on plain content inside a clickable card (such as a dashboard tile) records the card, so a click anywhere on the card moves the guide on (D82, #34, fixes #32).
- A step is read aloud once its element is found, not while a slow frame is still loading (D83, #34).
- Element ids, test ids, names and classes that look like data (emails, phone numbers, UUIDs, long numbers) are no longer stored in guides or guide files (D66, #27).
- Waymark is for internal use for now: install it from a release. There is no store listing; the draft in [docs/STORE.md](docs/STORE.md) is kept for later (D58).

### Fixed
- On pages that rebuild themselves after loading, a step could be drawn on a look-alike element while the real one was briefly gone. A match must now beat every look-alike seen at record time (D64, #18).
- Check boxes in to-do style lists that have no name of their own are recorded again, named by the item ("Check **Walk the dog**") (D65, #25).
- A click and the in-app page change it caused are recorded in the right order even when the messages arrive out of order (D67, #30).
- A page that replaces its frames no longer leaves a step undrawn (D84, #39, fixes #38).
- The ? launcher starts the chosen guide in the installed build. Before, a click closed the menu and nothing started. If a guide can't start, the menu now says why (D85, #45, fixes #42).
- Each frame reports its search once per step. Before, frames re-sent their result in waves, which filled the debug log (D87, #48, fixes #36).
- The team library's site, when it is allowed only to download the guide file, no longer runs Waymark or shows as allowed (D80, #23, fixes #21). The library is downloaded once per browser start, not twice (D81, #23, fixes #22).
- In the editor, a long step title wraps instead of making the side panel scroll sideways, and the "Saved" note goes away once you edit again (D88, #53, fixes #52).
- Move up / Move down in the editor no longer drop keyboard focus to the page (D131).
- The tooltip's mute button can be pressed again in the same step to unmute; before, it kept the state from when the step was drawn (D106).

### For developers
- Design tokens and components in `src/ui/`, and `pnpm screens`, a screenshot harness for every panel and on-page state, light and dark (D90, #15).
- E2E tests see the overlay's event paths the way the installed build does, and ESLint bans `composedPath()` in content code; a closed-root e2e stays as a canary (D85, D86, #45, #47, fixes #46).
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

[Unreleased]: https://github.com/ThomasDevJS/Waymark/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.7.0
[0.6.1]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.6.1
[0.6.0]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.6.0
[0.5.0]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.5.0
[0.4.1]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.4.1
[0.4.0]: https://github.com/ThomasDevJS/Waymark/releases/tag/v0.4.0
[0.3.2]: https://github.com/ThomasDevJS/Waymark/pull/13
[0.3.1]: https://github.com/ThomasDevJS/Waymark/pull/14
[0.3.0]: https://github.com/ThomasDevJS/Waymark/pull/10
[0.2.4]: https://github.com/ThomasDevJS/Waymark/pull/11
[0.2.3]: https://github.com/ThomasDevJS/Waymark/pull/8
[0.2.2]: https://github.com/ThomasDevJS/Waymark/pull/7
[0.2.1]: https://github.com/ThomasDevJS/Waymark/pull/5
[0.2.0]: https://github.com/ThomasDevJS/Waymark/pull/3
[0.1.0]: https://github.com/ThomasDevJS/Waymark/pull/1
