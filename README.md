# Waymark

Waymark is a Chromium (Manifest V3) extension that records click-by-click walkthroughs of a web app and replays them on the live page: it spotlights the real element, shows a note, and can read it aloud. No screenshots, no servers, $0 to run.

The spec, which is the source of truth, is [`docs/SPEC.md`](docs/SPEC.md). Deviations and findings are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

**Status:** M0 (scaffold) and M1 (fingerprint and matcher) are done. The recorder (M2) is next.

## Build

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm build          # production build -> .output/chrome-mv3
pnpm build:test     # test build (test hooks on) -> .output-test/chrome-mv3-test
pnpm dev            # WXT dev mode with reload
```

## Load unpacked

1. Run `pnpm build`.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose `.output/chrome-mv3`.
4. Open a web app and click the Waymark toolbar icon. The side panel opens; click **Allow on this site** to grant that site only.

## Tests

```sh
pnpm typecheck && pnpm lint
pnpm test:unit       # Vitest + happy-dom: pure logic
pnpm test:browser    # Vitest browser mode in Chromium: matcher, robustness suite
pnpm test:e2e:xvfb   # Playwright with the built extension, headed under Xvfb
pnpm check:manifest  # CI guard: no content_scripts, no host_permissions
pnpm fixture         # serve the fixture app at http://127.0.0.1:4173
```

The e2e tests that grant site access need a display, because Chrome's permission dialog is native UI (see DECISIONS D10). Without one (`pnpm test:e2e`), they are skipped.

## Layout

```
src/entrypoints/   background (service worker), sidepanel, waymark-content (unlisted content script)
src/content/       content script runtime: route watching, frame mapping, lifecycle
src/core/          fingerprint, matcher, model (Zod), messaging, permissions, storage, url, text
test/unit/         Vitest + happy-dom
test/browser/      Vitest browser mode: fingerprint, wait loop, robustness suite
test/e2e/          Playwright end-to-end with the built extension
test/fixtures/     the tricky fixture app and its static server
```
