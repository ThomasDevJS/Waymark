# Waymark status and handoff

As of 5 Nov 2026 the version is 0.7.0, on branch `waymark-v1`. This file is for a new session that has none of the history. Read `docs/SPEC.md` first, then `docs/DECISIONS.md`: D1–D49, D51 and D60–D67 are mine (D48: security audit, threat model in `docs/SECURITY.md`; D49: guide index for the panel and badges, `pnpm bench`; D51: HD voice; D60–D67: real-site harness fixes, the id privacy filter and the recording race, `docs/RELIABILITY.md`), R1–R7 came from the PR #1 review. Then read `CLAUDE.md`.

## What works today
| Area | State | Main code |
| --- | --- | --- |
| Scaffold (M0) | WXT MV3 with a strict manifest (no `content_scripts`, no `host_permissions`). Site access is per site from the side panel. The content script is registered at runtime and re-synced. Messages are typed, with Zod checks and allowlists per sender. | `src/entrypoints/background.ts`, `src/core/permissions/registration.ts`, `src/core/messaging/protocol.ts` |
| Fingerprint and matcher (M1) | Normalized weighted score, the strong-signal rule, unique margin, instance `any`, wait loop, frame winner. Robustness suite: 480/480 on mutation set A, 0 wrong matches. | `src/core/fingerprint/*`, `src/core/matcher/*` |
| Recorder (M2) | Capture and merge rules; navigation, including slow loads (D21, D34); frames; privacy guards; live list; REC pill and badge. | `src/core/recorder/recorder.ts`, `src/core/recorder/session.ts`, `src/background/recording.ts` |
| Player (M3) | Top-layer overlay, also inside modal dialogs. Spotlight, Floating UI tooltip, advance rules, runs across pages and tabs, not-found / off-track / done cards, Report broken step, keyboard commands. | `src/content/player/*`, `src/core/player/*`, `src/background/runs.ts` |
| Editor and voice (M4) | Edit, reorder, delete and note steps; Test step; Re-pick. `chrome.tts` reads each step once, on-device voices only by default, with a mute toggle and a `speechSynthesis` fallback. The best voice is picked automatically (D46). Optional HD voice: Kokoro-82M on the device in an offscreen document, with a GPL-free English G2P over the misaki lexicon (D51). | `src/entrypoints/sidepanel/Editor.tsx`, `src/content/editor.ts`, `src/background/{editor,voice,hd}.ts`, `src/offscreen/*`, `src/core/voice/g2p/*` |
| Discovery and sharing (M5) | Badge count; "For this page" and MiniSearch; the `?` launcher; deep links and Copy link; export review; pack import with the spec's rules; library URL on `chrome.alarms`; first-run Allow; Problems list. | `src/background/discovery.ts`, `src/core/sharing/*`, `src/core/discovery/*`, `src/content/launcher.ts`, `src/entrypoints/sidepanel/{Library,ExportReview}.tsx`, `src/entrypoints/options/Options.tsx` |
| M6 (partial) | Popup fallback without `chrome.sidePanel` (D43); version 0.2.0 (now 0.7.0: D46–D48, D51, D53, D60–D63); CI uploads the production zip as the `waymark-extension` artifact. | `src/background/panel-fallback.ts`, `.github/workflows/ci.yml` |

Not built yet (M6): browser matrix, `docs/BROWSERS.md` and pilot guides. The privacy policy is `docs/PRIVACY.md`. There is no store listing: Waymark is for internal use and installed from GitHub Releases (D58). Phase 2 has not been started.

## Interface (D90–D94)
- Design tokens (colour, spacing, radius, type, elevation, motion; light and dark) are in `src/ui/tokens.css`; components are in `src/ui/components.css`. The overlay uses the same tokens, scoped to its layer in the closed shadow root (`src/content/overlay/theme.ts`).
- Icons: Lucide, bundled (`src/ui/icons.ts` for the pages, one-by-one imports in the content script). The Waymark mark is in `assets/brand/`; `node scripts/icons.mjs` renders `public/icon/{16,32,48,128}.png`.
- `pnpm screens` shoots every screen and state (light, dark, dark browser on a light page, 200% zoom, phone) to compare before and after a UI change.

## Conveniences (D100–D106)
- Undo for deleted guides (a trash in `storage.local`, `src/core/storage/trash.ts`) and steps; one toast component (`sidepanel/Toast.tsx`). Completed badge, Restart and Start from step N (`run.start` `stepIndex`). Tag chips and the editor's Tags field (`src/core/discovery/tags.ts`). Duplicate guide and step. E2E: `test/e2e/q1-library-editor.spec.ts`.
- Text how-to export (`src/core/sharing/howto.ts`, a format choice in the export review). Shortcuts `toggle-recording` / `_execute_action` (`src/background/shortcuts.ts`; e2e presses real keys with `x11-keys.py Alt_L+r`). Tooltip Replay voice / Repeat step (`run.replay`). E2E: `test/e2e/q2-sharing-playback.spec.ts`.

## Debug log (D110–D112)
- Settings → Problems → **Keep a debug log** (off by default). Core ring buffer, redaction and text format: `src/core/debug/log.ts`. Service worker logger, handlers and the copy header: `src/background/debug.ts` (`dlog`, its own write queue, never `enqueue`). Content logger: `src/content/debug.ts`. Hooks: the recorder's `debug` option, `watchAdvance`'s `debug` option, `promoteToRegion`/`clickableRegion`'s `why`, the player controller, `runs.ts`, `recording.ts` (inside `mutate`) and `voice.ts` (`stopSpeech(why)`).
- Tests: `test/unit/debug-log.test.ts`, `test/browser/debug-log.test.ts`, the debug-on case in `test/unit/recording-race.test.ts`, e2e `test/e2e/q3-debug-log.spec.ts`. Tester steps: `docs/TESTING.md` section 4.

## First-time UX (D120–D127, issue #37)
- Audit, walkthrough findings, information architecture, copy rules and the tutorials design: `docs/UX.md`.
- Panel: one primary action per state, Site options folded (`App.tsx`), Help card and inline `?` (`sidepanel/Help.tsx`), one-card welcome, library rows with Edit / More / Start and export selection mode (`Library.tsx`), folded editor steps (`Editor.tsx`), Technical details in the export review. On the page: the tooltip's action hint (`actionHint`, `content/player/ui.ts`).
- Tests: `test/browser/panel-clarity.test.ts`, `test/unit/names.test.ts`. E2E opens a step (`step-N-toggle`, `step-N-more`) and Site options before using what's inside.

## Built-in tutorials (D128, D129)
- Pack: `src/core/tutorials/pack.json` (schema and helpers in `tutorials.ts`, run loop in `runner.ts`). Practice page: `src/entrypoints/practice/` (`Practice.tsx` app and panel picture, `player.ts` drives `PlayerUI` + `waitForMatch` + `watchAdvance`). Panel section: `sidepanel/Tutorials.tsx`. Voice: `src/background/tutorials.ts` (`tutorial.speak`, `tutorial.stop`).
- Adding a tutorial: add it to the pack; any new target needs a `data-guide-id` on the practice page (and an entry in `VIEW_OF` if it lives in a view). `test/browser/practice.test.ts` fails if a target is missing or not found uniquely.
- Tests: `test/unit/tutorials.test.ts`, `test/browser/practice.test.ts`, e2e `test/e2e/t1-tutorials.spec.ts` (test hook: `data-waymark-test-practice` = `drawn:N`, `not-found:N`, `off-track:N`, `done:N`, `finished`, `exited`).

## Motion (D130–D134, issue #43)
- Tokens (durations, easings, distances, press scales) and the reduced-motion path are in `src/ui/tokens.css`; the CSS rules are the "motion" section of `src/ui/components.css`. JS helpers: `src/ui/motion.ts` (`reducedMotion`, `flipList`), `src/ui/useMotion.ts` (`useFlipList` for reorderable lists).
- Rules: animate only transform and opacity (a unit test reads every stylesheet), 80–240 ms, nothing moves under reduced motion, never move something the player may be measuring, never take focus or change what screen readers hear.
- On the page (D133): the ring's glide, the tooltip's exit copy, the progress ease and the click ripple are in `src/content/player/ui.ts` (`glide`, `leave`, `watchPress`); the REC halo is in `src/content/overlay/pill.ts`. Test builds count glides and ripples in `data-waymark-test-motion`.
- Tests: `test/unit/motion.test.ts`, `test/browser/motion.test.ts`, `test/browser/player-motion.test.ts`, e2e `test/e2e/p1-player-motion.spec.ts` (closed root, motion on). Frame times: `pnpm motion:bench` (4× slower CPU, results in `artifacts/motion/`). Frame sequences: `pnpm screens` (`test/screens/motion.spec.ts`) and `scripts/frames.py`.

## HD voice offer (D140–D143, issue #44)
- Card: `src/ui/HdOffer.tsx` (Practice page beside the tutorial list, side panel under the playing card). Gate: `src/core/voice/offer.ts` (`shouldOfferHd`), answer in `ui:hdOffer`. Download: `src/ui/hdDownload.ts`, shared with Settings. Tutorials on HD: `speakHdFirst` in `src/background/voice.ts`. Sample: `public/hd-sample.ogg`, made by `scripts/hd-sample.mjs`.
- Tests: `test/unit/hd-offer.test.ts`, `test/browser/hd-offer.test.ts`, the D142 block in `test/unit/hd-sw.test.ts`, e2e `test/e2e/h1-hd-offer.spec.ts` (test hook `test:hdOfferEnv` stands in for the navigator's language, cores and memory).

## Highlight shade (D144–D147, issue #58)
- Levels and precedence: `src/core/player/shade.ts` (no Zod, the content script imports it); learner setting: `src/core/player/settings.ts`, `src/background/player-settings.ts` (`player.settings.get/set`); the guide's optional `shade` in `GuideSchema`. The resolved level goes out in `viewFor` (`RunView.shade`). Drawing: `.spot[data-shade]` and the `--wm-scrim-lighter/-darker` tokens. UI: `options/Shade.tsx`, the editor's "Shade around the highlight". The Practice page follows Settings (`PracticePlayer.setShade`).
- Tests: `test/unit/shade.test.ts`, `test/browser/shade.test.ts` (open and closed root), e2e `test/e2e/h2-shade.spec.ts` (test hook `data-waymark-test-shade` = `level|computed box-shadow`).

## Search among a page's guides (D170–D172, issue #69)
- From 6 guides for a page (`PAGE_SEARCH_FROM`): the `?` menu becomes a combobox with a box, up to 3 tag chips and a listbox (`searchList` in `src/content/launcher.ts`); the panel's "For this page" gets its own box and chips (`Library.tsx`). Pure matching, chips and caps: `src/core/discovery/page-search.ts`. `guide.forPage` sends `{ id, title, tags }`, capped and parsed with `ForPageResponseSchema`.
- Tests: `test/unit/page-search.test.ts`, `test/browser/launcher-search.test.ts` (closed root, real keys), e2e `test/e2e/s1-page-search.spec.ts` (test hooks `launcher-menu`, `launcher-results`, `launcher-active`).

## Step screenshots (D180–D188, reworked in D190–D199, issues #68 and #78)
- Off by default, per guide (`shots:guides` in storage.local; the recording's `shots`). Capture: `src/background/shots.ts` (queue, `hideFrames` in every frame, `grab`, full-page WebP encode, sweep), hooked once in `rec.step` (`src/background/recording.ts`) and in `step.test` (`src/background/editor.ts`), in any frame. Pure parts: `src/core/shots/place.ts` (frame geometry `resolveChildren` / `layoutFrames` / `placeElement`, `planImage`, caps, `zoomRect`), `report.ts` (Zod check of each frame's answer), `rate.ts`, `lifecycle.ts`. Store: IndexedDB `waymark-shots` (`store.ts`; `v: 2` whole page, no `v` = a 0.5.0 close-up).
- Page side: `src/content/shots.ts`. Every frame hides the overlay host and field text (shadow roots too) and posts the capture's token to its parent and answers after painting with its viewport, its embedded documents (border box, content box, scale, the token each child posted) and, in the step's frame, the element. The service worker names child frames by token (checked against the frame registry), masks every embedded document whose frame did not answer, and drops the image unless every frame confirms with `shot.check` after the capture.
- Export: the review (`ExportReview.tsx`) opens the preview page `howto.html` (`src/entrypoints/howto/`: `Preview.tsx`, `data.ts`) with per-step Keep / Leave out / Blur / Zoom, Save as PDF (print) and Download HTML. Drawing: `src/core/shots/render.ts` (ring, dim, number, light blur, zoom). Page: `howtoHtml(…, images, { date })` and `PRINT_CSS` (`src/core/sharing/howto.ts`). UI switch: `sidepanel/Shots.tsx`; the editor marks old close-ups with Capture again.
- Needs activeTab (Alt+W, Alt+R or the toolbar icon on that tab): a site permission alone is refused (D181).
- Tests: `test/unit/shots.test.ts`, `test/browser/shots.test.ts`, `test/browser/howto-preview.test.ts`, e2e `test/e2e/s2-screenshots.spec.ts` and `s3-screenshot-frames.spec.ts` (fixture `test/fixtures/site/shots/`; both run with `viewport: null`; test hook `data-waymark-test-shot-hidden`). Playwright's `boundingBox()` inside a cross-origin iframe leaves out that iframe's border and padding (D199).

## Fix a step during playback (D210, issue #95)
- On the author's own guide, the not-found card and the tooltip's crosshair button start **Pick the right element**: `run.fix.start` → `Run.fix` → the view's `fixing` hides the player and every frame enters the editor's pick mode. The answer (`pick.result` with no editor pick pending) saves the guide and moves the run onto the fixed step (`fixPicked`, `src/background/fix.ts`; pure parts `fixedStep`, `applyRunStep`, `fixPending` in `src/core/player/run.ts`). The panel's Undo toast reads `runFix:<tabId>` (`Library.tsx`) and sends `run.fix.undo`.
- Tests: `test/unit/fix-step.test.ts`, e2e `test/e2e/f1-fix-step.spec.ts` (test hook `player=fixing:N`).

## Known limitations (deliberate)
- **D47:** a click with nothing to find it by again (no name, text, label or id) is not recorded; the REC pill says so. Not announced when it happens inside an iframe.
- **D37:** clicking the tooltip can still close some of the app's own menus. Handlers in the capture phase and `popover=auto` light dismiss see the click.
- **D24:** elements with only `cursor: pointer` or `tabindex` are not treated as interactive. Revisit with pilot data.
- **D33 + D36:** the start URL drops ids, so for first pages like `/orders/:id` the panel asks the learner to open the page themselves.
- **D41:** site profiles (extra stable attributes, ignore patterns, hash routing, kept query keys) exist in the code (`src/core/model/profile.ts`, threaded through as `ProfileOptions`) but have no UI and aren't loaded anywhere. The recorder and picker run without a profile.
- No strict spotlight mode. Analytics and Phase 2 are out of scope.

## Manual checks still pending
1. Voice is audible in Chrome and Edge (M4); CI only spies on `chrome.tts`. HD voice (D51) on real laptops: download, speed check, sound; CI uses a stub engine.
2. Load unpacked in Chrome and Edge (M0); the M6 browser matrix (Brave, Opera, Vivaldi, Arc) goes into `docs/BROWSERS.md`.
3. Leftover-script cleanup after an extension update (D11). Chromium leaves a command-line-loaded extension disabled after a reload, so e2e can't cover it.
4. Popup fallback in a browser that really has no side panel (Opera, Arc).
5. Tester walkthrough: `docs/TESTING.md`.

## Where the tricky code lives
- **Matcher accept rules:** `src/core/matcher/match.ts`. Score, the ≥60 threshold, the strong-signal rule, the 15-point unique margin, the "positional-only lead is not enough" rule (D4), and tie groups for `any` (D5, R5). The weights are in `signals.ts`. Never return a wrong element; the robustness suite guards this.
- **Accessible names:** `src/core/fingerprint/dom.ts`, browser-like per R2. Stability filters are in `filters.ts` (D22, R1). CSS paths are in `selectors.ts` (D3).
- **Frame mapping:**
  - nonce registry: `src/core/frames/registry.ts`;
  - content side: `src/content/frames.ts` (a frame answers its children only once its own path is known);
  - the frame winner per step: `src/core/player/board.ts`, keyed by frame (D36), with re-reports (D45).
- **Run state:** `src/core/player/run.ts`. It holds `stepToken`, `rev` (orders views), `spokenToken` (speech once per step, D41), and the catch-up after a lost link click (D32). The service worker side is `src/background/runs.ts`; every read-modify-write goes through `enqueue`.
- **Recorder merge rules:** `src/core/recorder/recorder.ts`:
  - fingerprint built at pointerdown;
  - the field click is held until typing or a change;
  - same-task de-duplication for check steps (D18);
  - submit merging;
  - shadow-root change and submit listeners (D35).
  The navigation rule is in `session.ts`.
- **Content lifecycle:** `src/content/main.ts`. The newest instance replaces the old one. The overlay host has one owner at a time and hands back (`src/content/overlay/host.ts`, D40, D41).

## Running and debugging tests
- `pnpm check`: typecheck, lint, both builds, manifest guard, unit (happy-dom) and browser-mode Vitest. Run it before every push (see CLAUDE.md).
- `pnpm screens`: screenshots of every panel, settings and on-page state, light and dark, into `artifacts/screens/` (D90). Not part of `pnpm check`; run it for UI changes and compare with a set made before the change (`SHOTS=before pnpm screens`).
- `pnpm motion:bench`: frame times of the panel and player animations with the CPU slowed 4× (D132). Not part of `pnpm check`; run it when touching motion.
- `pnpm bench`: the performance harness (`test/perf/`, 500 guides of 50 steps through the service worker paths). Not part of `pnpm check`; run it when touching storage, the index, badges or search (D49).
- **Demo app for manual testing:** `pnpm demo` serves `demo/` at http://localhost:8080 (see `demo/README.md`).
- `pnpm test:e2e:xvfb`: builds `.output-test` and runs Playwright headed under Xvfb (69 tests, about 8 minutes). Grant tests accept Chrome's native permission dialog with `test/e2e/helpers/x11-keys.py` (Tab, Enter).
  - One file: `xvfb-run -a npx playwright test m3`. One test: `-g "name"`.
  - After changing `src/`, rebuild first with `pnpm build:test`; e2e tests use the built extension.
  - Failure traces are in `test-results/*/error-context.md`.
- Test hooks exist only in test builds: `data-waymark-test-*` attributes on `<html>`, read with `marker()` in `test/e2e/fixtures.ts`. For example `player=drawn:3`, `recording=on`, `picking=on`, `launcher=1`.
- **Messages in e2e:** send them from an extension page opened as a popup window (the `msg()` helper in the m4/m5 specs). That keeps the app tab active in the last-focused window, which voice needs (D39).
- **Restarting the service worker:** a CDP session on an extension page, then `ServiceWorker.stopAllWorkers`. Watch `workerVersionUpdated`, because Playwright's worker handles go stale (D30).
- **Fixture site:** `pnpm fixture`, at `http://127.0.0.1:4173`, with cross-origin frames from `localhost`.
  - The generator is `test/fixtures/site/app.js`, with `data-fx` keys.
  - Other pages: `page2.html` (modal dialog), `page3.html` (cross-origin iframe), `/slow/...` (a 2.5 s load).
  - `PUT /__library` sets a library pack for tests.
- **Real sites (opt-in, needs network):** `pnpm test:real` records and replays scripted tasks on public demo apps (TodoMVC, the-internet, MUI, Ant Design, Angular Material, SauceDemo, demoqa, a hash-routed AngularJS bank) and prints a results table. Not in CI. Results and screenshots of wrong or stuck steps go to `test-results/real/`; the table lives in `docs/RELIABILITY.md`.
- **Robustness numbers:** `npx vitest run --project browser test/browser/robustness.test.ts --reporter=verbose`, then grep for `[set`.

## Notes for my successor
- **CI:**
  - Push only commits that pass `pnpm check` locally, plus `pnpm test:e2e:xvfb` when the change touches anything e2e covers.
  - Each failed run emails the owner.
  - CI is slower than this container, and it surfaced two timing races that never showed locally (D45, and one in M4).
- **Reviews:** every milestone got an independent review by a subagent that was not shown my reasoning. Each found real bugs. Keep doing it, and confirm each regression test fails on the old code.
- **Coordination:** a parent session opens and merges pull requests. Work on `waymark-v1`, never open pull requests, and record every spec deviation in DECISIONS.md with a D-number.
- **Next work (M6):**
  - browser matrix and `docs/BROWSERS.md`;
  - pilot guides on 1–2 real apps;
  - a UI for site profiles, which would also fix D41's open note.
