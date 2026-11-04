# Decisions

Changes to, clarifications of, and findings against `docs/SPEC.md`, recorded as we build.
Each entry: date, spec section, what changed, why.

## 2026-11-04 — M0 / M1

### D1. Content script entrypoint is `src/entrypoints/waymark-content.ts`
- **Spec**: Tech stack, repo layout (`entrypoints/content/index.ts`).
- **Change**: the unlisted script lives at `src/entrypoints/waymark-content.ts` (built to `/waymark-content.js`); its runtime code lives in `src/content/`.
- **Why**: WXT classifies `content.ts` and `content/index.ts` as manifest content scripts by file name. An unlisted script needs a different name. `registration: 'runtime'` was rejected because WXT then adds the script's matches to `host_permissions`, the exact problem audit item A6 describes.

### D2. Accessible name falls back to `title`, then `placeholder`, for form fields
- **Spec**: Data model (`accessibleName`: "aria-label, aria-labelledby or `<label>` text"); Element targeting.
- **Change**: for `input`, `textarea` and `select` with no label, the accessible name uses `title`, then `placeholder` (the browser's own accessible name computation does the same). The data-like filter still applies.
- **Why**: in the first robustness run, fields with only a placeholder (a search box, an input inside a shadow widget) had no strong signal at all, so they were never found, not even on an unchanged page. The placeholder stays a separate weak signal too.

### D3. The CSS path includes short `aria-label`s on ancestors
- **Spec**: Element targeting, record step 2 ("CSS path built from stable attributes and classes only").
- **Change**: an ancestor's `aria-label` (at most 60 characters, not data-like) is part of its CSS path segment, e.g. `section.card[aria-label="Starter plan"] button.btn`.
- **Why**: a reading of "stable attributes". Without it, look-alike buttons in named cards or forms were tied after sibling reordering, and when the recorded button was removed, its look-alike scored exactly 60 and was **wrongly accepted**. With it, the robustness suite has no wrong matches.

### D4. A lead built only from position does not satisfy the unique margin
- **Spec**: Element targeting, playback step 4.
- **Change**: in addition to "score ≥ 60, one strong signal, lead ≥ 15", an `instance: 'unique'` match is rejected as ambiguous when the runner-up matched every non-positional signal the best candidate matched. That is, XPath and nearby position alone may not decide between two otherwise identical elements.
- **Why**: XPath plus position are worth up to 20 normalized points when a fingerprint has few signals, more than the 15-point margin. When an identical copy of a unique element is inserted before it, the copy takes over the original's XPath and position and wins with a 20-point lead: a wrong match the formula accepts. This rule is only ever stricter than the spec, so it can only turn a match into not-found.

### D5. Definitions of "best selector" (record time) and "tied" (playback, instance `any`)
- **Spec**: Element targeting, record step 3 and playback step 5.
- **Change**: `matchCount` is the number of visible, enabled elements that match **every non-positional signal** in the fingerprint (scored by the playback matcher itself). More than one sets `instance: 'any'`. At playback, the tied group is every candidate with a strong signal, a score of 60 or more, and the same set of matched non-positional signals as the best candidate. The spotlight goes to the first of them in document order, and a click on any of them counts.
- **Why**: "the best selector" is not defined. Using the matcher's own signals keeps record and playback consistent: table row buttons become `any`, and look-alikes that a landmark tells apart stay `unique`. XPath and position are excluded because they always differ between rows.

### D6. Candidate gathering also uses test id, `data-guide-id`, `name`, placeholder and link path
- **Spec**: Element targeting, playback step 2.
- **Change**: the candidate union also includes elements that match those signals, in addition to id, role plus name, tag plus text, CSS path and XPath.
- **Why**: it only adds recall (for example a repeated test id that the fast path cannot take); scoring decides. `data-guide-id` and the test id share the 40-weight "test id" signal.

### D7. The wait loop also polls every 500 ms and listens to `navigation.currententrychange`
- **Spec**: Element targeting, playback step 6.
- **Change**: besides DOM mutations (document and each open shadow root on `shadowPath`) and route events, a 500 ms safety poll re-runs the matcher. Re-runs remain throttled to at most one per 100 ms, and the loop stops at 8 seconds.
- **Why**: CSS-only visibility changes (transitions, `:hover` menus) produce no mutation.

### D8. Frame mapping messages are on the content script allowlist
- **Spec**: Permissions, privacy and security (content scripts may send only `rec.step`, `run.advance`, route reports and `guide.forPage`); Recorder, "Frames and shadow DOM".
- **Change**: content scripts may also send `frame.nonce`, `frame.claim` and `frame.path`. The protocol: a child frame posts a hello to its parent; the parent (only once its own path is known) asks the service worker for a nonce bound to (tab, parent frameId, iframe selector) and posts it into that iframe; the child returns it with `frame.claim`; the service worker checks tab, expiry (30 s), single use, and maps child frameId → (parent frameId, selector). `frame.path` walks that map.
- **Why**: the spec's nonce flow needs these three messages. The "own path first" rule fixes a race found by the e2e test: a nested `srcdoc` frame could claim before its parent and get no path.

### D9. Finding: Navigation API events DO reach the content script's isolated world
- **Spec**: Recorder, "Navigation" (marked unverified).
- **Result**: settled by `test/e2e/m1-content.spec.ts` on Chromium 153 (Chrome for Testing, Playwright 1.63): a listener added in the content script receives `currententrychange` with `navigationType` `push` (pushState, hash change, query-only change), `replace` (replaceState) and `traverse` (back), plus `navigatesuccess`. The 500 ms URL check stays as the fallback for browsers without the Navigation API (it shipped in Chrome 102).

### D10. E2E tests accept Chrome's native permission dialog with the keyboard under Xvfb
- **Spec**: Milestones M0 ("Granting a site registers the content script…"); Tech stack, testing.
- **Change**: grant tests run a headed Chromium under `xvfb-run`; a real click calls `chrome.permissions.request` and `test/e2e/helpers/x11-keys.py` sends Tab, Enter through XTest to accept the dialog. Without a display, those tests are skipped. CI installs Xvfb and runs them.
- **Why**: the permission prompt is native browser UI that Playwright cannot reach; Chromium has no command-line switch that auto-accepts it, and re-requesting a removed permission still prompts.

### D11. The "after an update" path is covered by a unit test, not e2e
- **Spec**: Architecture, "Content script" (inject into open tabs after an update; a leftover script removes its overlay).
- **Change**: e2e covers grant, revoke, open-tab injection after a grant, and re-sync at startup. Leftover-script cleanup is unit-tested (`test/unit/content-lifecycle.test.ts`): the newest instance always replaces the previous one, and an instance disposes itself when `chrome.runtime.id` disappears.
- **Why**: in this Chromium, a command-line-loaded extension stays disabled after `chrome.runtime.reload()` or a reload from chrome://extensions, so an update cannot be driven from Playwright. Worth a manual check in M6.

### D12. Storage access level verified
- **Spec**: Data model, Storage (`TRUSTED_CONTEXTS`).
- **Result**: `chrome.storage.local.setAccessLevel` and `session.setAccessLevel` both succeed in Chromium 153, and the e2e test confirms a content script gets an error reading either area.

### D13. Smaller clarifications
- `rect` stores document coordinates (client rect plus scroll) and the viewport size. "Position near the recorded spot" means centers within max(40 px, 5% of the viewport) on each axis, with x scaled by the viewport width ratio.
- The "ancestor landmarks" signal is all-or-nothing on the (tag, role, label) list, and is present even when the list is empty.
- Landmarks are the nearest three ancestors with a landmark or container role (banner, navigation, main, form with a name, region with a name, dialog, toolbar, tablist, table, group, …); labels come from aria-label/labelledby, `<legend>` or `<caption>`.
- Class tokens that describe UI state (`active`, `is-open`, `selected`, …) are dropped like generated ones.
- Tool versions are pinned to stable majors: TypeScript 5.9, Vitest 4, Preact 10, ESLint 9, WXT 0.21.4, and Playwright 1.63.0 to match the Chromium build pre-installed in the dev environment.
- Test builds (`pnpm build:test`, output `.output-test/chrome-mv3-test`) set `__WAYMARK_TEST__`, which enables `data-waymark-test-*` markers on `<html>` (and, later, open overlay shadow roots). Production builds compile them out.

## 2026-11-04 — M2

### D14. The service worker pushes the recording state to content scripts
- **Spec**: Permissions, privacy and security (content allowlist); Recorder, "State".
- **Change**: a content script learns whether its tab is recording from the reply to its route report (sent on every page load) and from a `rec.changed` push (`chrome.tabs.sendMessage`) when recording starts, pauses, resumes, stops or gets a step. The content script accepts the push only from its own extension's service worker (no `sender.tab`). The view holds `active`, `paused`, `count` and the last step title, never the steps.
- **Why**: this keeps the content allowlist as the spec wrote it (no extra "status" request), and recording still survives page loads and service worker restarts.

### D15. Steps carry an optional `flags` field
- **Spec**: Data model (`Step`); Recorder ("flagged low-confidence in the editor", "records the host element and flags the step"); Risks (canvas).
- **Change**: `Step.flags?: ('low-confidence' | 'closed-shadow' | 'canvas')[]`.
- **Why**: the spec asks the recorder to flag steps but the data model had no place for the flag.

### D16. Check step titles say Check or Uncheck
- **Spec**: Template step text (`Check (or uncheck) **{name}**`).
- **Change**: the title uses the state after the action: "Check **X**" or "Uncheck **X**". The literal "Check (or uncheck)" is used only when the state cannot be read. For ARIA switches the state is read after the app's own click handler has run.

### D17. Field clicks, html/body clicks, and non-interactive clicks
- **Spec**: Recorder, "Merge rules".
- **Change**: a click into a text field that is never typed into becomes a click step once the author moves on (it can open a date picker, for example). A click on a native select with no `change` records nothing. Clicks whose only target is `<html>` or `<body>` are ignored. A non-interactive click that has an interactive ancestor more than 5 levels up is dropped, as the spec says; the navigation it causes, if any, is recorded by the navigation rule.

### D18. Same-task de-duplication for check steps
- **Spec**: Recorder, "Merge rules" (checkbox, radio or switch: a direct click or a label click becomes one check step).
- **Change**: a label click, the click the browser forwards to its control, and the control's `change` all happen in one task. The recorder records the control once per task instead of using a time window.
- **Why**: a time window also swallowed a quick second toggle of the same switch, which is a real second step.

### D19. Navigation rule details
- **Spec**: Recorder, "Navigation".
- **Change**: "within 1.5 s of a recorded click" counts any recorded action step (click, input, select, check, submit), so an Enter-key submission that navigates belongs to its submit step. Steps recorded inside a frame get the top page's URL rule (set by the service worker from `sender.tab.url`); the frame chain is in `target.framePath`. A full page load is reported at `document_start`, when `document.title` is usually still empty, so its navigate step reads "Go to /orders/:id" (the routed path) unless a title is known.

### D20. Smaller M2 notes
- `autocomplete="current-password"` and `"new-password"` are also treated as sensitive fields.
- `tab.current` accepts an optional `tabId`. The test build's side panel accepts `?tab=<id>`, so e2e tests can drive the real panel UI opened as a tab.
- The on-page pill and the REC badge are driven by the same recording view. The pill lives in the overlay host (a manual popover with a closed shadow root, open in test builds) and is not clickable.

## 2026-11-04 — Fixes from the first real-app recording (GitHub)

### D21. A slow full page load belongs to the click that started it
- **Spec**: Recorder, "Navigation" (a navigation within 1.5 s of a recorded click belongs to that click).
- **Change**: the 1.5 s window is measured to when the old page *starts leaving*, not to when the new page reports in. The content script reports a `route.report` with `via: 'leaving'` on the Navigation API `navigate` event for a cross-document navigation (or `beforeunload` as a fallback). The service worker stores the time per tab and uses it for the next page load's report (valid for 60 s).
- **Why**: on GitHub, clicking "Compare & pull request" took over 1.5 s to load, and the load was recorded as an extra "Go to …" step. Covered by a unit test and an e2e test with a fixture page that answers after 2.5 s.

### D22. Short hyphenated build hashes at the end of class names are dropped
- **Spec**: Element targeting, record step 2 (ids and classes that look generated).
- **Change**: a class whose last segment, or last two short segments joined, is 2 to 8 alphanumeric characters mixing a digit and an upper-case letter is treated as generated, e.g. `prc-Button-ButtonBase-9n-Xk`, `prc-components-UnderlineItem-7fP-n`. Classes like `col-md-6`, `grid-cols-12` and `Button--secondary` are kept.
- **Why**: these classes from GitHub's CSS modules leaked into recorded CSS paths and change on every deploy.

### D23. Icon-only buttons and links are named by their icon
- **Spec**: Data model (`accessibleName` sources); Template step text (`{name}` fallback).
- **Change**: a button, link, tab, option or similar widget with no own text and no aria-label or label takes its accessible name from the first icon inside it that is not `aria-hidden`: `img[alt]`, an `aria-label`, or an `<svg><title>`. This matches how browsers compute the name from content.
- **Why**: GitHub's branch menu close button (an `svg` with a label inside a `button`) was recorded as "Click **the button**", with no strong signal for playback.

### D24. "Clickable" stays the spec's list for now
- **Spec**: Element targeting, record step 1.
- **Decision**: elements with `cursor: pointer` or `tabindex >= 0` are not treated as interactive yet. This was proposed, but both low-confidence steps in the GitHub recording were clicks on plain text (a commit row, a muted label), which this change would not have fixed. It also risks resolving clicks to large clickable containers. Revisit with evidence from pilot recordings; the owner can ask for it.

## 2026-11-04 — M3

### D25. Run state shape and frame-winner board
- **Spec**: Data model (`RunState`); Player, "Runs across pages"; Element targeting, playback step 8.
- **Change**: the stored run is the spec's `RunState` plus `stepToken` (new on every step change, so late reports from frames are ignored) and `cause` (why the step changed; the content script waits 300 ms only after an action). Per-step frame reports live next to the run in `match:<tabId>` and are cleared when the step changes or the top frame loads a new page. The top frame's report doubles as the "not found" signal: the not-found card shows when the top frame's 8-second search gave up and no frame found the target.
- **Why**: the spec defines who decides (the service worker, by frameId) but not the bookkeeping. Clearing on a new page fixes a bug found by the off-track test: a stale winner from the previous page hid the off-track card.

### D26. Two more content messages: `run.match` and `run.problem`
- **Spec**: Security (content scripts may send `rec.step`, `run.advance`, route reports and `guide.forPage`).
- **Change**: content scripts may also send `run.match` (a frame's best score and margin for the current step, as playback step 8 requires) and `run.problem` (Report broken step). `run.advance` carries an `op`: done, next, back, skip or exit, and is applied only if `stepId` is still the current step.
- **Why**: both are required by the spec's own flows; each is validated with Zod, and the service worker checks the tab's run and the current step.

### D27. Which frames receive the current step
- **Spec**: Security ("`guide.forPage` returns only guides whose `appOrigins` include `sender.origin`").
- **Change**: during a run, the service worker sends the current step (never the whole guide) to every frame of the tab, but only while the tab's top page is on one of the guide's `appOrigins`. Frames of other origins inside that page get it too, because a recorded step can target an element in a cross-origin iframe; content scripts render it only if they win the match.
- **Why**: requiring the frame's own origin would make steps in partner iframes unplayable. The data stays in isolated worlds unless the frame draws the tooltip.

### D28. Start page, Next button and keyboard shortcuts
- **Spec**: User flows, Play step 2; Player, Tooltip and Accessibility.
- **Change**: "on the start page" means the tab URL matches the first step's URL rule. Otherwise `run.start` answers `needs-start` and the panel shows **Open start page**, which navigates the tab to `startUrl`. The tooltip shows Next on note steps, input steps (the advance table allows Next) and steps whose `advance` is `next`; on the last step it reads Done. Shortcuts are `chrome.commands`: Next `Alt+Period`, Back `Alt+Comma`, Exit unassigned (Esc in the tooltip exits); all can be changed at chrome://extensions/shortcuts.

### D29. A new tab takes the run only on the guide's origins, 300 ms after it is created
- **Spec**: Player, "Runs across pages" (`openerTabId`).
- **Change**: the service worker waits 300 ms, then copies the run to the new tab and pauses the opener, but only if the new tab's URL is on one of the guide's `appOrigins`.
- **Why**: the click that opens the tab also reports "step done" from the opener; without the wait the run could move on the link step. Without the origin check, any tab opened from the app (a docs link, or a tab opened by test tooling) took the run away; the e2e suite caught this.

### D32. A lost "done" from a page that is leaving is caught up on the next page
- **Spec**: Player, "Advancing" and "Runs across pages".
- **Change**: when the top frame loads a new page and the current step is a click or submit whose page this is not, but the next step's page it is, the service worker marks the step done.
- **Why**: a click on a link sends "done" just as the page unloads. If the service worker is stopped at that moment, the message dies with the old page, and the learner landed on the next page with the run still on the link step (shown as off track). Found by the service-worker-restart acceptance test.

### D30. Service worker restarts in tests
- **Spec**: Milestones M3 ("A run survives a service worker stopped through `ServiceWorker.stopAllWorkers`").
- **Finding**: `ServiceWorker.stopAllWorkers` sent through a CDP session attached to an extension page stops the extension's worker (CDP reports running → stopping → stopped). Playwright's own worker list keeps a stale handle, so the test follows `ServiceWorker.workerVersionUpdated` instead and checks the worker was restarted.

### D31. Voice and mute are M4
- **Spec**: Player, Tooltip (mute toggle); Voiceover.
- **Change**: the tooltip has the mute toggle, but it only changes its own state until `chrome.tts` arrives in M4.

## 2026-11-04 — Recorder fixes from the independent M0–M2 review

### D33. A recording is never lost; start URLs keep no query or fragment
- **Spec**: Data model (`Guide.startUrl`); Privacy ("no page text beyond element labels"; the data-like filter covers URL segments); Sharing (import caps of 500 steps).
- **Change**: Stop validates and writes the guide inside the same queued task and clears the recording only after the write succeeds. A recording takes at most 500 steps (more are refused), and duplicate step ids are refused. `startUrl` is the origin plus the path up to its first key-like segment (`/orders/123/edit?email=…#token=…` becomes `/orders`), at most 1000 characters; `matchUrls` keeps the full pattern (`/orders/:id/edit`). While recording, each tab's last URL is kept with its query and fragment hashed.
- **Why**: a start URL over 2000 characters or a 501st step made the save throw after the recording had already been cleared, losing it. Raw start URLs put emails and tokens into storage and into exported packs.

### D34. Navigation start also comes from the new page's `performance.timeOrigin`
- **Spec**: Recorder, "Navigation" (refines D21).
- **Change**: the load report carries the new document's `performance.timeOrigin`. The service worker takes the earlier of it and the "leaving" mark, and a load belongs to the action when that time is within 1.5 s of the action either way (the service worker logs the action a few milliseconds after the click, so the navigation can appear to start first).
- **Why**: the "leaving" report can be lost while a page unloads; the time origin cannot.

### D35. Recorder: shadow-DOM selects and forms; re-clicking a typed field; what a page may send
- **Spec**: Recorder, "Event capture", "Merge rules", "Frames and shadow DOM"; Security.
- **Change**:
  - Native selects are recorded from the `input` event, which is composed and so also arrives from inside open shadow roots; `change` and `submit` are not composed, so the recorder also listens on every open shadow root it sees on an event path.
  - Clicking back into a field that was already typed into adds no step.
  - `rec.step` keeps only what the recorder produces: kinds click, input, select, check and submit; id, title, URL rule, target and flags. A page cannot inject notes, voice text, placement or "optional", and the advance mode is always `action`.
  - `rec.step` is refused from a frame whose origin is no longer granted. When site access is revoked, recording stops in those tabs and runs on those pages end.
  - Page titles are escaped before they go into navigate step titles, so `[Pay](https://x)` stays text.
