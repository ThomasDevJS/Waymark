# Waymark: notes for future sessions

- **Start here**: `docs/STATUS.md` (what works, where the tricky code is, how to test), then the spec.
- **Source of truth**: `docs/SPEC.md`. Read it before changing behavior. When the spec turns out wrong or impossible, make the smallest sensible change and add an entry to `docs/DECISIONS.md` (date, spec section, what changed, why). Never diverge silently.
- **Build core-first**, one milestone at a time (spec "Milestones"). Stop at the end of a milestone, not midway.
- **Hard rules**: $0 running cost, open-source dependencies only, no backend, no API keys, tokens or secrets anywhere. Manifest V3, no remote code. The built manifest must have no `content_scripts` and no `host_permissions` (`pnpm check:manifest`). The content script is the unlisted `src/entrypoints/waymark-content.ts`, registered at runtime per granted site.
- **Matcher rule**: never return a wrong element; prefer not-found. Any matcher change must keep the robustness suite (`test/browser/robustness.test.ts`, `repeated-ambiguity.test.ts`) at zero wrong matches and ≥95% found on mutation set A.

## Conventions

- TypeScript strict (`noUncheckedIndexedAccess` on). Pure logic in `src/core/**` with no `chrome.*` calls where possible; pass small API interfaces in (see `RegistrationApi`, `KV`) so it is unit-testable.
- The service worker keeps no state in memory; use `chrome.storage` (session for runs, recordings, frame maps). Serialize read-modify-write through `enqueue` (`src/core/storage/queue.ts`).
- Every runtime message is a type in `src/core/messaging/protocol.ts` with a Zod schema; add new types to the right sender allowlist. Content scripts are untrusted: validate everything, and send them only data for their own origin.
- Never put user strings in `innerHTML` (ESLint enforces it). Never store typed field values.
- Test-only behavior goes behind `__WAYMARK_TEST__` (true only in `pnpm build:test` and Vitest). Test markers are `data-waymark-test-*` attributes on `<html>`.
- Commits: small and logical, clear messages, on branch `waymark-v1`. No PRs unless asked (a parent session opens and merges them).
- **Push only green commits**: `pnpm check` must pass locally, plus `pnpm test:e2e:xvfb` when the change touches anything e2e covers. Every failed CI run emails the repo owner. Keep work-in-progress commits local until they are green.
- Every milestone gets an independent review (a subagent that does not see your reasoning); fix findings with regression tests that fail on the old code.

## Testing

- `pnpm test:unit` (happy-dom, no layout) for pure logic; `pnpm test:browser` (Vitest browser mode, Chromium) for anything that needs layout, visibility or rects.
- `pnpm test:e2e:xvfb` builds the test extension and runs Playwright headed under Xvfb. Grant tests accept the native permission dialog with `test/e2e/helpers/x11-keys.py` (Tab, Enter). E2E uses one worker and a fresh profile per test.
- In the cloud dev environment, Chromium is pre-installed at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`). Do not run `playwright install` there; `@playwright/test` is pinned to 1.63.0 to match it. CI installs its own browser.
- The fixture app (`test/fixtures/site/app.js`) is plain JS so both the static site and Vitest can import it. Elements tests target carry `data-fx` keys, which `takeKeys()` strips before fingerprinting.
