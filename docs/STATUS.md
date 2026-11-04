# Waymark status and handoff

As of 4 Nov 2026 the version is 0.2.2, on branch `waymark-v1`. This file is for a new session that has none of the history. Read `docs/SPEC.md` first, then `docs/DECISIONS.md`: D1–D47 are mine, R1–R7 came from the PR #1 review. Then read `CLAUDE.md`.

## What works today
| Area | State | Main code |
| --- | --- | --- |
| Scaffold (M0) | WXT MV3 with a strict manifest (no `content_scripts`, no `host_permissions`). Site access is per site from the side panel. The content script is registered at runtime and re-synced. Messages are typed, with Zod checks and allowlists per sender. | `src/entrypoints/background.ts`, `src/core/permissions/registration.ts`, `src/core/messaging/protocol.ts` |
| Fingerprint and matcher (M1) | Normalized weighted score, the strong-signal rule, unique margin, instance `any`, wait loop, frame winner. Robustness suite: 480/480 on mutation set A, 0 wrong matches. | `src/core/fingerprint/*`, `src/core/matcher/*` |
| Recorder (M2) | Capture and merge rules; navigation, including slow loads (D21, D34); frames; privacy guards; live list; REC pill and badge. | `src/core/recorder/recorder.ts`, `src/core/recorder/session.ts`, `src/background/recording.ts` |
| Player (M3) | Top-layer overlay, also inside modal dialogs. Spotlight, Floating UI tooltip, advance rules, runs across pages and tabs, not-found / off-track / done cards, Report broken step, keyboard commands. | `src/content/player/*`, `src/core/player/*`, `src/background/runs.ts` |
| Editor and voice (M4) | Edit, reorder, delete and note steps; Test step; Re-pick. `chrome.tts` reads each step once, on-device voices only by default, with a mute toggle and a `speechSynthesis` fallback. The best voice is picked automatically (D46). | `src/entrypoints/sidepanel/Editor.tsx`, `src/content/editor.ts`, `src/background/{editor,voice}.ts` |
| Discovery and sharing (M5) | Badge count; "For this page" and MiniSearch; the `?` launcher; deep links and Copy link; export review; pack import with the spec's rules; library URL on `chrome.alarms`; first-run Allow; Problems list. | `src/background/discovery.ts`, `src/core/sharing/*`, `src/core/discovery/*`, `src/content/launcher.ts`, `src/entrypoints/sidepanel/{Library,ExportReview}.tsx`, `src/entrypoints/options/Options.tsx` |
| M6 (partial) | Popup fallback without `chrome.sidePanel` (D43); version 0.2.0 (now 0.2.2: D46, D47); CI uploads the production zip as the `waymark-extension` artifact. | `src/background/panel-fallback.ts`, `.github/workflows/ci.yml` |

Not built yet (M6): the store listing, privacy policy, browser matrix, `docs/BROWSERS.md` and pilot guides. Phase 2 has not been started.

## Known limitations (deliberate)
- **D47:** a click with nothing to find it by again (no name, text, label or id) is not recorded; the REC pill says so. Not announced when it happens inside an iframe.
- **D37:** clicking the tooltip can still close some of the app's own menus. Handlers in the capture phase and `popover=auto` light dismiss see the click.
- **D24:** elements with only `cursor: pointer` or `tabindex` are not treated as interactive. Revisit with pilot data.
- **D33 + D36:** the start URL drops ids, so for first pages like `/orders/:id` the panel asks the learner to open the page themselves.
- **D41:** site profiles (extra stable attributes, ignore patterns, hash routing, kept query keys) exist in the code (`src/core/model/profile.ts`, threaded through as `ProfileOptions`) but have no UI and aren't loaded anywhere. The recorder and picker run without a profile.
- No strict spotlight mode. Analytics and Phase 2 are out of scope.

## Manual checks still pending
1. Voice is audible in Chrome and Edge (M4); CI only spies on `chrome.tts`.
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
- **Demo app for manual testing:** `pnpm demo` serves `demo/` at http://localhost:8080 (see `demo/README.md`).
- `pnpm test:e2e:xvfb`: builds `.output-test` and runs Playwright headed under Xvfb (31 tests, about 3 minutes). Grant tests accept Chrome's native permission dialog with `test/e2e/helpers/x11-keys.py` (Tab, Enter).
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
  - one-page privacy policy (GitHub Pages);
  - a private Chrome Web Store listing;
  - pilot guides on 1–2 real apps;
  - a UI for site profiles, which would also fix D41's open note.
