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
- **Superseded by R2** after merging PR #1: the browser-style accessible name there already takes descendant aria-labels, image `alt` and svg `<title>` for name-from-content roles. The D23 tests still pass on it.

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

## 2026-11-04 — Player fixes from the independent M3 review

### D36. Player robustness and privacy fixes
- **Spec**: Player and overlay; Element targeting, playback steps 6 and 8; Sharing ("Report broken step").
- **Changes**, each with a regression test that fails on the previous code:
  - **Frame reports are kept per frame, not per document.** A reloaded iframe replaces its own old report, so it can no longer tie with itself (nothing drawn) or leave a dead document as the winner (no tooltip and no card). Reports from documents that are not `active` (being unloaded or in the back/forward cache) are ignored.
  - **Run views are ordered.** The service worker reads the view inside its write queue, so views go out in the order of the changes, and each run carries a revision that content scripts use to drop an older view that arrives late.
  - **Shadow DOM.** Select, check and submit steps inside open shadow roots advance: `change` and `submit` are also watched on the target's shadow root, as the recorder already did (D35).
  - **Submit steps.** The "navigates away within 1.5 s" fallback counts only a cross-document navigation (`pagehide`, or a Navigation API `navigate` that is not same-document), not `pushState`, hash changes or a cancelled `beforeunload`.
  - **Cards.** The top frame's not-found or off-track card goes away when another frame finds the target, so two frames never draw at once. Cards and note tooltips mount inside an open modal `<dialog>`, where they stay clickable.
  - **Back** onto a navigate step whose page is already open no longer bounces forward.
  - **Route changes** re-run a search that already gave up (spec playback step 6). The previous match's advance listener is removed while searching again.
  - **New tabs** (refines D29): a new tab takes the run only if it opened on the page of the run's current step, not any same-origin tab. When that tab closes, the paused run in the opener resumes at the step the closed tab had reached.
  - **Problem reports** keep the origin and normalized path only, never the query or fragment (as for start URLs, D33).
  - **Start page**: when the guide's first page needs an id the stored start URL does not have (D33), the panel says which page to open instead of offering a button that would land the learner off track.
- **Also**: ESLint now forbids bare `origin`, `name`, `status`, `event`, `length` and `closed`, after a refactor briefly let the global `origin` stand in for a missing variable.

### D37. Known limitation: outside-click isolation
- **Spec**: Player, Overlay ("The host stops pointer, mouse and click events from reaching the app").
- **Finding**: the overlay host stops these events in the bubble phase. App listeners in the capture phase on `window` or `document`, and the browser's light dismiss of `popover="auto"` elements, still see clicks on the tooltip, so some app menus may close when the learner presses Next. Stopping them in the capture phase at `window` would also stop the event before it reaches the tooltip's own buttons inside the shadow root. Left as is for v1; revisit if pilots hit it.
## Review fixes (PR #1)

Behavior changes made for the verified review findings on PR #1. IDs are R-numbers so they never collide with the D-entries.

### R1. camelCase ids, test ids and names are kept (review L1)
- **Spec**: Element targeting, record step 2 (drop ids that look generated).
- **Change**: a token segment is only judged random by its case transitions when it does not read as camelCase words. The segment is split into words (`addToCart` → add, To, Cart; `getHTMLElement` → get, HTML, Element); it is kept when it has a word of 3+ letters and no two-letter chunk without a vowel. Every explicit pattern (`css-1x9f2k`, `sc-`, `jss12`, `:r0:`, `ember123`, UUIDs, long digit runs, hex) still applies first.
- **Why**: `addToCart`, `firstNameInput` and `deleteRowButton` have four case transitions, as many as a hash, so they were dropped as id, test id and `name`. Hash fragments split into short vowelless chunks (`bdVaJa` → bd, `xKq3Fz` → Kq), so they stay filtered.

### R2. Accessible names follow the browser for input buttons, images and `title` (review H1)
- **Spec**: Data model (`accessibleName`: "aria-label, aria-labelledby or `<label>` text"); extends D2.
- **Change**: after aria-labelledby, aria-label and `<label>` text, the name is: the `value` of `input` type button / submit / reset; `alt` (then `value`) of `input type=image`; `alt` of `img` / `area`; for name-from-content roles (button, link, menuitem, option, tab, checkbox, radio, switch, treeitem), the content name with image `alt`, descendant `aria-label`s and an svg's `<title>`; then `title` for every element; then `placeholder` for fields. A content name that is only the element's own text is not stored as the accessible name (it is the own-text signal already, and storing it twice would double its weight when text changes), so `title` never overrides visible text. The data-like filter still applies. Only `value` attributes of button-type inputs are read, never a typed field value.
- **Why**: icon links labelled by `title` or by an `<img alt>`, and Rails-style `<input type=submit value="Publish">`, had no name at all, so look-alikes were told apart by nothing and recording "Edit" spotlighted "Delete".

### R3. A link back to the current page has no link path
- **Spec**: Element targeting, playback step 3 (link path is a strong signal).
- **Change**: an `href` that is empty, a fragment (`#`, `#top`) or a query alone (`?page=2`) stores no `hrefPath`, and at playback such a candidate never matches a recorded link path.
- **Why**: its link path is the page's own path, shared by every such link on the page, so it made unrelated `href="#"` icon links strong look-alikes of each other. Hash-routed (`#/…`) links fall in the same bucket for now; a route-aware link path for hash-routing profiles can come later.

### R4. `name` is group-level on radios, checkboxes and buttons; radios and checkboxes store their `value`
- **Spec**: Data model (new optional `ElementFingerprint.value`); Element targeting, playback step 3 (`name` attribute is strong).
- **Change**: the `name` signal is not strong on `input` type radio / checkbox / submit / button / reset / image and on `<button>`, where a whole group shares it (`name="plan"`, `name="commit"`). Radios and checkboxes also store their `value` attribute (author-defined, not typed; dropped when data-like or generated); the `name` signal then requires both name and value to match and is strong again, because the pair says which option it is. Button-type inputs get their identity from their `value` through the accessible name (R2).
- **Why**: unlabeled radios Monthly / Yearly sharing `name="plan"`, and submit buttons sharing `name="commit"`, matched each other on a strong signal.

### R5. `instance: 'any'` only for groups that share an identifying signal
- **Spec**: Element targeting, record step 3 and playback step 5; refines D5.
- **Change**: at record time, more than one indistinguishable element sets `instance: 'any'` only when the fingerprint has an element-identifying signal: text, role plus accessible name, test id (or `data-guide-id`) or id. Otherwise it stays `unique` (with `matchCount` above 1), so playback applies the unique margin and returns ambiguous. At playback, the tied group of an `any` fingerprint must also share one of those signals; if the best candidate matched none of them, the unique rules apply instead. This covers crafted or older fingerprints too.
- **Why**: a shared `name` or link path is group-level. A group held together only by those (a radio group, nameless icon links to the same page) is not a set of interchangeable elements, and spotlighting its first member, or advancing on a click on any member, was a wrong match. Cost: when the text of repeated row links changes (mutation set B), they are now not-found instead of matched on their shared link path.

### R6. Every root a shadow path matches is searched (review H2)
- **Spec**: Element targeting, playback steps 1, 2 and 6; Data model (`shadowPath`).
- **Change**: each shadow path step resolves to every host it matches (`querySelectorAll`) in every root of the level above, and candidates from all the resulting shadow roots are scored together. The fast path counts test id / `data-guide-id` matches across every searched root (the twins, or the document plus every open shadow root when the path broke) and takes only a single match overall. Shadow path steps are now the host's CSS path even when other hosts match it too (XPath only if the CSS path does not select the host), so twins present at record time are counted like light DOM twins: `instance: 'any'` when they share an identifying signal (R5), ambiguous otherwise. The wait loop observes every shadow root on the path, at every level. Ties across shadow roots sort in composed-tree order (by host position). Iframe selectors (`framePath`) are unchanged and still unique.
- **Why**: the path resolved with `querySelector` to the first matching host, so an identical widget inserted before the recorded one was the only root searched and its button scored 100, where the light DOM equivalent is ambiguous. With a broken path and the same test id in two widgets, the fast path took the first root that had exactly one match.

### R7. A visually hidden form control is found and shown through its visible label (review M6)
- **Spec**: Element targeting, record step 1 ("a `<label>` resolves to its control") and playback steps 3 and 5 ("visible" candidates, spotlight).
- **Change**: the target stays the control (it carries the name, value and label signals), but a form control that is not visible counts as visible when one of its `<label>`s is, and that label is its display box: the recorded `rect`, the "position near the recorded spot" signal and the fast path all use it. A match result has a new `spotlight` element, the box the overlay outlines: the element itself, or that label. `element` and `tied` stay the controls, so advancing still listens for clicks on them; a click on the label reaches the control through the label's activation behavior (it toggles the checkbox). A control whose labels are hidden too is still not visible.
- **Why**: custom checkboxes and switches hide the native input (`opacity: 0` at 0x0, or `display: none`) and style the label. The visibility filter dropped the input, so such a step returned no-candidates even on the unchanged page.

## 2026-11-04 — M4

### D38. Editor and voice messages
- **Spec**: Security (content allowlist); User flows, Edit; Voiceover.
- **Change**: content scripts may also send `run.mute` (the tooltip's mute toggle, which sets the global voice setting) and `pick.result` (Re-pick element). `pick.result` is accepted only while the side panel has asked that tab for a pick (within 2 minutes), and its fingerprint is validated with the Zod schema. Extension pages get `guide.get`, `guide.save`, `step.test`, `pick.start`, `pick.cancel`, `voice.list`, `voice.test` and `voice.settings.get/set`. The service worker answers Test step by asking the frame on the step's recorded `framePath` (found through the frame map) to match and briefly spotlight the element.
- **Save**: the editor sends the whole draft; the service worker keeps the id, refuses library guides (read-only), adds 1 to `version`, gives a new `revisionId` and `updatedAt`, validates with the schema and writes guide and index in one queued task. Stop opens the editor for the new guide.
- **Fragile steps**: Test step shows which signals matched, and calls the match fragile when only one strong signal matched (Element targeting, "Per-site profiles").

### D39. Voice: who speaks, when, and with which voice
- **Spec**: Voiceover; Player, "Runs across pages" (one voice channel: only the focused tab speaks).
- **Change**: the service worker speaks the current step's stored `voiceText` (or, if empty, the plain-text title plus note) once, when the step becomes current: at Start and after each advance, Back or Skip. Re-broadcasts, frame reports and service worker restarts never speak again. Every step change, Exit, Stop and mute first calls `chrome.tts.stop`. "Focused tab" means the active tab of the last-focused normal browser window, because `windows.focused` is unreliable without a window manager and the side panel shares the window. The voice is the user's choice for the guide's language, else the first on-device voice for it; with no usable on-device voice Waymark stays silent rather than use a remote voice. Where `chrome.tts` is missing, the top frame speaks with `speechSynthesis` using an on-device (`localService`) voice only.
- **Settings** (options page, `voiceSettings` in local storage): auto-play, speed 0.5×–2×, a voice per language, Allow online voices (off by default, with a note that online voices send the text to the provider), and Test voice with a fixed sample sentence.

### D40. One overlay owner at a time
- **Spec**: Player and overlay.
- **Change**: the player, the Test step highlight and the picker share the overlay host; when one draws, the previous one is cleared.
- **Why**: found by the re-pick acceptance test: a Test step highlight (shown for 4 s) and the run that started right after both drew a spotlight.

### D41. Editor and voice fixes from the independent M4 review
- **Spec**: User flows, Edit; Voiceover; Security ("content scripts get only data for their own origin"; "the service worker speaks only the stored voiceText").
- **Changes**, each covered by an e2e test:
  - **Speech once per step, on every path.** The run stores the step token it last read (`spokenToken`). Every path that changes the step (advance, Start, the first page after **Open start page**, a catch-up on page load (D32), a run moving to a new tab or resuming) asks to read the step, and the token keeps it to once per step, even across service worker restarts. Closing the tab, revoking the site and ending the run stop speech. Mute is global, so every tab with a run shows it. The fallback tab for `speechSynthesis` is kept in session storage, not in service worker memory, and the fallback waits once for the voice list to load.
  - **Test step and Re-pick only on the guide's site.** Both require the tab to show a page on one of the guide's `appOrigins`, so a step is never sent to another site's page. A re-picked step also takes the URL rule of the page it was picked on, and drops the recorder's warning flags.
  - **Picks always end.** Esc in any frame, or a click that resolves to nothing, cancels the pick in every frame and in the panel (`pick.abort`, a new content message). So do a new page in the tab, the panel's **Cancel picking** button, closing the editor, switching tabs, and the 2-minute limit. Starting a pick on a page where Waymark is not running is an error, not a silent wait.
  - **Save never overwrites a newer copy.** `guide.save` carries the revision the draft was loaded from and is refused if the stored guide changed since (for example, from a side panel in another window). Save is disabled while saving, and edits typed during a save are kept. A step with an empty title is caught before saving, with a clear message.
  - **Overlay hand-back** (refines D40): when a Test step highlight releases the overlay, the player draws its current step again.
- **Not changed**: the picker builds fingerprints without a site profile, as the recorder does, because site profiles are not wired yet (they arrive with the options for M5).

## 2026-11-04 — M5 (and the M6 parts needed for testing)

### D42. Discovery and sharing details
- **Spec**: Discovery and hints; Sharing and storage; Security.
- **Changes and clarifications**:
  - **Badge** (toolbar): the count of guides whose `appOrigins` include the tab's origin and whose `matchUrls` match its path. It is updated from `tabs.onUpdated` (the URL is readable on granted sites), from every top-frame route report (so in-app route changes count), and after guides change. REC takes precedence; when recording stops the count returns. Counts above 99 show "99+". The guide index now also stores `matchUrls` and `source`, and is rebuilt from the stored guides at install.
  - **Side panel**: "For this page" first, then all guides; MiniSearch over title, description, tags and step titles, with prefix and light fuzzy matching. Guides stay listed (search, import, Allow) on tabs where the site is not granted yet.
  - **Launcher and deep links** add two content messages: `launcher.start` and `deeplink.check`. Both answer only for guides whose `appOrigins` include the sender's origin, and only to the top frame; `guide.forPage` now returns ids and titles only, plus whether the launcher is on for that origin. The launcher setting is per origin (`siteSettings`). A deep link id must look like an id (letters, digits, `-`, `_`), and only the `waymark=…` segment is removed from the query or hash, leaving the rest exactly as it was (found by the e2e test: `URLSearchParams` re-encoded `?static` as `?static=`).
  - **Export review** lists every string the pack contains: guide title, description, tags, start URL, and per step its title, page rule, note, voice text, element labels (accessible name, own text, placeholder, `name`, `value`, `id`, landmark labels) and link path. Notes, voice text, tags, the description and element labels can be removed from the exported copy only; titles and pages are changed in the editor.
  - **Import**: the panel reads the file (5 MB cap), the service worker parses and validates it again (it never trusts the panel's copy), shows conflicts (same id, different `revisionId`) with keep / replace / keep both, and writes all guides in one queued write. Imported guides are local. An imported copy of a guide that exists as a library guide is kept as a separate local copy with `forkedFrom`.
  - **Library**: `https://` URLs only (plain `http://` only for localhost, for testing). The options page first tries to read the file (works when the host sends CORS headers) and requests the library's site as a permission otherwise. Refresh at subscribe, at startup and on a `chrome.alarms` alarm every 360 minutes. A refresh replaces the library guides (new revisions win, guides dropped from the pack are removed) but never overwrites a local guide with the same id. Unsubscribing removes the library guides. A failed refresh keeps the current guides and shows the error in the options page.
  - **First-run access**: after an import or a library refresh, the sites in the guides' `appOrigins` that are not granted are kept in `pendingAllow`; the panel shows one banner with one **Allow** button, which makes a single `chrome.permissions.request` for all of them (it needs the click).

### D43. Popup fallback, version, downloadable builds
- **Spec**: Distribution and cost, "Browser differences"; Milestones M6.
- **Change**: when `chrome.sidePanel` is missing, the service worker sets the action popup to the panel at runtime (`setupPanelFallback`); the popup's **Edit** and Stop-then-edit open the editor in a full-page tab (`sidepanel.html?edit=<id>&tab=<id>`). Recording relies on the on-page pill, which already shows the last step. The `?tab=` parameter is no longer test-only, because the full-page editor needs it; only extension pages can open that URL. Version 0.2.0. CI packages the production build (`pnpm zip`) and uploads it as the `waymark-extension` artifact of every run.

### D44. Fixes from the independent M5 review
- **Spec**: Sharing (packs are untrusted; export review); Permissions (one site at a time, no `<all_urls>`); Discovery.
- **Changes**, each with a regression test:
  - **Origins are validated.** A guide's `appOrigins` must be real http(s) origins exactly as `new URL(o).origin` writes them, with no wildcard, and at least one. A pack claiming `https://*` is rejected, so it can never reach the one-click Allow request or the content script registration. Pending-allow checks also never throw on a bad entry.
  - **The export review shows everything identifying, and removal is complete.** The review now also lists sites, page rules (`matchUrls`), the test id and `data-guide-id`, the CSS path (which embeds ids, names and ancestor labels), the XPath, and shadow and frame paths. Test id, guide id and CSS path can be removed (the CSS path falls back to the tag). With everything removable removed, no element id, test id, landmark label, note or own text is left in the file.
  - **Library refresh races**: a refresh writes only if the subscription URL is still the one it fetched, so unsubscribing or changing the URL during a slow fetch wins.
  - **Deep links**: malformed percent-encoding is ignored and can no longer stop the content script.
  - **Badge**: removing site access clears the badge (tabs whose URL can no longer be read get no count), and REC is re-checked just before a count is written.
  - **Library subscribe**: the URL is validated before any permission request, and the CORS probe is limited to 1.5 s so the click still counts as a user gesture for the request.
  - **Allow banner**: "Not now" is remembered per site, so library refreshes do not bring the banner back. Re-importing a pack that contains a library guide no longer adds another local copy each time.
- **Also for testing** (docs/TESTING.md): **Copy link** per guide (a deep link to its start page), and a **Problems** list in Settings with Copy and Clear for "Report broken step".

### D45. A frame re-sends its match result when the service worker has no winner
- **Spec**: Element targeting, playback step 8.
- **Finding** (CI only, a timing race): with **Open start page**, the new page could find the element and report it before the service worker handled that page's own load report, which clears the frame board (D25). The report was lost and the page stayed "searching". **Change**: whenever a frame receives a view for its current step with no winner and its own search has finished, it sends its result again. The board broadcasts only on a change, so a repeat report cannot loop.
- **CI**: `upload-artifact` skips hidden folders such as `.output`, so the zip is copied to `artifacts/` before upload.

## 2026-11-04 — Voice quality (issue #4, part 1)

### D46. The best voice is picked automatically
- **Spec**: Voiceover and AI text, "Voiceover" (voice picker).
- **Change**: with no voice chosen, Waymark used the first on-device voice for the guide's language, which is usually the oldest, most robotic OS voice. It now ranks the usable voices (`rankVoices` in `src/core/voice/voice.ts`): names containing Natural, Neural, Enhanced or Premium first; then on-device over remote; then the guide's region (or the browser's, when the guide's `lang` has none); then the order the browser lists them in, which usually puts the OS default first (not verified on every OS). `chrome.tts` has no "default voice" flag, so the list order is the closest signal. A voice the user picked still wins. Names match as whole words or inside CamelCase ("en-US-AriaNeural"). Region subtags skip script subtags (`zh-Hant-TW`). A voice without a `lang` is not used for any guide, in the service worker and in Settings alike. An English guide in a browser with another UI language has no region to prefer and falls back to list order; accepted.
- **Online voices**: Edge's "… Online (Natural)" voices stay hidden until **Allow online voices** is on (they send the text to Microsoft). Once it is on, remote natural voices rank first, as the owner asked in issue #4; plain remote voices such as "Google US English" still rank after every on-device voice.
- **Settings**: shows the voice in use (and whether it is on this device or online) and a "Get better voices" help text with steps for the user's OS (`chrome.runtime.getPlatformInfo`). Version 0.2.1.
- **Fallback**: the `speechSynthesis` fallback (no `chrome.tts`) uses the same ranking over on-device voices. It cannot honor the user's choice, because settings never reach content scripts.
- **Unverified on real machines**: whether Chrome and Edge show macOS "(Premium)"/"(Enhanced)" in voice names, and the exact ChromeOS menu path. On Windows, the natural voices added for Narrator are Narrator-only, so the Windows help says so and points to Edge's online natural voices. Speech-dispatcher modules on Linux (RHVoice, Piper) have no telling names, so Settings may still call them basic.
- **Review fixes** (independent review, each with a regression test that fails on the first version): voices without `lang`, CamelCase names, script subtags, a saved online voice with online voices off, and a stale saved voice no longer blanking the picker.

## 2026-11-04 — Tester feedback (issue #6)

### D47. Steps that could never play are not recorded
- **Spec**: Recorder, "Capture rules" (non-interactive clicks are kept, flagged low-confidence; closed shadow hosts are recorded and flagged), and Element targeting, playback step 4 (a strong signal is required).
- **Finding**: a click whose target has no strong signal (no test id, id, role + name, own text, name or link) was recorded with only a ⚠ flag. Playback step 4 then rejects every candidate, so the step always ended on "can't find this step", on screen or not. Cases: plain text over 80 characters or data-like (its text is dropped, D22/R1), and a closed-shadow host with no id or label.
- **Change** (the owner chose "skip" over "record and warn": if a step can fail, people will hit it):
  - the recorder does not emit such a step; the REC pill shows "Not recorded: Waymark could not find this again. Click a button, link or field." for 4 s;
  - **Re-pick element** refuses such a target and keeps picking, with the same reason in the banner;
  - the wait loop reports such a target as not-found at once instead of after 8 s (guides recorded before 0.2.2, or imported).
- Low-confidence and closed-shadow steps that do have a strong signal (short plain text; a host with an id, a test id, or a role plus a label) are still recorded and flagged. An `aria-label` alone is not enough: role + name needs a role, as in the matcher. The matcher is unchanged. Version 0.2.2.
- **Merge rules** (independent review): a skipped step still counts as the last action, so typing into an unfindable field reports one skip, not one per key, and a skip never merges with a later submit. With Enter in a field whose form's default button has nothing to find it by (an icon-only button), the submit step targets the field instead of being lost.
- **Limits**: the pill and the pick banner live in the top frame. A click skipped inside an iframe is not announced on the page (the step is still left out), and a refused Re-pick inside an iframe shows no reason (picking goes on; Esc cancels).

## 2026-11-04 — Security and privacy audit

### D48. Fixes from the security audit (threat model in docs/SECURITY.md)
- **Spec**: Permissions, privacy and security; Sharing and storage ("Import rules", library URL); Discovery ("First-run access"); Data model.
- **Method**: a written threat model, an audit of the code, and an independent review by a subagent that saw only the code and the threat model. Each fix has a regression test that fails on the previous code.
- **Medium**:
  - **Frame nonces could fill session storage.** Every `hello` from an iframe stored a `nonce:<uuid>` key that was never swept, so a page posting `hello` in a loop could fill `chrome.storage.session` (10 MB) and break runs and recordings in every tab. Pending nonces now live in one table per tab (`nonces:<tabId>`). The table is written inside the write queue, expired nonces are dropped, at most 32 stay pending, and it is removed with the tab. A nonce is looked up only in the claiming tab's table, so a foreign tab can no longer burn it. Content scripts ignore hellos from the same iframe less than 250 ms apart. The frame map keeps at most 64 frames per tab, and the oldest go first.
  - **The library fetch was unbounded.** The whole answer was read before the 5 MB check, with no timeout. Now a declared `Content-Length` over 5 MB is refused, the body is read in chunks and abandoned past 5 MB, the fetch gives up after 30 s, and a redirect must land on an allowed URL (https, or http on localhost).
  - **One Allow click for sites nobody saw.** A pack or library could queue any number of sites, and the banner showed only a count. Now every site is listed by name with a checkbox (ticked by default; unticked ones count as "Not now"), at most 50 sites are queued, and the import dialog lists the pack's sites. This is still the spec's single request, now with every site shown.
- **Low**:
  - Guide, revision, forked-from and step ids must be letters, digits, `-` and `_` (max 64; not `__proto__`). This is the deep link rule, and Waymark's own ULIDs already follow it. A pack guide's `startUrl` must be http(s) on one of its `appOrigins`; before, "Copy link" could point at any URL. `exportedAt` and `startedAt` are length-capped.
  - On a site that is not one of the guide's, content scripts get a run view without the guide id, title, sites or step token, and the step is not spoken (nor sent to the `speechSynthesis` fallback) there.
  - Titles from content scripts (`rec.step`, `pick.result`) with a live markdown link become escaped plain text. Recorder titles escape every label, so such a link can only come from a forged message.
  - Navigate steps stop at the 500-step limit and recording sites at 50, so a page cannot make a recording unsaveable.
  - The per-site launcher setting accepts only real site origins.
  - Only a trusted Escape cancels Re-pick.
  - Test dependency happy-dom 21.0.4 (two advisories that affect only unit tests).
- **Deferred** (reported to the coordinating session):
  - Element ids, test ids, `name` and `data-guide-id` skip the data-like filter, so `data-testid="row-jane@acme.com"` is stored. This is a matcher change and must keep the robustness suite at zero wrong matches.
  - Frame and shadow paths can't be removed in the export review, because the guide needs them to find frames. `rect` and the viewport size are not listed.
  - The minimatch advisory, which comes in through typescript-eslint and only affects lint. Fixing it needs a major-version override.
  - Entry caps on records that only extension pages can send.
- Version 0.2.3.

## 2026-11-04 — Performance and code health

### D49. The side panel, badges and imports work from the guide index
- **Spec**: Data model, "Storage" (one key per guide plus an index); Discovery (badge, side panel search); Sharing (import rules).
- **Measured** with `pnpm bench` (new: `test/perf/`, 500 guides of 50 steps, about 22 MB of guides; in-memory storage that copies like `chrome.storage`; not part of `pnpm check`, because timings on shared runners are noisy):

  | Path | Before | After |
  | --- | --- | --- |
  | Side panel load (`guide.all` → `guide.list`) | 535 ms and a 22 MB message | 3 ms, 1.3 MB |
  | Badges for 30 tabs after a change | 96 ms | 22 ms |
  | Pack check / import / library refresh vs. stored guides | read and validate all 22 MB | index only |
  | "For this page", one badge, `guide.forPage` | 1 to 3 ms | 1 to 4 ms |

- **Change**:
  - Each index entry also keeps the revision id, `forkedFrom`, the start URL, and for search the description (first 1,000 characters), up to 20 tags, and the step titles as plain text (80 characters per step, 20,000 per guide, so a 200-step guide stays searchable to its last step). The side panel lists, searches and matches pages from the index. An editor save with 500 guides takes about 8 ms (index included).
  - The panel fetches full guides only for export, with the new `guide.many` (ids → validated guides; up to 1,000). `guide.all` is removed.
  - The import rules (`findConflicts`, `planImport`) take index entries.
  - A badge pass reads the index once (not once per tab) and the recording state once, just before writing, so REC still wins. A failed pass never fails the write that triggered it.
  - An index written by an older version (no `revisionId`) is rebuilt from the stored guides on its first read, so a missed install-time rebuild can't produce false import conflicts or duplicate forks.
  - Export fetches the selected guides in library order. Copy link on a guide without a usable start URL says so instead of failing silently.
- **Review** (independent, no High or Medium findings): the six Lows are fixed as above, each with a unit test (`index-reads.test.ts`: reads, rebuild, caps, badge counts and REC).
- **Errors**: a request that fails schema validation now answers with one sentence ("Waymark could not use this data (steps.3.title is not valid)."), not Zod's JSON issue list. When the service worker gives no reply, the panel says "Waymark did not answer". Dead code removed: `saveGuide`.
- **Bundle** (production build, minified; gzip in brackets): content script 165 KB (52 KB), service worker 141 KB (41 KB), shared panel chunk 118 KB (36 KB), side panel 45 KB (14 KB). Zod reaches the content script only through `core/voice/voice.ts` (`VoiceSettingsSchema` is defined at the top level next to `bestSpeechVoice`). That file belongs to the voice work, so moving the schema is left to it.

### D50. Flake hunt: one e2e race under CPU load
- **Spec**: Tech stack, testing.
- **Method**: on main at 0.2.3 (local), 5 full e2e runs, 3 unit and 3 browser runs on an idle machine. Then the full e2e suite with all but one core busy, to imitate a slow CI runner (the races in D45 and M4 only showed on CI).
- **Before**:
  - Idle: e2e 165/165 (5 runs), unit 585/585, browser 240/240.
  - Under load: 65/66. In one of two runs, "an author fixes a wrong match by re-picking" timed out after 60 s.
- **Cause**: the `msg()` helper in the m4 and m5 specs opens an extension page in a popup window from the service worker and waited for its `load` state. Playwright can attach to such a window after its `load` event, and then the wait never returns (the trace showed `networkidle` but no `load`). The test only fails when the attach is slow, so 12 isolated repeats under load did not reproduce it.
- **Fix**: one shared `ExtensionHelper.message()` in `test/e2e/fixtures.ts` polls the page until it is the extension page and `document.readyState` is `complete`. No retries, skips or longer timeouts.
- **After**: under load 99/99 (3 runs). CI keeps `retries: 1`. Its logs show no test marked flaky in the runs checked.

## 2026-11-05 — HD voice (issue #4, part 2)

### D51. Optional on-device HD voice: Kokoro-82M, without GPL code
- **Spec**: Voiceover and AI text; Permissions, privacy and security; Distribution and cost.
- **Change**: a new opt-in **HD voice** in Settings. It is the Kokoro-82M neural voice (Apache-2.0), run by transformers.js and onnxruntime-web (WebAssembly) in an offscreen document. Before, voices came only from the browser.
- **Why Kokoro**: a spike in Chromium compared Kokoro and Piper ([results on #4](https://github.com/ThomasDevJS/Waymark/issues/4#issuecomment-6645098454)).
  - Kokoro sounds far more natural. Its weights and voices are Apache-2.0.
  - Piper is about 7× faster, but its good English voices are often non-commercial.
- **License decision (provisional; Thomas may reverse it)**: both engines phonemize with eSpeak NG, which is GPL-3.0. That includes the npm `phonemizer` package that kokoro-js uses. To ship no GPL code, Waymark has its own English G2P (`src/core/voice/g2p/`). It reads words from the misaki lexicon (Apache-2.0; the dictionaries Kokoro was trained with), downloaded as data with the model. For unknown words it tries, in order:
  1. word forms (-s, -es, -ed, -ing);
  2. CamelCase and two-word compounds ("dropdown", "Gmail", "QuickBooks");
  3. spelled acronyms ("CSV", "PDFs");
  4. numbers, money, times, emails and web addresses as words;
  5. rough letter-to-sound rules ("Jira", "Okta").

  The phonemizer sits behind one function type (`Phonemizer` in `src/offscreen/kokoro.ts`), so a GPL engine could be swapped in if Thomas accepts GPL-3. Consequence: the HD voice is English only. Other languages keep the system voice.
- **Model size**: fp16 (163 MB), not q8 (92 MB). On the spike machine (4 vCPU, no GPU), q8 ran at about 1.9× real time with 4 threads, over the 1.5× limit. fp16 ran at about 0.8–0.95×. Listening samples of both are in the PR.
- **Download**:
  - The opt-in click requests `https://huggingface.co/*` and `https://raw.githubusercontent.com/*`. Both serve CORS, but the permission makes the consent explicit and keeps the download working if that changes.
  - The offscreen document fetches seven files at pinned revisions: Kokoro `1939ad2a…`, misaki `fba12365…`. It checks each file's size and SHA-256 and stores them in Cache Storage (`waymark-hd-v1`).
  - When the download ends (ready, too slow or failed), the service worker removes the host permissions it added. A host the user had already granted is left alone.
  - `grantedSitePatterns` never treats these two hosts as guide sites, so the content script is not registered there, even during the download. The cost: guides can't run on huggingface.co or raw.githubusercontent.com.
- **Loading**: transformers.js reads only Cache Storage. Remote models are off, and its local path doesn't exist, so a missing file fails instead of fetching. ORT's `.wasm` ships in the extension (`/ort/`) and `wasmPaths` points there. The `onnxruntime-web` import is aliased to its WebAssembly-only bundle (no WebGPU), which adds about 11 MB unpacked (about 3 MB zipped).
- **Manifest**:
  - `extension_pages` CSP is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`; without it, compiling the WebAssembly fails. The manifest guard now requires exactly this CSP.
  - COEP `require-corp` and COOP `same-origin` make extension pages cross-origin isolated, so ORT can use up to 4 threads; one thread was about 3× slower than real time. The full e2e suite (side panel, options, library subscribe and refresh) passes with them.
  - New permission `offscreen`, which shows no install warning. Still no `host_permissions` and no `content_scripts`.
- **Offscreen document**: reasons `AUDIO_PLAYBACK` and `WORKERS`. It closes 3 minutes after the last HD speech or the speed check (see the review fixes below). With `AUDIO_PLAYBACK` alone, Chrome closes the document 30 s after audio stops, which killed long generations in the spike. The service worker creates it on demand and closes it after 3 idle minutes (`hd-idle` alarm), because the model takes about 800 MB. The document acts only on messages from the service worker, by sender URL, with a Zod schema. Content scripts can send runtime messages that extension pages receive, so this check matters.
- **Playback**:
  - Each step sends its text plus the next step's text, which is generated while the current one plays. The player keeps 4 clips and runs one inference at a time.
  - A step waits at most `HD_WAIT_MS` (4 s) for HD audio. After that, or on any engine error, it sends a cancel and the system voice reads the step.
  - Speak and stop carry a timestamp, so a stop sent before a speak but delivered after it cannot cancel the new step.
  - After the download, one sample sentence measures speed. If it takes more than 1.5× real time, the status is "too slow" and the system voice is used.
  - fp16 inference can output NaN samples, which play as silence.
- **Remove HD voice** deletes the cache, closes the document and releases any hosts still held. **Cancel** during a download does the same. A download whose document disappeared (browser closed) shows as failed, with **Try again**.
- **Tests**:
  - unit: the G2P, numbers and letter rules; the player (cache, prefetch, one inference at a time, cancellation, stale stops, speed check); the service worker (HD vs system voice, timeout and failure fallback, host release, remove); the offscreen sender check.
  - e2e: a stub engine, only in test builds, so CI never downloads the model.
- **Licenses**: `THIRD_PARTY_NOTICES.md` (also shipped in the extension) covers everything bundled or downloaded. Version 0.3.0.
- **Fixes from the independent review** (each with a regression test that fails on the first version):
  - **Fallback races.** A replaced HD speak (`cancelled`) now says nothing. A failed one falls back to the system voice only while it is still the newest speech (`speechAt` in session storage) and the learner hasn't muted. Before, a slow step 1 could be read aloud after the learner moved to step 2, or after Mute or Exit. The cancel a failed speak sends carries that speak's own time, so it can't cut off a newer step.
  - **Memory.** When the speed check ends, a "ready" result arms the 3-minute idle close. "Too slow" or a failure closes the document at once. Before, the ~800 MB model stayed loaded.
  - **Host release.** The hosts to release live in `storage.local`, so a browser restart in the middle of a download no longer leaves them granted. The document is created before the status says "downloading", so Settings can't mistake a starting download for a lost one. Only one download runs at a time.
  - **Speed check.** One untimed warm-up inference runs first. "Too slow" offers **Check again**, which reuses the cached files.
  - **G2P.** Numbers it can't parse ("10:30:45", "1.2.3") are read digit by digit instead of dropped. Accented letters are read as their base letters. Huge ordinals no longer throw. Text with no readable words gives "no audio", so the system voice reads it instead of silence.
  - **Content script size.** `VoiceSettingsSchema` moved from `core/voice/voice.ts` to `core/voice/settings.ts`. The content script imports `bestSpeechVoice` from voice.ts, which pulled Zod into every frame. Content script: 165,232 → 76,169 bytes (51.9 → 26.8 KB gzipped).
  - **No CDN in the bundle.** At build time, transformers.js's default CDN path for the WebAssembly is replaced with `/ort/`. A new guard (`scripts/check-no-cdn.mjs`, part of `pnpm check`) fails the build if any script names a code CDN. The unused `hd.prefetch` message is removed.

## 2026-11-05 — CI speed

### D52. CI: fast checks and two e2e shards in parallel; cached Playwright browser
- **Spec**: Tech stack, testing; Distribution (CI artifact).
- **Before**: one job, about 4.5 minutes on a good day: setup and install 15 s, checks and builds 30 s, browser install 18 s (6 minutes once, when apt was slow), unit and browser tests 20 s, e2e 3.5 minutes.
- **Change**:
  - The **check** job runs typecheck, lint, both builds, the manifest guard, the zip artifact, and the unit and browser tests.
  - Two **e2e** jobs each build the test extension and run half of the suite (`--shard=N/2`), in parallel with the check job. A failing shard uploads its own `test-results-N`.
  - The Playwright browser is cached per Playwright version (`.github/actions/playwright-browser`); on a cache hit only its system packages are installed. The pnpm store was already cached by `setup-node`.
- **Test-level sharding**: `fullyParallel: true` with one worker, so tests still run one at a time in file order, locally and in CI. Each shard was run on its own locally: shard 1 had 17 tests in 83 s, shard 2 had 16 in 115 s, both green. So no test depends on one that runs before it in another shard.
- **Review** (independent; nothing blocking):
  - The cache key now covers both `@playwright/test` and `playwright` (Vitest), and a failed version lookup fails the step instead of writing an empty key.
  - In CI, the e2e fixtures throw when there is no display, so a shard can never pass with every test skipped.
  - `apt-get update` runs before the Xvfb install again.
  - Moving the actions to their Node 24 majors is left for a separate change; it was already pending on main.
- **Measured on GitHub** (first run, cold browser cache): 2 min 39 s, down from about 4.5 minutes. The check job took 1 min 20 s. Shard 1 took 2 min 30 s (tests 1 min 46 s) and shard 2 took 2 min 35 s (tests 2 min 1 s). The browser step took 20–25 s cold.

## 2026-11-05 — Code health

### D53. Records sent by extension pages have entry limits
- **Spec**: Permissions, privacy and security ("validate everything"); deferred Low from the security audit (D48).
- **Change**: Zod records have no size limit of their own, so `pack.import` choices are capped at 10,000 entries and `voice.settings.set` voices at 200. The side panel sends only the conflicts the user changed (a missing choice means keep), so even a re-import of more than 10,000 conflicting guides stays far below the cap. The voices map has one entry per language. Only extension pages can send these messages, so this is hygiene, not a fix for an exploitable bug.
- **Version** 0.3.1.

## 2026-11-05 — Release engineering

### D54. CI minute budget: one run per change, cancel superseded runs, skip docs-only changes
- **Spec**: Tech stack, testing; Distribution (CI artifact). Hard rule: $0 running cost.
- **Why**: the repo is private on the Free plan, which includes 2,000 Actions minutes a month. Every branch push ran CI twice (`push` and `pull_request`). GitHub bills each job rounded up to the whole minute, so a run of the three D52 jobs (check about 1.5 min, e2e shards about 2.5 min each, more when apt is slow) bills about 8 minutes, not the 6.5 job-minutes it uses.
- **Change** (`.github/workflows/ci.yml`):
  - Triggers: `push` to `main` only, `pull_request`, and `workflow_dispatch`. A branch without a pull request runs no CI; run the workflow by hand to test one.
  - `concurrency` per pull request (or ref). On pull requests a newer push cancels the run it supersedes. On `main` runs queue instead of cancelling (a small deviation from "cancel superseded runs for the same ref"): two quick merges would otherwise leave the first merge commit without a zip and with a red mark from the cancelled run.
  - Docs-only changes (any `*.md`, anything under `docs/`) skip the check and e2e jobs. `THIRD_PARTY_NOTICES.md` is not docs-only: it is copied into the build.
    - On `main`, a trigger-level filter skips the run entirely. It is a `paths` list with negations rather than `paths-ignore`, because `paths-ignore` can't make the `THIRD_PARTY_NOTICES.md` exception.
    - On pull requests a trigger-level filter would leave required checks "pending" forever. Instead a small `changes` job lists the PR's files with the API (`scripts/ci-changes.mjs`, unit-tested; renames count both names; any error means "run everything"), and the check and e2e jobs are skipped only on its explicit "docs-only" answer; a crash or a missing answer runs everything. A skipped job counts as passed for a required check. The files API compares the whole PR with its base, so a docs-only push to a PR that already changes code still runs the full CI.
    - A `CI result` job needs all the others and starts only when one of them ended `failure` or `cancelled` (a timeout, for instance), and then fails. Make it the one required check if branch protection is turned on: a skipped matrix job does not report under its shard names (`e2e (1)`, `e2e (2)`), so those can't be required. When everything passes it is skipped and costs nothing.
  - The extension zip is uploaded on `main` pushes and manual runs only, kept 14 days (was every run, 30 days). The zip is 3 MB and the Free plan has 500 MB of artifact storage; at tonight's rate (85 runs in 6 hours) 30-day artifacts of every run would have filled it in two days, and uploads then fail. Tagged GitHub Releases (a separate change) give stable downloads that don't count against it.
- **Estimated billed minutes** (8 per full run, 1 for the `changes` job):

  | | Before | After |
  | --- | --- | --- |
  | Push to a branch with no PR yet | 8 | 0 |
  | Push to a PR branch | 16 (two runs) | 9 (one run plus `changes`); a superseded run stops at its cancel, about 1–3 |
  | Push to a docs-only PR | 16 | 1 |
  | Merge to `main` | 8 | 8 (0 if docs-only) |
  | A PR with 3 code pushes, then merged | 56 | 35 |

  Tonight so far (19:31–01:28 UTC) was 85 runs: 53 branch pushes, 21 pull request runs and 11 main pushes, about 680 billed minutes. With these rules the same work would have run 32 times, about 280 minutes. So the monthly budget covers about seven nights like tonight, against fewer than three before.
- **Limits**: GitHub's `paths` filter looks at the first 300 files of a push only, so a huge docs-first push to `main` could skip CI; pull requests always go through the `changes` job. The `changes` job runs the PR's own copy of `scripts/ci-changes.mjs`, so a PR could declare itself docs-only, but a PR can already edit the workflow, and the token is read-only.
- **Review** (independent): the gate failed open when the script crashed (no `pipefail` in the default shell) and `CI result` could miss a timed-out job; both fixed as above. The test now also checks that the `paths` list in ci.yml matches the script.

### D55. GitHub Actions on their current Node 24 majors
- **Spec**: Tech stack, testing (CI). Left open in D52's review.
- **Change**: `actions/checkout` v4 → **v7**, `actions/setup-node` v4 → **v7**, `actions/cache` v4 → **v6** (in `.github/actions/playwright-browser`), `actions/upload-artifact` v4 → **v7**, `pnpm/action-setup` v4 → **v6**. Node 20 actions are deprecated on GitHub's runners; every one of these runs on `node24`.
- **Verified** on 5 Nov 2026 in each action's own repository: the major tag exists (latest releases checkout v7.0.1, setup-node v7.1.0, cache v6.1.0, upload-artifact v7.0.2, action-setup v6.1.1), and its `action.yml` at that tag says `using: node24`.
- **Breaking changes checked against this workflow**, none of which apply:
  - checkout v6 keeps credentials in a separate file under `$RUNNER_TEMP`; v7 refuses fork code under `pull_request_target`/`workflow_run`, which we don't use.
  - setup-node v6 caches pnpm only when asked (we set `cache: pnpm`); v7 drops the dummy `NODE_AUTH_TOKEN` (we set no `registry-url`).
  - cache v5/v6 and upload-artifact v5–v7: Node 24 and ESM only; the inputs we use are unchanged.
  - action-setup v5/v6 bootstraps pnpm with npm and then switches to the version pinned in `packageManager` (pnpm 10.28.0 here).
- The project's own Node stays 22 (`node-version: 22`).

### D56. Tagged versions become GitHub Releases
- **Spec**: Distribution and cost (downloadable builds; $0).
- **Change**: `.github/workflows/release.yml` runs when a tag `v*` is pushed.
  - A **build** job (read-only) checks that:
    - the tag is `v` plus the `package.json` version;
    - it points at a commit on `main`;
    - `CHANGELOG.md` has notes for that version (`scripts/changelog-notes.mjs`, unit-tested);
    - the commit's CI run on `main` passed: the `check`, `e2e (1)` and `e2e (2)` check runs, latest attempt of each. It waits up to 12 minutes for a run still in progress.

    It then runs typecheck, lint, the manifest and CDN guards (on the build that `pnpm zip` packs) and the unit tests, and uploads the zip, its SHA-256 file and the notes as a one-day artifact.
  - A **publish** job, with no checkout and no install, downloads them and creates the GitHub Release "Waymark X.Y.Z". A version like `0.4.0-rc.1` is marked as a pre-release. Re-running it for an existing release replaces the files, title, notes and flags. GitHub marks the newest release as Latest; a patch to an older line would need `--latest=false`.
- **Permissions**: none by default (`permissions: {}`). The build job has `contents: read` and `checks: read`. Only the publish job gets `contents: write`, through the default `GITHUB_TOKEN`, and it runs no project code. No other token or secret.
- **Cost**: about 3 minutes per release (two jobs). Release files don't count against the 500 MB of artifact storage, and the release page is a stable download link for testers, unlike CI artifacts, which expire (D54). A docs-only commit has no CI run to check, so tag the version bump's merge commit, which always has one.
- **Review** (independent): CHANGELOG.md did not exist yet (added here, with every version so far); the guard checked a build that `pnpm zip` then rebuilt; CI on the tagged commit was assumed, not checked; the write job ran install scripts; re-runs kept a stale title and flags; the notes parser cut at `## ` inside code blocks and missed linked headings. All fixed, with tests for the parser.
- **Version bumps** belong to the release lane, not to feature PRs (coordinating session, 5 Nov 2026). Feature PRs add their changes under `## [Unreleased]` in `CHANGELOG.md`.
- **Cutting a release** (Thomas or the coordinating session; no tag is pushed automatically):
  1. `pnpm release X.Y.Z` (`scripts/release.mjs`, unit-tested) bumps `package.json`, turns `## [Unreleased]` into `## [X.Y.Z] - <date>` with a new empty Unreleased section and links, and updates the version in `docs/STATUS.md` and the README. It refuses a version that isn't newer, and an empty Unreleased section.
  2. Run `pnpm check`, commit "Release X.Y.Z", open a PR and merge it.
  3. `git fetch origin main && git tag -a vX.Y.Z -m "Waymark X.Y.Z" origin/main && git push origin vX.Y.Z`. The workflow does the rest. Or run the workflow by hand (D160).

### D57. The privacy policy is not hosted on GitHub Pages; the store listing is a draft
- **Spec**: Permissions, privacy and security ("A one-page privacy policy (free on GitHub Pages) is required for the store listing"); Distribution and cost.
- **Finding**: the repository is private on the GitHub Free plan, which has no GitHub Pages for private repositories.
- **Change**: the policy is `docs/PRIVACY.md`, written against what the code does today (storage keys, the three optional network requests, the permissions). It lists free hosts for the public URL the store needs: a separate public repo with Pages, a public Gist, Cloudflare Pages or Netlify, Google Sites, Codeberg Pages. `docs/STORE.md` drafts the Chrome Web Store listing: descriptions, single purpose, a justification per permission, remote-code and data-use answers, the screenshot list, and the steps for a private (domain or group) listing.
- **Open items** before submitting:
  - a contact address in the policy;
  - a host for the policy;
  - the screenshots and promo tile (design lane);
  - **an icon:** the manifest has no `icons` yet, and the store requires a 128×128 one.
  - the store summary comes from the manifest `description`; to use the drafted one, change it in `wxt.config.ts` and `package.json`.
- **Review** (independent, against the code): the first draft missed Hugging Face's CDN as a third download host, the permission asked for a team library's site, the library's refresh at browser start and on **Refresh now**, the multi-site **Allow** for packs, and several stored fields; it also called completions "shown to you" (nothing reads them yet). All corrected. Noted for the code lanes: a granted library origin also gets the content script, since only the HD hosts are excluded (`src/core/permissions/registration.ts`), and the library is fetched twice at browser start.

### D58. Internal use for now: install from GitHub Releases, no store listing
*5 Nov 2026 · SPEC: Distribution and cost; D57*

- **Decision** (Thomas): Waymark is for internal use for now. The team installs the zip from the repository's Releases page in developer mode (README, "Install"). There is no Chrome Web Store listing, private or public, and the repository stays private.
- **What this changes**: the spec's plan of a private store listing first is on hold. `docs/STORE.md` stays as a draft for later, and D57's open items (a contact address and a host for the privacy policy) are not needed until then. `docs/PRIVACY.md` still describes what the code does and stays current.
- **Cost of the choice**: no automatic updates. Each person replaces the unzipped folder with a newer release and reloads the extension. Developer mode shows Chrome's "developer mode extensions" notice at browser start.

### D59. CI asks the Ubuntu mirror only for what is missing
*5 Nov 2026 · CI (D52, D54)*

- **Finding**: twice on 5 Nov an e2e shard hit the job's 15-minute timeout before any test ran (PR #49, then the 0.4.0 release PR #54). On a browser cache hit, `playwright install-deps chromium` still ran `apt-get`. The runner image already had every library Chromium needs, but `install-deps` also installs 9 optional font packages (CJK, unifont, about 22 MB), and the Azure Ubuntu mirror served them at a few KB/s, with timeouts and retries. Each hang cost 15 runner minutes, a re-run and a failure email.
- **Change**:
  - On a cache hit, the action starts each cached Chromium binary with `--version` and calls `install-deps` only when one can't start (which is what a missing shared library does). A cache miss still runs `playwright install --with-deps`.
  - "Install Xvfb and XTest" skips `apt-get` when `xvfb-run` and `libxtst6` are already installed (they are on the image).
  - The browser step gets `timeout-minutes: 6` and the Xvfb step 4, so a stuck download fails within minutes, not at the job's 15.
- **Cost**: the optional fonts are not installed. No test compares screenshots or depends on CJK glyphs; `pnpm screens` runs locally, not in CI.

### D160. A release can be started by hand: the workflow creates the tag
*5 Nov 2026 · D56; release lane decisions are D160–D169*

- **Finding**: the coordinating session works in a cloud container whose git proxy allows branch pushes but refuses tags (HTTP 403 on `git push origin v0.4.0`). Every release needed Thomas to push the tag from his own machine.
- **Decision** (Thomas asked for the coordinating session to be able to cut releases): `.github/workflows/release.yml` also runs on `workflow_dispatch` with a `version` and an optional full `commit` SHA. Thomas can press **Run workflow** in the Actions tab, and the coordinating session can start it through the Actions API.
- **Checks** before anything is written (the read-only build job): the run is on `main`; the version looks like `X.Y.Z` (an optional pre-release part); the commit, if given, is a 40-character SHA; the tag doesn't exist yet. Then the same checks as a pushed tag: the version matches `package.json` at that commit, the commit is on `main`, and its CI passed.
- **Writing**: the `publish` job, still the only one with `contents: write`, creates the annotated tag through the API and then publishes the release as before. A tag made with the workflow's own token starts no second release run.
- **Pushed tags** keep working unchanged.
- **Inputs** are read through environment variables, never pasted into the script, and are validated before use.
- **Independent review** (no blockers), fixes:
  - **A failed publish after tagging no longer gets stuck.** A re-run of the run that made the tag may find it, if it points at the same commit. Before, re-running all jobs always failed, and re-running only the failed job worked only while the one-day artifact lasted.
  - The input checks run before checkout.
  - Error messages never repeat the input: a newline in it could start a workflow command.
  - The concurrency group is the tag, so a pushed tag and a manual run for the same version can't publish at once.
  - Docs say to give the release merge commit: `main`'s latest commit may be docs-only, with no CI run to wait for.

## 2026-11-05 — Real-site reliability harness (`pnpm test:real`)

Findings from recording and replaying scripted tasks on public demo apps (see `docs/RELIABILITY.md`).

### D60. An input step also advances on Enter in a non-empty one-line field
- **Spec**: Player, "Advancing" (input: `change`, or blur with a non-empty value, or Next).
- **Finding**: TodoMVC (React, Vue, Angular) takes the typed text on Enter and clears the field. No `change` fires and focus stays, so the run never left "Enter New Todo Input" until the learner pressed Next.
- **Change**: a trusted Enter keydown (not with Shift, Ctrl, Alt or Meta, not while composing) on the target `input`, checked before the app clears it, advances when the field has a value. A `textarea` or rich editor gets a new line and does not advance. The value is only checked for emptiness, never read or stored.

### D61. A press on the target that the app turns into a click on an ancestor still counts
- **Spec**: Recorder, "Event capture" (use the pending fingerprint when the click target is that node or linked in `composedPath()`); Player, "Advancing" (click: a trusted click lands on the target).
- **Finding**: MUI's Select opens on `mousedown` and puts a full-page backdrop under the pointer. The `mouseup` lands on the backdrop, so the browser sends `click` to the common ancestor of the two, `<body>`. The recorder dropped the "open the select" step (the guide had only "Choose **Twenty**", which can never be shown with the menu closed), and the player would never advance on it.
- **Change**: when a click's own target is non-interactive, is an ancestor of the element a trusted `pointerdown` resolved to, comes within 1 s, **and is released within 4 px of the press**, the recorder records the pressed element and the player's click rule advances. A click whose own target is interactive (a card link around the button) is unaffected.
- **Drag-off cancels** (independent review): pressing a button, sliding off and releasing elsewhere is how people cancel a click, and the browser also sends that click to the common ancestor. The 4 px rule keeps it from counting. The recorder's older "click on an ancestor of the pressed node" link (for a node the app re-rendered) has the same 4 px rule now; before, such a drag recorded a click on the button.

### D62. A click inside an `<svg>` with no interactive ancestor resolves to the element around the svg
- **Spec**: Element targeting, record step 1 (nearest interactive element within 5 levels; otherwise the click is kept as low-confidence).
- **Finding**: demoqa's row actions are `<span id="edit-record-2" title="Edit"><svg><path/></svg></span>` with a click handler. A click lands on the `<path>`, which has no id, name or text, so the step was "Click **the element**" with no strong signal (since D47 it is not recorded at all), while the span has a stable id and a title.
- **Change**: for a low-confidence click inside an icon-sized `<svg>` (48 px or less on both sides), the target climbs out of SVG-namespace elements to the first HTML element around it. It stays low-confidence (flagged), and D47 still skips it when the wrapper has no strong signal either. A click in a larger svg (a chart or diagram) keeps its own target: the wrapper would be the whole chart. An svg inside a button or link already resolved to the button or link.

### D63. Ids that component libraries number per page load are generated
- **Spec**: Element targeting, record step 2 (drop ids that look generated: `ember123`, long digit runs, …).
- **Finding**: Angular Material's select was recorded with `id="mat-select-10"` and its option with `mat-option-51`. These counters change between page loads, so on replay the id and the CSS path built from it both failed. A perfect role + name match then scored 45 of 80 points (56, under the 60 threshold), and the step was not found on an unchanged page.
- **Change**: ids, test ids and classes of the form `<library>-[words-]<number>[-…]` are generated, for the prefixes `mat`, `mdc`, `cdk`, `headlessui`, `downshift`, `react-select`, `react-aria`, `rc`, `mui`, `chakra` and `reach` (`mat-select-10`, `cdk-overlay-3`, `headlessui-menu-button-3`, `downshift-0-input`, `rc-tabs-0-tab-1`). Other `word-number` ids (`edit-record-2`, `step-1`) and Material's typography classes (`mat-display-1`, `mat-headline-2`) are kept.

### D64. A unique match must beat every look-alike seen at record time
- **Spec**: Element targeting, playback step 4 (score ≥ 60, a strong signal, a 15-point lead); Data model (new optional `ElementFingerprint.lookalikes`).
- **Finding** (an intermittent wrong match on ant.design): about 3 s after load the docs site remounts the page. For about 1.5 s the "Select date" field of the Basic demo is gone while the same field of another demo, far down the page, is there. That field matched role + name, placeholder and landmarks (69 points). With no runner-up it passed every rule, and the step was drawn on the wrong field. At record time five fields shared that name, and only the CSS path told the target apart.
- **Change**: at record time, for every other element with a strong signal, the fingerprint stores the non-positional signals it matched. Only maximal sets are kept (at most 5, most weight first). At playback, a unique match whose non-positional matched signals are all in one of those sets is refused with reason `lookalike`, and the wait loop keeps looking. The real target, once there, matches more (here the CSS path) and is found.
- **Independent review**: look-alikes are stored **whatever their score, visibility or enabled state**. A look-alike under 60 at record time can pass 60 at playback on position and XPath once the target is gone. A look-alike in a hidden tab or collapsed demo can be shown later. Both were wrong matches in the first version and have regression tests (`test/browser/lookalikes.test.ts`). An **exact twin** (an element matching every non-positional signal the target has) is not stored, because it would refuse the target itself. MUI's docs keep a second, hidden alert dialog with the same title mounted, and its "Agree" made the real one unfindable. A visible twin is a repeated element (D5); a hidden one cannot be told apart by any signal. Record time scores the page once for both `matchCount` and the look-alikes.
- **Cost and limits**: when the target loses everything that told it apart from its look-alikes (here a rehashed CSS path), it is not-found instead of found: the case where the matcher cannot tell it from a look-alike anyway. Look-alikes that are not in the DOM at record time (lazy or virtualised content) cannot be known, so the rule narrows the risk but does not close it. Fingerprints recorded without look-alikes (before D64) behave as before. Robustness set A: 519/520 found, 0 wrong. The one miss is the new fixture pair `date-basic` / `date-other` under `wrap` (ambiguous), which reproduces the Ant case.

### D65. A nameless control in a list item is named by the item's label
- **Spec**: Element targeting, record step 2 and playback step 3 (signals and weights); Data model (new optional `ElementFingerprint.itemLabel`).
- **Finding**: the todo toggles of TodoMVC in Vue and Angular are `<input type=checkbox class=toggle>` next to a `<label>` that is not linked to them. They have no name, text or test id, so since D47 a click on one is not recorded at all. In React they share a test id and were `instance: 'any'` ("check any todo"), and the title was "Check **the checkbox**". What the author meant is in the row: "Walk the dog".
- **Change**: a **checkbox, radio or switch** with no accessible name and no own text gets an **item label**: the text of the first visible `<label>` or heading in the nearest `li`, `tr`, or `row` / `listitem` / `treeitem` role at most 4 levels up. The label must not belong to another field, and it must be **everything the item says**: the item's visible text, outside interactive elements, is exactly that label. Hidden parts are left out, never field values, and the data-like filter applies. It is a new signal `item`: weight 20, strong, not identifying. The step title uses it ("Check **Walk the dog**").
- **Why so narrow** (two independent reviews; each case is a regression test in `test/browser/item-label.test.ts`). A label is identity only when it is the item's name, and status or context that moves between rows picked the wrong row:
  - "Open" next to a named link in an issue list;
  - an "Overdue" badge next to "Pay rent";
  - a "Books" category heading over "Dune";
  - a parent row taking a nested child's label.
  So there is no item label when:
  - the item has other visible text;
  - a link in it has a name;
  - it contains another item;
  - anything in it is editable (typed text in rich-text task lists);
  - the control is not a toggle. A nameless delete icon would otherwise be titled "Click **Walk the dog**".
- **Not identifying**: rows that share a label are ambiguous (not-found), not interchangeable (`instance: 'any'`). When the item is gone (another list), the other rows' toggles match only what record-time look-alikes matched (D64), so the result is not-found.
- **Privacy**: an item label is usually user content (a todo, a contact's name). The data-like filter drops emails, numbers and codes, not names, the same as for own text.
- **Cost**: when the item's text changes, the step is not found, the same contract as own text. Toggles in richer rows (a contact list with name and email) stay unnamed and, since D47, unrecordable.

### D66. Ids, test ids, names and guide ids that look like data are not stored
- **Spec**: Element targeting, record step 2 (the data-like filter runs on text, names, option labels, link paths and titles); Privacy (never store what the user typed or sees as data).
- **Finding** (security audit): element ids, test ids, `name` and `data-guide-id` skipped the data-like filter. A value like `data-testid="user-row-jane.doe@acme.com"` went into `testId` and the CSS path, and from a shadow host or iframe into `shadowPath` and `framePath`, and from there into exported packs.
- **Change**: a new attribute filter, `isDataLikeAttr`, rejects a value that holds an email, a phone number (7+ digits), an amount, a UUID or a run of 4+ digits, or is longer than 80 characters. It applies to:
  - ids and test ids;
  - `data-guide-id`;
  - `name`;
  - the key attributes in CSS path segments (`name`, `type`, `role`);
  - classes.
  Iframe and shadow-host selectors are built from the same CSS path, so `framePath` and `shadowPath` are covered too. Such an element is found by its other signals (its text, label, role), or not at all.
- **Why not the full text filter** (independent review): the text rules for long mixed tokens, dates, codes and decimals would also drop ordinary author ids such as `address1`, `addressLine1`, `col-1-2-3`, `AB-12` or `scale-1.25`. Two unlabelled fields `address1` / `address2` then had no strong signal at all. The fixture now has that pair.
- **Cost**: rows told apart only by a data id (`edit-bob@acme.com` / `edit-jane@acme.com`, both "Edit") now record as `instance: 'any'`, the same contract as rows told apart only by data text.
- **Numbers**: robustness set A 542/544 before; 559/560 after with the address pair added; 0 wrong. Set B: 0 wrong. Real-site harness: 16/16, 0 wrong.
- **Not covered here**: link paths and step URLs keep path segments that are not key-like, such as `/users/jane.doe` (`isKeyLikeSegment` in `src/core/url/url.ts` replaces numbers, codes and emails only). Names in visible text and item labels pass by design, as before.

### D67. A click and the navigation it caused are matched by event time, in either order
- **Spec**: Recorder, "Navigation" (a navigation within 1.5 s of a recorded click belongs to that click); CLAUDE.md (read-modify-write through `enqueue`).
- **Finding** (fixes session): `rec.step` checked site access with an `await` *before* entering the write queue, while `route.report` queued at once. A slower check (one more `chrome.storage` read) let the route report of a click-caused in-app navigation be handled first. It was then compared with an old `lastActionAt`, which was also taken when the service worker handled the step, not when the click happened. Six e2e tests recorded a spurious "Go to Fixture app" step. With a 200 ms delay injected in the site check, 7 of 15 m2/m3 e2e tests failed on the old code. The seventh was a step sent just before Stop being dropped.
- **Change**:
  - `rec.step` queues at once and checks site access inside the queue, so steps keep their arrival order relative to route reports and Stop.
  - Both messages carry the page's event time (`at`). The navigation rule compares event times, not arrival times. A time more than 10 s from the service worker's clock is ignored (content scripts are untrusted).
  - When route reports still get in first and add navigate steps (a redirect chain adds several), an action from the same tab reported afterwards takes them back. That needs the action to come at most 1.5 s before each navigation and to be on another page. A click on the page the navigation led to never takes it back.
  - The recorder stamps a step with the page and time of the action itself. A check step is emitted a moment after the click (to read the new state), and a handler may have changed the route by then.
  - **Independent review**, all with tests:
    - event times are never in the future (a later `lastActionAt` would hide the navigations that follow);
    - the "leaving" report carries the page's time too;
    - pending navigations are per tab;
    - a refused step costs no storage write.
- **After**: the same 200 ms injected delay: 15 of 15. Unit tests in `test/unit/recording-race.test.ts` stub `chrome` with a slow permission check.
- **Limits**:
  - A step from an iframe gets the top page's URL rule when it is handled, which may already be the new page.
  - For an in-app navigation between two pages with the same URL rule (`/orders/1` to `/orders/2`, both `/orders/:id`), the take-back cannot tell the pages apart. If such a route report still arrives first, it stays a navigate step. Arrival order covers the usual case.

## 2026-11-05 — Team library access and schedule (issues #21, #22)

### D80. A library site granted only to fetch the pack is not a guide site
- **Spec**: Sharing, "v1: library URL" (the library's site is requested when it sends no CORS headers), and Architecture, "Content script" (registered for granted sites).
- **Finding** (issue #21): that grant also registered the content script on the library's site (for example `raw.githubusercontent.com`), and the panel called the site allowed.
- **Change**:
  - Settings marks the site "fetch-only" (`fetchOnlyOrigins` in `chrome.storage.local`, `src/background/site-access.ts`) before it asks for it. The mark comes first so the permission event never registers the script there. If the user denies the prompt, the mark is cleared. A site the user had already allowed is not marked.
  - Fetch-only sites get no content script (`grantedSitePatterns(origins, exclude)`). The panel, recording, playback and the pending-Allow list all treat them as not allowed (`siteAllowed`).
  - When the user clicks **Allow** on such a site, or ticks it in the one-click Allow, the panel sends `site.allowed`. That clears the mark, registers the script and injects it into open tabs. Chrome fires no permission event for an origin that is already granted, which is why the panel has to send this message.
  - Unsubscribing, or moving the library to another site, gives back a permission that was held only for fetching.
  - **Review fixes**:
    - **Migration:** after an update, a granted library site that no stored guide uses is marked fetch-only. Subscriptions made before this change are covered.
    - **Giving a permission back:** the permission is removed first, and the mark is cleared only once that succeeded. A failed removal never leaves an unmarked guide site behind.
    - **Marking:** the service worker never marks a site that is already granted.
    - **Clean-up at browser start:** fetch-only sites other than the current library's site are given back. This covers a subscription that never finished.
    - **Injection:** `site.allowed` injects only into sites it actually un-marked, because a fresh grant is already injected by `permissions.onAdded`.
  - The per-step `rec.step` check keeps the raw permission call. A fetch-only site has no content script, and an extra storage read there reordered a click and its route change in e2e. That ordering is a latent race in the recorder, reported to the real-sites lane.
- **Limits**:
  - A site marked fetch-only and later allowed through `chrome://extensions` (not through the panel) stays fetch-only until the user clicks Allow in the panel.
  - If the library's site is also an HD-voice download host (D51), the two grants are not coordinated. Both hosts are expected to send CORS headers, so this should not come up.

### D81. One library fetch per browser start
- **Spec**: Sharing, "v1: library URL" (refreshed with `chrome.alarms`).
- **Finding** (issue #22): `onStartup` and `onInstalled` fetched the library immediately, and also set an alarm that fetched it again a minute later. Subscribing did the same.
- **Change**: at browser start and install, the alarm (delay 1 minute) does the only fetch. After a fetch caused by subscribing, the next alarm waits a full period (`scheduleLibrary({ fetchedNow: true })`).

## 2026-11-05 — Clickable cards and voice timing (issue #32)

### D82. A click on plain content inside a clickable card records the card
- **Spec**: Recorder, "Capture rules" (non-interactive clicks are low-confidence) and D24 ("revisit with pilot data").
- **Finding** (issue #32, a real dashboard): a category card is a `<div>` with a click handler and a pointer cursor. A click on its title was recorded on the title, flagged ⚠ low-confidence. At playback only a click on that exact title counted, so a click on the card's count or padding did not advance.
- **Change** (`clickableRegion` in `src/core/fingerprint/dom.ts`, used by the recorder and Re-pick):
  - **When:** a click on content that is not a control.
  - **What is promoted:** the outermost element above it that shows a pointer cursor. The cursor is inherited, so that is where the pointer starts.
  - **Conditions for promotion:**
    - within 6 levels;
    - not `html`/`body`, and the page itself does not show a pointer;
    - at most 25% of the viewport;
    - no control or `<label>` inside, and at most 200 descendants;
    - no control around it;
    - a strong signal **other than its text** (id, test id, role + name, name, link). A card's text spans titles and live counts, so it is not used to decide.
  - **Result:** the step targets the card, without the low-confidence flag, and is titled by the text clicked ("Click **Unsafe Driving**", not "… 3"). A click anywhere on the card advances.
  - Otherwise nothing changes: the content stays the target, low-confidence (and D47 still drops it when it has no strong signal).
- **Never more than one item** (independent review):
  - **Climbing stops at the first repeated item**: a list or table item (`li`, `tr`, `td`, row, option, tab and similar roles), or an element with an alike sibling (same tag, sharing a class, or neither has a class). A card among cards is the region, but a pointer-cursor `ul`, `table` or sidebar is never recorded as a whole. If the item itself has nothing reliable to find it by, the click stays low-confidence.
  - **Repeated regions are rejected**: a region that matches more than one element (cards sharing a test id: `instance: 'any'` or `matchCount > 1`) is not promoted. Otherwise the step would play on the first card.
  - **Controls inside web components count**: controls inside open shadow roots (the region's own and nested ones) count as "a control inside", within the 200-node limit.
  - **Titles**: the title is the visible text clicked, or the region's own visible text, never hidden text.
  - **One shared helper**: the recorder and Re-pick use the same helper (`promoteToRegion`, `src/core/recorder/region.ts`), and Re-pick's hover outline shows what a click would pick. The press reuses the region's fingerprint at the click.
- **Limit**:
  - A pointer cursor on something that does nothing (with an id) is recorded without the ⚠ it used to get. It is still exactly the element under the click, so it is not a wrong match.
  - A lone card whose inner title and count are alike class-less elements stays low-confidence, the conservative side.
- **Matcher**: unchanged. The card is found by its id, and a count that changes between recording and playback does not break the step (e2e).

### D83. A step on an element is read aloud once it is found
- **Spec**: Voiceover, "read each step once".
- **Finding** (issue #32): after a click loaded a slow, nested frame, the next step was read while the frame was still loading, before anything was highlighted.
- **Change**: `voiceSync` reads a step that has a target only when the frame board has a winner for it. Every winner report (`run.match`) calls it again. That is idempotent through `spokenToken`, so it also covers a service worker restart between the board write and the read. **Repeat step / Replay voice** still reads on request, found or not. Note and navigate steps are read at once, as before. A step that is never found is not read; the not-found card shows instead.

### D84. A frame that is gone never blocks the frame that replaced it
*5 Nov 2026 · SPEC: Element targeting, playback step 8 (frame winner); issue #38*

- **Finding** (Thomas's debug log, a real dashboard):
  - A screen opened from the top nav is rebuilt in **new iframe elements** (new frameIds), while the old frames live on for about 0.5 s.
  - The old inner frame found the element first, then the new one did. Two found, on-path reports tie, so there is no winner and nothing is drawn.
  - The old frame never reports again, so its entry stays. D45's "one entry per frame" covers a frame that reloads (same frameId), not a frame element that is replaced.
- **Change**:
  - Each board entry keeps the reporter's `sender.documentId`.
  - When found reports tie (no winner, two or more found), the service worker asks those documents `frame.alive` (`tabs.sendMessage` with `{ documentId }`). A gone document fails at once, while a live one answers `true`. An answer slower than 500 ms counts as alive, so a live frame is never dropped.
  - Gone documents' entries are removed, but only if the entry is still that document. The winner is then recomputed, and the change is broadcast and read aloud (D83).
- **Independent review**: no wrong-winner path was found, but three gaps were. Each is now covered:
  - **The old frame is removed only after the new one has found the element**, so both answer "alive". Two measures cover this:
    - The content script sends `run.leave` on `pagehide`, and the service worker drops that document's own entries, whatever its lifecycle (it can only remove its own entries).
    - While two or more found frames remain, they are asked again after 1.2, 2.5 and 5 s, guarded by the step token.
    Before this, the board only recovered when another report happened to come in, typically 8 s later when the top frame gave up (e2e `?keep=2500` checks it now draws within 7 s).
  - **A gone frame that wins outright**: in an `instance: 'any'` tie the lower frameId wins, or a gone frame can lead by the margin. Documents are now asked whenever two or more frames found the element, not only when no frame won.
  - **Repeated asking**: each document is asked at most once a second (`checked` times on the board), and the 500 ms timer is cleared.
- **Matcher**: unchanged. A real tie between two live frames still draws nothing.

### D85. The on-page ? menu works with the production closed shadow root; tests can use it too
*5 Nov 2026 · SPEC: Discovery and hints (launcher); Player and overlay ("Overlay", closed shadow root); issue #42*

- **Finding** (Thomas, store-like build): the ? menu listed his guide, but a click closed the menu and nothing started.
  - The menu closes on a press "outside" it, using a document `pointerdown` listener that checked `composedPath()` for the menu.
  - In production the overlay's shadow root is closed, so from the document a press on a menu item only shows the overlay host. The press counted as outside, the menu closed on `pointerdown`, and the click never landed.
  - Test builds use an open root, which hid this from every test.
- **Change**:
  - `pressInsideLauncher` counts a press anywhere in Waymark's overlay host as inside.
  - The launcher never fails silently: an error from `launcher.start` stays in the menu as "Couldn’t start this guide: …" and is written to the debug log.
- **Tests**:
  - In test builds, a page URL with `waymark-test-closed` gets the production closed root.
  - The launcher marks the first item's position (`launcher-item`), because tests cannot look inside a closed root.
  - An e2e test opens the menu and starts a guide with the closed root. It fails with the old check (the guide never starts).
  - A browser test pins down that a document listener sees only the host.
- **Checked**: no other content code relies on seeing inside the overlay's root. Every other outside check uses `isOverlayPath` (the host).

### D86. Tests see the overlay's event paths the way the store build does
*5 Nov 2026 · SPEC: Player and overlay ("Overlay": closed shadow root); issue #46, follow-up to D85*

- **Finding**: the store build attaches the overlay's shadow root **closed**, and test builds attach it **open**, so tests can query inside it. The only behavior that differs between the two is `composedPath()` as seen by a listener outside the root. With a closed root it stops at the host; with an open root it includes the overlay's elements. #42 lived in that gap.
- **Change**:
  - `eventPath(e)` (`src/content/overlay/host.ts`) returns the path a listener outside the overlay sees in the store build. With an open root, it drops the root and the nodes inside it. Listeners attached inside the overlay keep the full path.
  - All content code reads paths through `eventPath()`. An ESLint rule bans `composedPath()` in `src/content/**`; the one read is in `host.ts`.
  - So every e2e test now runs the production behavior while still being able to look inside the overlay. Proof: with the #42 check restored, the ordinary open-root launcher e2e fails too.
  - The closed-root e2e from D85 (`waymark-test-closed`) stays as a canary for the real thing.
- **Why not make every test build closed**: Playwright cannot query inside a closed root. About 30 e2e checks would have to click by coordinates, and they would test the same thing `eventPath` now guarantees.
- **Also checked**:
  - `event.target` retargeting and `document.activeElement` are the same for open and closed roots.
  - Code holds its own reference to the root and never reads `host.shadowRoot`, which is null when closed.
  - Recorder and advance (`src/core`) call `composedPath()` themselves. They first return for any path through the host (`isOwnEvent`/`isOverlayPath`), so the overlay's insides never reach their logic.

### D87. A frame reports its search once; it re-sends only when the board holding its report was replaced
*5 Nov 2026 · SPEC: Element targeting, playback step 8; issue #36 (found with the debug log, D110)*

- **Finding**: after each search a frame reported its result, then immediately called `render()`. Its report was still on the way, so the view had no winner yet, and D45's re-send fired. Every frame sent two `run.match` per step. Worse, every later view without a winner (for example when the top frame gave up after 8 s) made **all** finished frames re-send again. Thomas's log shows waves of `report.again` from about 25 frames.
- **Change**:
  - Each board gets an `id` (a new one whenever the board is created anew, for example after the page-load clear of D45). The view carries `boardId`, and the `run.match` reply carries the board the report went into.
  - A frame re-sends only when no report of its own is on the way and the view shows a different board from the one holding its report. That is exactly D45's case, where the board was replaced after the report arrived. It re-sends at most 3 times per search.
  - A new search resets this state; stale replies are ignored by sequence number.
- **Tests**:
  - e2e: each frame sends exactly one report per step, across an 8 s run where every frame finishes. It failed before (2 for some frames).
  - The D45 e2e (Open start page) still passes.

### D88. The editor never gets wider than the panel; the "Saved" note goes once you edit
*5 Nov 2026 · SPEC: UI sections (side panel editor); issue #52*

- **Finding**: buttons default to `white-space: nowrap`, and each step's title sits in a button (the expand toggle). A long title, even an ordinary sentence, did not wrap. The step, the editor card and the panel's main column are grids with an `auto` column, which grows to the widest unbreakable content, so one long title widened every field in the editor past the window (300 px too wide at a 300 px panel; 1300 px with one long word). The "Saved “…” with N steps" note from the recording also stayed after edits, describing a copy that was no longer current.
- **Change**:
  - The step toggle wraps (`white-space: normal`, `overflow-wrap: anywhere`, so a URL or email breaks too).
  - Safeguards: the panel's `main`, `.card`, the step list, each step and its body use one `minmax(0, 1fr)` column, and form controls get `max-width: 100%`, so any future unbreakable content wraps or scrolls inside its own box instead of widening the panel.
  - The note is cleared as soon as the editor has unsaved edits, and stays cleared after saving (the editor's own status says what was saved).
- **Tests**: `test/e2e/m2-recorder.spec.ts` (10-action scenario) edits a step after the recording, checks the note is gone, then at 300 px fills a long sentence and a 200-character word and checks the panel does not scroll sideways. Each assertion fails on the old code.

### D89. Polish from testing: "Tutorial page" without made-up names, a compact done card, a lighter shade
*5 Nov 2026 · SPEC: Built-in tutorials (D128); Player UI · issues #56, #57, #58*

- **Change**: the page's header was a made-up brand ("Northwind Invoices", marked Practice) and its sample invoices had made-up company names. Thomas asked for it to say plainly what it is. The header is now **Tutorial page**, the samples are "Sample customer A/B/C", and every user-visible "practice page" (tab title, panel hint, button labels, the tour's first step and its voice line, a copied tutorial's note) now says "tutorial page". Internal names (`practice.html`, `practice-*` ids) are unchanged, so copied tutorials and tests keep working. D128 and `docs/UX.md` 5.1 describe the old name; this entry supersedes their wording.
- **Done card** (#57): it repeated the step header ("Step 1 of 1", a full bar, mute and X) above a check, "Done!" and the note stacked in a column, so it was tall for two lines of text. It now has no header: the check sits beside "Done!" and "You finished …", and Close is the one way out (Esc still closes). About half the height.
- **Shade** (#58): the dim around a spotlighted element is 20% lighter by default (`--wm-scrim` 0.5 → 0.4 on light pages, 0.6 → 0.5 dark). A user and per-guide control for it is a separate feature (#58).
- **Tests**: `test/browser/player.test.ts` checks the done card has no header or bar, one button, the check beside the title, and is under 130 px tall (it fails on the old card). `test/browser/practice.test.ts` checks the heading and that none of the old names appear; the tour's first-step text and voice line are checked in `test/unit/tutorials.test.ts` and `test/e2e/t1-tutorials.spec.ts`.

### D90. A small design system: tokens, components, a screenshot harness
*5 Nov 2026 · SPEC: Accessibility; UI sections (side panel, settings, overlay)*

- **Tokens** live in `src/ui/tokens.css`: colour (neutrals, accent, warn, danger, success, REC, focus, the spotlight scrim and ring), a 4 px spacing scale, radius, type scale, elevation and motion. Light by default, dark under `prefers-color-scheme: dark`. All sizes are px: in the overlay's shadow root, rem would follow the host page's root font size.
- **One file, two scopes.** The selector is `:root, .wm-theme`. Extension pages get it on `:root`. The overlay imports the same file as text (`?inline`, `src/content/overlay/theme.ts`) and its layer has the class `wm-theme`, so host page CSS cannot reach or override the tokens inside the closed shadow root. Custom properties are prefixed `--wm-`.
- **Components** (`src/ui/components.css`): element styles make every plain `button`, `input`, `select`, `textarea` and `progress` look the same; modifiers pick a variant (`.primary`, `.ghost`, `.danger`, `.sm`, `.icon`), plus `.card`, `.field`/`.hint`, `.check`, `input.switch`, `.list`/`.list-item`, `.badge` (`accent`, `warn`, `danger`, `success`), `.empty`, `.banner`, `.alert` and a visible `:focus-visible` ring. The side panel's old class names (`.site`, `.guides`, `.edit-step`…) are mapped onto the new look in `sidepanel/style.css` until each screen is reworked.
- **Contrast (WCAG AA)**, measured (light / dark):
  - text on surface: fg 16.9 / 13.4, muted 6.1 / 6.8 (on surface-2 5.6 / 6.1), accent text 5.9 / 8.2, warn 5.4 / 8.7, danger 5.6 / 7.1, success 5.4 / 8.8;
  - text on its soft background (badges, banners, alerts): accent 5.1 / 6.4, warn 5.0 / 7.3, danger 4.9 / 6.5, success 4.7 / 7.5;
  - accent button text 5.9 / 7.7;
  - control borders (WCAG 1.4.11, ≥3:1): 3.8 / 3.5 on surface, 3.4 / 3.2 on surface-2.
- **Colour scheme on the page**: the overlay follows the browser's `prefers-color-scheme`, not the host page's colours. Every on-page surface (tooltip, cards, pill, launcher) is opaque with its own text colour, so it reads the same on a light or dark page; the screenshot harness shoots a dark browser on a light page as well.
- **Screenshots**: `pnpm screens` (`test/screens/screens.spec.ts`, its own Playwright config, not in CI) records a guide on the demo app and shoots every panel, settings and on-page state, light and dark, plus 640×450 (200% zoom of 1280×900) and 375×667. The panel learns the site only from a toolbar click (activeTab), which a test can't make, so for the "not allowed" shot only, the page's `tab.current` answer is rewritten in the test. Shots go to `artifacts/screens/` (git-ignored); `scripts/shots.py` copies chosen light/dark pairs as small 256-colour PNGs into `docs/screenshots/<pr>/`.

### D91. Side panel and editor layout
*5 Nov 2026 · SPEC: Side panel; User flows (Record, Edit); Discovery*

- **Icons**: Lucide 1.59.0 (ISC; the Feather-derived icons are MIT), bundled. `src/ui/icons.ts` lists the icons used, so only those are built. They are drawn with DOM APIs (`svgIcon`) or Preact (`Icon`), never `innerHTML`, and are always `aria-hidden`; the control carries the label. Notices are in `THIRD_PARTY_NOTICES.md`.
- **Panel**: a sticky header (Waymark, Settings icon button), then cards: site (origin, an Allowed / Not allowed badge, the `?` button switch, Remove access), playing guide (step n of N with a progress bar), new guide, guides. Without a site: an empty state that says what to do.
- **Library**: rows with a two-line title, step count, a Team badge, then Copy link, Edit (Duplicate for team guides) as labelled icon buttons and a Start button. "For this page" and "All guides" / "Other guides" have counts. Empty states for "no guides yet" and "no match"; search and Export are hidden until there is a guide.
- **Recorder**: a Recording / Paused badge, Stop in the card head (the primary action), then Pause, Undo, Add note. The newest step is highlighted. **Warnings are explained inline** under the step (shared text in `sidepanel/steps.tsx`, the same as `docs/TESTING.md` section 3): "Hard to find" (low-confidence), "Drawing area" (canvas), "Closed component" (closed-shadow). Text test changed: m2 checked "● Recording: Update profile"; it now checks the status badge and the title.
- **Editor**: each step card has a number, a kind badge, Move up / down / Delete icon buttons (labelled "Move step 3 up"…), the rendered title, inline warnings, then Title, Note and Voice text (textareas grow with their text, `field-sizing: content`), "Moves on" and an Optional switch, and Test step, Re-pick, Note after. Re-picking highlights the card and shows how to cancel (Esc). Test step shows Found (with the matched clues as badges), "Found, but fragile" (warn) or Not found (danger). Save and Close stay in a sticky bar at the bottom. The "Saved (version n)." text is unchanged.
- **Screen readers**: a new recorded step is announced as "Step 5: Check Send me a copy. Warning: Hard to find" from one hidden live region (`lastStepAnnouncement`), not by re-reading the whole list with its help text. Test step results update one live region that stays mounted. Matcher clue names are shown in plain words ("role and name", "page position"). The editor has an `h2`, a "Steps" `h3` and an `h4` per step. The import dialog takes focus when it opens.
- **Test changes**: m2 checked "● Recording: Update profile"; it now checks the status badge and the title. m4 found the reorder buttons by the names "Move up" / "Move down"; they are now labelled "Move step 3 up", so the test uses the new `step-N-up` / `step-N-down` test ids.
- **Export review** lists each string as a row with its kind and step above the value, and says the file name it will save.

### D92. Settings layout, a Sites list, and a first-run welcome
*5 Nov 2026 · SPEC: Settings; Permissions ("Site access"); Discovery ("First-run access")*

- **Settings** has a header, a section nav (a sticky side column on wide windows, a row of links on narrow ones) and one card per section: Voice, HD voice, Sites, Team library, Problems, About. Each card has an icon, a heading (`h2`) and a status badge where one helps (HD voice: Off / Downloading / Checking / On / Too slow / Failed; Team library: Subscribed / Refresh failed; Problems: count).
- **Voice**: switches for "Read each step aloud" and "Allow online voices" (still checkboxes underneath, `role="switch"`), the language and voice selects side by side, "In use" as a callout, the speed as an `<output>` with an `aria-valuetext`. Every test id and every text the e2e tests check is unchanged.
- **HD voice**: the download shows a progress bar with a percentage, and the speed check shows an indeterminate bar. The state texts ("Off.", "On. English guides use the HD voice." …) are unchanged.
- **Sites (new)**: lists the sites Waymark may run on, from `chrome.permissions.getAll()` through the same `grantedSitePatterns` filter the service worker uses (so the HD voice download hosts never show), each with Remove. It updates on permission changes. It only reads and removes permissions, as the side panel's Remove access already did; the service worker's existing `permissions.onRemoved` handler unregisters the script.
- **Removing a site** asks first (an inline "Remove access" / Cancel) and then moves focus to the Sites heading. A failure is shown. The site the team library is read from (granted when the library host sends no CORS headers) says so, because removing it stops library refreshes. Clear in Problems asks first too.
- **About (new)**: the version, the keyboard shortcuts as the browser has them now (`chrome.commands.getAll()`, since users can change them) and a Change shortcuts button (`chrome://extensions/shortcuts`).
- **First-run welcome** in the side panel: three short cards, Allow, Record and Play, with Back / Next, step tabs, Skip and Get started. It shows until finished or skipped; the flag is `ui:welcomeDone` in `storage.local`. It has nothing to do with guides, so the guide index and storage code ignore it. It sits above the site card. The panel's cards wait until the flag is read, so they don't jump down when the welcome appears. Finishing or skipping moves focus to the panel's next control. The e2e m0 test now checks the welcome and that it stays dismissed; its heading lookup uses `exact: true` ("Welcome to Waymark" also contains "Waymark").

### D93. On-page UI: tooltip, spotlight, REC pill, launcher
*5 Nov 2026 · SPEC: Player and overlay; Recorder ("State"); Discovery; Accessibility*

Only the look and the accessibility semantics change; every handler, advance rule and message is the same.

- **Tokens on the page**: the overlay's styles use the D90 tokens (scoped to the layer in the closed shadow root), so the tooltip, cards, pill, launcher and banners follow the browser's light or dark scheme. Every surface is opaque, with its own text colour, border and shadow, so it reads the same on light and dark pages. Buttons reset `margin`, `text-transform`, `letter-spacing` and `box-shadow`, which host pages sometimes set. Under `forced-colors: active` the overlay uses system colours.
- **Spotlight**: one element the size of the hole dims the page with a large `box-shadow` (`--wm-scrim`), instead of four panels. The hole now has rounded corners that match the ring. It still takes no pointer events, so the target stays clickable, and the hole geometry is the same (`spotlightPanels`, 6 px padding). The ring has an accent border, a white halo that shows on dark pages, and a soft outer glow. It fades in and pulses twice. `prefers-reduced-motion: reduce` turns every animation off. The stacking order is scrim, then ring, then tooltip.
- **Tooltip**: the header has "Step n of N", a mute icon button (`aria-pressed`) and an Exit icon button ("Exit guide", the same `data-action="exit"`). A thin progress bar sits under it. Then come the title (15 px, semibold) and the note. The footer has Back on the left and Skip and Next/Done on the right. A Floating UI `arrow` points at the target from whichever side the tooltip ends up on. Exit moved from the footer to the header, so every card still has exactly one exit.
- **Cards**: each card has an icon: done (success), can't find (warn), another page (pin). Not found shows "Report broken step" on the left and Skip and Retry (primary) on the right. Off track shows Skip and Go back (primary). The report confirmation appears as a green line.
- **Screen readers**: steps are announced from one hidden `role="status"` region that stays in the layer: "Step 3 of 7: Click Import", then the card titles and the report confirmation. Before, the tooltip itself was the live region, and it was replaced at every step, so screen readers often skipped it. The tooltip is a `dialog` labelled with the guide title, described by the note. Focus never moves into it, so the learner's field keeps focus (unchanged).
- **REC pill**: a light or dark chip with a blinking red dot, a red "REC" (grey "Paused") and the newest step with its number. When nothing has been recorded yet it says "Use the page; each action becomes a step". Notices such as "Not recorded…" show in the warn colour.
- **Launcher**: a 44 px button (touch target) with a question-mark icon. It is a disclosure (`aria-expanded`, `aria-controls`) rather than an ARIA menu, because it had no arrow-key handling. Opening it moves focus to the first guide, and Esc closes it and returns focus to the button. The deep-link offer and the menu share one card style; in the offer, Not now comes before Start.
- **Pick banner** uses the tokens, and the pick box gets a white halo.
- **Icons** in the content script are imported one by one from Lucide (`src/ui/svg.ts`), so only the six it uses are bundled. The content script (test build) grew from 80.7 KB to 91.4 KB, mostly CSS.
- **Test change**: the browser test counted four `.panel` elements. It now checks that the `.spot` box matches the ring and takes no pointer events. A new test checks the persistent announcement and the arrow side.
- **Fixes from the independent review**:
  - At 200% zoom and on phones, a long step ran off the bottom of the screen. The tooltip's content is now a scrolling body, sized with Floating UI's `size` middleware to the space beside the target. It is never shifted across the target: an e2e run caught a vertical shift covering a target near the bottom of the page. The arrow sits outside the body, so it is not clipped, and it hides when the tooltip had to move past the target. A browser test fills a small viewport with a long note.
  - The live region now exists before the first step, and its text is set on the next frame after being emptied, so the first step and a repeated step (Retry) are both read.
  - The overlay is `direction: ltr`, so an RTL page no longer mirrors the button rows; step titles and notes are `dir="auto"`.
  - The REC pill stops short of the launcher on narrow screens.
  - The launcher menu returns focus to the button when it closes with focus inside, closes on an outside press or when focus leaves it, and sets `aria-controls` only while open.
  - The ring has a thin dark inner line, so it shows against white content in dark mode as well.
  - "Report broken step" has a border, like the other buttons.

### D94. The Waymark mark, extension icons, and a copy pass
*5 Nov 2026 · SPEC: Distribution (store listing); UI copy*

- **Mark**: an original drawing: a white flag on a pole, planted at the end of a dotted path, on a blue rounded tile (`assets/brand/mark.svg`). At 16 px the path and the pole's foot would blur, so 16 px has its own simpler drawing (`mark-16.svg`). `node scripts/icons.mjs` renders `public/icon/{16,32,48,128}.png` with the Playwright Chromium; the PNGs are committed, so builds need no browser. WXT puts them in the manifest's `icons`, which the toolbar button uses too. The panel and Settings headers show the mark (`src/ui/Mark.tsx`) instead of a generic pin icon.
- **No remote fonts or icons**: the system font stack only, and every icon is bundled.
- **Copy**: one name per thing across the panel, Settings, the page and the docs. "Team guide" / "team library", not "library guide". "Select", not "Tick". "On the page". The recorder warnings are called "Hard to find", "Drawing area" and "Closed component" everywhere. Error text says what to do next ("Team guides are read-only. Duplicate the guide to edit your own copy."). `docs/TESTING.md` now uses the new labels: the welcome, the Allowed badge, Undo, Note after, the speaker and × buttons, Export n selected…, Import…, Copy as text, Settings → Sites, and the new warning names.
- **Settings → Sites and D80**: the Sites list leaves out library sites that are granted only to fetch the pack (`fetchOnlyPatterns`), the same filter the service worker uses for the content script. A library site the user has also allowed for guides is still listed, with its note.
- **Fixes from the independent review**:
  - Icons: the 128 px icon is a 96 px tile with 16 px of transparent padding, as the Chrome Web Store asks. 32 px uses the simple drawing too, because the dots read as specks. The small tile is a lighter blue (#3d6cf0), so it shows on dark toolbars.
  - Test step on the page no longer flashes matcher internals ("Matched: roleName…"). It says "Found." or "Found, but fragile." and points to the side panel. "Not found" no longer repeats itself, and it says what to do.
  - Plurals ("1 step"); "Pack address" instead of "Library URL"; the same "…then press Start." and the same read-only sentence everywhere; no "Score" for authors; "Add note at end" next to "Note after". The Export hint is visible text, because a tooltip on a disabled button is unreachable.
  - Left as is, because e2e asserts them: "could not find that again" (pick banner), "Not recorded…" (pill) and the straight apostrophe in "Open a page of this guide's site…".

### D100. Undo for deleted guides and steps
*5 Nov 2026 · SPEC: Side panel; User flows (Edit); Data model ("Storage")*

- **Guides**: Delete (the row's More menu, or Delete with one guide selected) removes the guide at once, without the old `confirm()` dialog, and a toast offers **Undo** for 8 seconds. In the same queued write the service worker copies the guide to `guides:trash` in `storage.local` (at most 20 entries; an entry is ignored and dropped once the undo window plus 2 s of slack is over). So nothing is lost when the panel closes: a panel opened during the window shows the toast again (`trash.list`, titles only), and Undo (`guide.restore`) works from it. Restore refuses after the window, and never overwrites a guide with the same id that came back meanwhile (an import or a library refresh). The trash is in `storage.local`, which content scripts cannot read (TRUSTED_CONTEXTS).
- **Steps**: deleting a step in the editor shows the same toast in the editor's sticky bar; Undo puts the step back at its place in the draft. It is a draft change like any other, so closing the editor discards it with the rest of the unsaved edits; the stored guide still has the step until Save. The step toast goes when the editor closes.
- **Toast**: one at a time, a polite live region that stays mounted. Focus moves to Undo, because the control that was pressed has gone; when the toast disappears with focus on it, focus goes to the list or Steps heading. Dismiss (×) is a separate button.
- **Messages**: `guide.restore`, `trash.list` (extension pages only). `guide.delete` now answers `{ ok, undoUntil }`.
- **Fixes from the independent review**: expired trash entries are removed from storage (by `trash.list`, at browser start and install, and on every delete or restore), not only hidden, so a deleted guide does not stay on disk. After Undo, focus goes to the restored guide's Start button; the list headings take focus when the toast expires. A toast the panel already showed (dismissed, or used) does not come back when the library mounts again, for example after closing the editor. Any side panel opened during the 8 seconds shows the toast, in any window. Saving the guide ends the step's Undo.

### D101. Completed guides, Restart, and Start from step N
*5 Nov 2026 · SPEC: User flows (Play, step 7: "completion is saved locally"); Side panel*

- **Checkmark**: the library shows a green **Completed** badge on guides the learner has finished (the `completions` list the player already stores; `completions.list` sends only guide ids and the last time). A finished guide's Start button reads **Restart** (same action: start from step 1).
- **Restart** in the "playing" card starts the run again from step 1 (it goes through `run.start`, so a learner on another page is offered the start page). When the run has finished, the card's Stop reads Close.
- **Start from step N**: the row's More menu has a step picker (titles from the guide index, D49, so no full guide is read) and "Start from step N". `run.start` takes an optional `stepIndex` (0–499). The learner must be on that step's page: only the start page can be opened for them (D33, D36), so otherwise the panel says "Step N is on a page like `/x`. Open that page, then press Start from step N." A choice larger than the guide's step count (the guide got shorter) is clamped to the last step.
- **Completion**: a run that started at a later step and reached the end counts as finished, like any other run (the learner did reach the end).
- **Review fix**: the guide index keeps each step title on one line (line breaks become spaces), so a title typed with a line break no longer shifts the "Start from" labels of the steps after it.

### D102. Tag filter chips, and tags in the editor
*5 Nov 2026 · SPEC: Discovery ("Side panel": search over title, description, tags and step titles); Data model (`tags`)*

- **Chips**: under the search box, one toggle chip per tag (`aria-pressed`), with its guide count, sorted by count, at most 30. Tags are compared case-insensitively. A guide must carry every selected tag, and the chips combine with the search. Clear resets them. A chip whose last guide went away stops filtering.
- **Editor**: guides had `tags` in the data model and in packs, but no way to set them. The editor gets a Tags field (comma-separated; trimmed, de-duplicated, at most 20 of 100 characters). 20, not the schema's 50, because the guide index keeps 20 (D49) and the chips work from the index; an imported guide with more keeps them, but only the first 20 filter. Tags are already in the export review, so a pack never carries a tag the author didn't see.

### D103. Duplicate guide and duplicate step
*5 Nov 2026 · SPEC: Side panel; User flows (Edit)*

- **Guide**: Duplicate was offered for team guides only. Local guides get it in the row's More menu: the same `guide.duplicate` (a new id and revision, "(copy)" in the title, `forkedFrom` set, version 1). The copy is not opened in the editor; the panel says "Made a copy: …".
- **Step**: each step in the editor has Duplicate, which inserts a deep copy with a new step id right after it. The target is the same element, so the author usually edits the title or re-picks.

### D104. Export a guide as a text how-to
*5 Nov 2026 · SPEC: Sharing and storage ("Before export, show a review…"); Security*

- **Formats**: the export review now starts with a choice: Guide pack (`.waymark.json`, as before), How-to (Markdown, `.md`) or How-to (printable page, `.html`). A how-to has the guide title, the description, "Start at <origin>" and numbered steps with their titles and notes. Several selected guides make one file with a section each.
- **What it leaves out**: no screenshots (Waymark has none), no selectors or element labels, no voice text, no tags, and no address except the start page's origin. A Markdown link in a title or note keeps only its text. A bare address on the start origin is cut to that origin, and any other address becomes "[link removed]" (`stripUrls`).
- **The same review**: the list shows exactly what the how-to will contain (`howtoStrings`, the same keys as `packStrings`), and the same removals apply (`applyRemovals`), so a note removed for the pack is removed from the how-to too. Titles can't be removed there; they are changed in the editor, as for packs.
- **Data-like filter**: rows whose text looks like data, by the recorder's own `isDataLike` filter (D66), get a "Looks like data" badge, and a warning above the list counts them. That covers emails, amounts, dates, codes and phone numbers. Long notes are checked four words at a time, because the filter calls anything over 80 characters data. The warning shows for packs too, on text kinds only (not addresses or selectors).
- **Fixes from the independent review**: addresses are removed from the raw text *before* the markdown is parsed, so `_` or `*` inside an address can't split it into pieces that slip through (`…/q3_customer_list`, `https://**evil**.com`). Matching now covers any `scheme://`, a protocol-relative `//host`, `https:host` and other schemes without `//` (ftp, file, javascript, data, mailto…), `www.`, a bare host with a path (`jira.corp.example/browse/FIN-1`), a scheme glued to a word (`see_https://…`) and escaped colons (`https\://`). Markdown output also escapes `< > & \` | ~` and any line start that would make a heading, quote, list, rule or table, so raw HTML, entities and a description from an imported guide can't change the document. A single word longer than 80 characters (an API key) is flagged as data.
- **HTML**: one standalone page built as an escaped string. Every user string goes through `escapeHtml`, and only `<strong>`, `<em>` and `<br>` come from the markdown subset. It has no script, no links and no remote resources, and a `default-src 'none'` CSP meta tag. Print styles drop the footer; dark mode applies on screen only. The file is downloaded like a pack (Blob, `a[download]`); no new permission.

### D105. Keyboard shortcuts to record and to open the side panel
*5 Nov 2026 · SPEC: Accessibility (shortcuts the user can change); Recorder*

- **Commands**: `toggle-recording` (suggested Alt+R) and `_execute_action` (suggested Alt+W, the toolbar button's own command, which fires `action.onClicked` and so opens the side panel). Chrome allows four suggested keys; with Alt+. and Alt+, these are all four. Exit guide still has none. Users change them at `chrome://extensions/shortcuts`; Settings → About lists all five. As before, no Alt+Shift combinations.
- **Toggle recording** (`src/background/shortcuts.ts`): it stops the running recording, wherever it runs, or starts one in the tab the key was pressed in, through the same `rec.start` / `rec.stop` handlers as the panel's buttons. No recorder code changed. A shortcut recording is called "Untitled guide" (the recorder's default for an empty title). The side panel opens at once, before any await, while the key press still counts as a user gesture. That way the live steps show, and after Stop the panel opens the editor, as the Stop button does. The panel learns what happened from the session key `shortcut:last`, and reads it once at start if it is under 5 s old, because the shortcut may open the panel after it was written. A refusal (a site Waymark is not allowed on, no web page) shows in the panel as "Recording didn't start: …". Browsers without a side panel have no way to open the popup from a command; there the REC pill and the badge show the state.
- **Fixes from the independent review**:
  - Stopping with the shortcut never replaces unsaved edits in an open editor. The panel says the new guide was saved and offers "Open it (discard edits)". The editor also keeps its unsaved draft while a shortcut recording runs; before, it was reloaded when the editor came back.
  - Only the side panel of the window where the key was pressed follows the outcome (`windowId`), so two panels don't both open the editor.
  - The panel acts on the outcome even while the Recorder isn't shown (the active tab's site isn't allowed); the editor opens once it is.
  - A quick double press is handled in order: start, then stop, never two starts.
- **No new permission**: `commands` is a manifest key, not a permission, and a command grants activeTab, as a toolbar click does.
- **E2E**: Playwright's key events go to the page through CDP and never reach browser accelerators, so the test presses the real keys through XTest under Xvfb. `x11-keys.py` now takes chords such as `Alt_L+r`.

### D106. Tooltip: Replay voice and Repeat step
*5 Nov 2026 · SPEC: Player and overlay; Voiceover*

- **Buttons**: the tooltip header has Repeat step (rotate icon) and Replay voice (speech icon), before Mute and Exit, with labels and titles. Test step's highlight in the editor uses the same tooltip without them.
- **Replay voice** sends `run.replay` (content scripts; Zod-checked). The service worker reads the stored voice text of the run's current step again, only for the sender tab's own run, only if the step id is the current one and the sender's origin is one of the guide's, and at most every 400 ms, so a page can't keep the voice busy. It speaks even when "Read each step aloud" is off (the learner asked), but never while muted: the button is disabled then, and labelled "Replay voice (voice is muted)".
- **Repeat step** searches for the element again, redraws the spotlight with its pulse, scrolls the element back into view if needed, announces the step again and reads it again (the same `run.replay`). The run does not move. A keyboard user's focus stays on the button after the redraw. A mouse press never takes focus, as before.
- **Fixes from the independent review**: Replay voice is `aria-disabled` while muted, not `disabled`, so it stays in the tab order and its "(voice is muted)" label can be heard; a press does nothing. Focus goes back to Repeat step only on a redraw of the same step: a Repeat that ended on the not-found card no longer pulls focus out of the page on a later step. The e2e test counts redraws (`data-waymark-test-draws`).
- **Fix found on the way**: the mute toggle held the muted state of the moment the step was drawn, so a second press in the same step sent "mute" again, and the button didn't change until the next step. The tooltip now updates mute and Replay voice in place when a new view arrives (`setMuted`), and the toggle reads the current state.

## 2026-11-05 — Debug log (issue #33)

### D110. A debug log of what the recorder, matcher and player decided, off by default
*5 Nov 2026 · SPEC: Architecture ("Messages", service worker keeps no state); Permissions, privacy and security; docs/SECURITY.md ("nothing about the user's pages goes to logs")*

- **Why**: testers on real apps (#32) could only describe what they saw. A log they can paste into a chat shows why Waymark chose an element, why a step didn't move on, or why it wasn't read aloud.
- **Switch**: Settings → Problems → **Keep a debug log**, off by default, stored as `debugSetting` in `chrome.storage.local` (`{ on, since }`). The service worker caches it and follows `storage.onChanged`. Content scripts learn it from the reply to their route report (a new `debug` field) and from a `debug.changed` push to every tab when it is switched.
- **Buffer** (`src/core/debug/log.ts`, pure): one ring of 2,000 entries for all tabs, in `chrome.storage.session` (`debugLog`), so it is gone when the browser closes. Each entry: time, tab, frame, the page's origin (or none for run and voice entries), a source (`rec`, `match`, `play`, `voice`, `run`, `frame`, `page`), an event name and a few values. The values are stored as ordered pairs, because `chrome.storage` sorts object keys and the order is part of the line.
- **Off means off**: the service worker's `dlog` and the content script's `dlog` return before building anything (callers pass a function for the data). Nothing is stored and no message is sent. E2E and unit tests check the storage key stays absent.
- **Never in the way**: entries wait in memory (250 ms in the service worker, 300 ms or 50 entries in a page) and are written in one batch on the log's **own** queue, never `enqueue`. A slow log write can't delay or reorder recording and runs (D67). Recorder entries in the service worker are written inside `mutate`, which adds no await. Every logging call is wrapped so it can't throw into the recorder or player. The in-memory wait is the one exception to "no state in memory": an entry still waiting when the browser stops the service worker is lost, which is fine for a debug log.
- **What is logged**:
  - **Recorder** (content): the resolved target (tag, low-confidence, interactive) and why a card was or wasn't promoted to a region (D82; `clickableRegion` and `promoteToRegion` take an optional `why` callback that never changes their result); skips (D47) with the signals it had; ignored clicks (script clicks, double-clicks, content inside a control, a click back into a typed field); merges (label + control, submit button + submit, select changed again, press linked to an ancestor click, D61); each emitted step with its kind, title, flags, signal names, `instance` and look-alike count. **Recording** (service worker): each step accepted or refused, and why; navigate steps added or not, and how many a click took back (D67).
  - **Matcher and player** (content): each search (signals present, frame, whether the frame path matches), the result: found with score, margin, matched signal names, how and how fast; or not-found with the reason in words, best and runner-up scores and the margin. The advance listeners attached. Every click within 120 px of the target, or after a press on it, and why it did or didn't count; why the step advanced; cards shown and why. **Frame board** (service worker): every frame report and the winner after it; stale and ignored reports.
  - **Run** (service worker): start, step changes (from, to, cause), refused operations, catch-up (D32), moves to a new tab, resume, end and why; page loads and route changes of the top frame.
  - **Voice**: waiting for the element (D83), due, started (engine and language, never the voice's name), silent and why (muted, auto-play off, not the focused tab, not the guide's site, no voice), stopped and why, HD outcome and fallback.
- **Messages**: `debug.get`, `debug.set`, `debug.text`, `debug.clear` (extension pages); `debug.log` (content scripts: 1–50 entries, event names `[a-z][a-z0-9.-]{0,39}`, at most 16 values each, strings ≤ 2,000 before the 200-character clip, no `run` or `page` source). The service worker takes the tab, frame and origin from the sender, never the payload, and accepts at most 100 content entries per tab per second; the rest are dropped and counted in the header.
- **Copy debug log** (Settings): a header (Waymark version; browser, version and OS; when the log was turned on; voice settings as on/off and numbers; whether a team library is subscribed, never its address; the number of site permissions; the recording and runs at copy time, as step numbers), then one line per entry, oldest first, newest last, times in UTC.
- **Found with it on the way** (not changed here): after each search, a frame reports its match, then `render()` reports it again because the view still has no winner. Every frame so sends two `run.match` per step; the board ignores the duplicate. The log only calls a re-send "report.again" when a view arrives without a winner after the search.

### D111. The not-found card's Copy log holds only that page's part
*5 Nov 2026 · SPEC: Security (content scripts receive only data for their own origin); docs/SECURITY.md*

- While the debug log is on, the not-found card has a **Copy debug log** icon button (copy icon, with its name as label and title) next to Report broken step, so the row still fits on one line. A content script may not be sent settings or other sites' data, so `debug.copy` answers only the top frame of a tab whose current run's guide includes the sender's origin, and only with that tab's entries since the run started (minus a second), about the sender's own site or about the run itself. The header has the version and browser, no settings, and points to Settings for the full log.
- The page writes the clipboard (`navigator.clipboard.writeText` from the click). A page whose permissions policy blocks it gets "Couldn't copy here. Use Settings → Problems → Copy debug log." (a warning-coloured message).

### D112. Privacy rules of the debug log
*5 Nov 2026 · SPEC: Permissions, privacy and security; docs/PRIVACY.md*

- **No typed values**: no code path logs a field's value; `hasValue` is only ever logged as "empty" or "filled". As a second line, keys such as `value`, `typed`, `password`, `query`, `search`, `hash`, `href`, `textContent` are dropped from every entry, whoever sends it. E2E types a unique string while recording and playing and checks it appears nowhere in either copy.
- **No page text** beyond what the guide stores: step titles (already filtered) and the guide's own title; otherwise tags, roles, signal names, scores and reasons.
- **Addresses** are the site and the path normalized like step URLs (`normalizePath`: numbers, ids, emails and other data-like segments become `:id`), with no query or fragment (`redactUrl`; any `url` or `path` value is redacted again when stored).
- **Session only**: `chrome.storage.session` (gone when the browser closes), a **Clear** button, and turning the switch off stops collecting at once (what was collected stays until Clear or the browser closes, so it can still be copied).

### Fixes from the independent review (D110–D112)
Each has a regression test that fails on the first version (`test/unit/debug-log.test.ts` "review fixes", `test/browser/debug-log.test.ts`).
- **Size** (medium-high): one entry could hold 16 lists of 20 × 60 characters (~20 KB), so a forged page at the allowed rate could fill the 10 MB session area in seconds and break runs and recordings in every tab. The `debug.log` schema now has the same limits as the clean-up (strings 200, lists 20 × 60), and a stored entry is at most 1 KB (values past it are left out and the entry says `truncated=true`). 2,000 entries stay near 2 MB.
- **Flooding** (medium): the per-tab rate only applied when a batch was written, and the waiting queue evicted its oldest entries, so one page sending many batches between two writes pushed out every other tab's entries. The rate now also applies when entries arrive (at most 100 waiting per tab), and a full queue drops the new entry, never an older one.
- **Another site in a page's copy** (medium): `run.start` names the page the tab was on when the guide opened its start page (any site), and had no origin, so the not-found card's copy on the guide's site could include it. `run.start` and `run.moved` now carry that page's origin, and the page's copy leaves them out.
- **Page-written roles** (low): a near-miss click logged the element's raw `role` attribute, which a page can fill with any text. Roles are logged only when they are WAI-ARIA role names (`ariaRole`), also in the recorder's facts.
- **Step rules** (low): `page` and `expected` values (step URL rules) are logged without a query or fragment, like every address.
- **Clear and off** (low): Clear stores its time, and entries from before it, still waiting in a page, are dropped when they arrive. Turning the switch off stops collecting before the setting is written.

## 2026-11-05 — UX for first-time users (issue #37)

The audit, the first-time-user walkthrough and the plan are in `docs/UX.md`.

### D120. One primary action per panel state; site options folded away
*5 Nov 2026 · SPEC: Side panel; Permissions ("Site access")*

- On an allowed site, the site card is one line: the site, the Allowed badge and **Site options**, a disclosure (`aria-expanded`). Inside it are the `?` button switch (now with one line saying who it is for) and **Turn off Waymark on this site** (was "Remove access", red, next to the switch and above Record). Turning a site off is never next to the primary action.
- On a site that isn't allowed, the card says "Waymark is off on this site", the badge says **Off here** (was "Not allowed", which read as an error), with **Allow on this site** as its only button and a "?" that explains what Allow does.
- With no web page, the empty state says what to do ("Open a web app to get started") and that the panel follows the tab.
- The recorder card is titled **Record a guide**, with "Guide name" (was "New guide") and one line on what happens next. The recording card says what Stop does (saves and opens the editor). The playing card shows the current step's title.
- **Test change**: e2e opens **Site options** before using the launcher switch.

### D121. The welcome is one card
*5 Nov 2026 · SPEC: Discovery ("First-run access"); D92*

- The three cards with Back / Next / step tabs / Skip become one card that lists Allow, Record and Play at once, with **Get started**. Reading three sentences took up to five clicks. It still shows once (`ui:welcomeDone`), and Help → **Show the welcome again** brings it back.
- **Test change**: m0 clicked `welcome-next` three times; it now checks all three words and clicks `welcome-done` once.

### D122. Help: a header button and inline "?" disclosures
*5 Nov 2026 · SPEC: Side panel; Accessibility*

- The header gets a **Help** icon button next to Settings. It opens a Help card: Show the welcome again, Keyboard shortcuts and Something isn't working (each opens Settings at that section, `options.html#about` / `#problems`; Settings scrolls to and focuses the section heading), and **What the warnings mean**, every warning in one place (the recorder flags, Not recorded, Found but it may break, Can't find this step). Before, that list was only in `docs/TESTING.md`.
- Inline help is a small "?" button (`HelpTip`) next to a concept: Allow, sharing. It is a disclosure (`aria-expanded`, `aria-controls`) that shows one or two plain sentences in place, never a hover tooltip, so keyboard and touch users reach it.

### D123. Names people read
*5 Nov 2026 · SPEC: UI copy (D94)*

- Sites show as their host (`app.example.com`, or `127.0.0.1:8093`), in the normal font, not as a monospace origin with `https://`. The full origin stays in the `title`. Pure helper: `siteLabel` in `src/core/text/names.ts`.
- Settings shows language names ("English (en)", `Intl.DisplayNames`), shortcuts as "Exit the guide: no key set" (was "not set Exit the guide"), and the debug log says "paste it into your bug report" (was "into the chat").
- Other copy: "guide file" for a pack everywhere a person reads it ("Waymark guide file", "Download guide file", "Import a guide file", "Address of the team's guide file"); "Spoken text" for voice text; "Go to the next step: when the learner does it / when the learner presses Next" for "Moves on"; "Optional (learners may skip it)"; plainer recorder warnings that say where to fix them; Test step's "Found on this page." / "Found, but it may break." with the matched clues folded under "How Waymark found it", in plain words. Team library and HD voice are explained for people who don't know the terms; where the HD voice downloads from is folded away.

### D124. Library rows: Edit, More, Start; export picks guides only when asked
*5 Nov 2026 · SPEC: Side panel; Sharing ("Before export, show a review")*

- A row shows the title and its badges, then **Edit** (with its label), **⋯ More** and **Start**. The export checkbox and the unlabelled Copy link icon are gone from the row. More now holds Start from step, **Share…** (the export review for that guide, the common case), **Copy link**, Duplicate and Delete. The "Delete" button that appeared only with one guide ticked is gone (Delete is in More).
- **Export…** under the list enters a selection mode: checkboxes appear on the rows, with "Select the guides to export", **Export n selected…**, Select all / none and Cancel. After the review, the panel leaves selection mode.
- **Test changes**: e2e clicks `export` (enter selection), ticks the guide, then `export-selected`; Copy link (`link-<id>`) is clicked after opening More; q2's second export goes through Share….

### D125. Editor: steps fold to one line
*5 Nov 2026 · SPEC: User flows (Edit); D91*

- The editor showed every field of every step: a 7-step guide was 4,400 px tall at side-panel width. Each step is now a header (number, kind, warning badge, Move up / down, Delete) and its rendered title as a toggle button (`aria-expanded`, `aria-controls`). Opening it shows the warnings explained, Title (with how to make text bold), Note, Test step, Re-pick element and **More options**, which holds Spoken text, Go to the next step, Optional, Add a note after and Duplicate. The same guide is now 2,000 px tall, with two steps open.
- Steps the recorder flagged start open, so the author sees what needs attention. A new note step opens unfolded. "Open all steps / Fold all steps" sits next to the Steps heading. A step being re-picked stays open. The Test step result and the pick banner stay outside the folded part, so their live region stays mounted (D91).
- The Version badge is gone from the editor (the version is still in "Saved (version n).").
- **Test changes**: e2e and browser tests open a step (`step-N-toggle`) before using its fields, and More options (`step-N-more`) before Optional, Add a note after and Duplicate.

### D126. Export review: element paths under "Technical details"
*5 Nov 2026 · SPEC: Sharing ("show a review of everything the pack contains")*

- The first-time-user walkthrough found the review to be "a wall of code": every step's CSS and XPath ("Element path /html[1]/body[1]…") and link paths, each with Remove, among the titles and notes. Those kinds (`selector`, `link`) are now listed under a closed **Technical details (n): how Waymark finds each element**, with a line saying they rarely hold private data and what removing one does. Nothing is hidden from the file or from removal: every row is still listed and removable, and the export is unchanged. Texts stay raw (not rendered as markdown) because the review shows the file word for word, and rendering a link would hide its address.

### D127. The tooltip says what to do on the page
*5 Nov 2026 · SPEC: Player and overlay; D93*

- An action step's tooltip (click, select, check, submit, navigate that moves on by itself) has no Next button, and the walkthrough persona got stuck on step 1 waiting for one. Under the title it now says, in the accent colour: "Click the highlighted element to continue." (or "Choose an option…", "Tick or untick it…", "Send the form…", "Go to that page…"). The pure helper is `actionHint` in `src/content/player/ui.ts`. It shows only in a real run, never in the editor's Test step highlight (which has no voice handlers). Input steps already have Next. Nothing about advancing changed.
- **REC pill**: a notice wraps onto a second line instead of being cut off ("Not recorded: … Click a button, link or field." was cut after "Click…").
- **Deep-link offer**: it sat at the same corner as the `?` launcher, which covered its Start button. It now sits above the launcher, like the launcher's menu.

### Fixes from the independent reviews (D120–D127)
A design and accessibility review of the code, and a second first-time-user walkthrough of the new screenshots. Regression tests are in `test/browser/panel-clarity.test.ts` ("review fixes").
- **Focus** (high): Export… replaced the button that had focus, so focus fell to the page. Focus now moves to the selection bar, which is labelled by its instruction, and Cancel or the end of the review puts it back on Export…. Dismissing the welcome focuses the guide name field (or Allow) first, in that order. Before, a selector list picked the first match in page order. Escape closes Help.
- **Link inside a button** (high): the step toggle rendered a title's markdown link as `<a>` inside the button. Titles in the toggle show links as their text (`Markdown noLinks`).
- **"pagesYour"** (high, both reviews): the `?` button switch's explanation ran into its label because `.hint.block` existed only in Settings' styles. It now exists in the panel's styles too.
- **Select all** picks only the guides on screen (search and tags can hide some) and says "Select all N shown" when the list is filtered.
- **Open all / Fold all** counts the steps there are; a deleted step's id no longer counts as open. The toggle is disabled while its step is being re-picked.
- **Warnings** no longer say "In the editor" (they are shown in the editor too). While recording, a warned step adds "You can fix this in the editor after you press Stop."
- **Tooltip hint**: it is in the tooltip's `aria-describedby`, and input steps get "Fill in the highlighted field to continue."
- **Recorder**: while paused, the hint says clicks aren't recorded and what Resume and Stop do. While a guide plays, the Record card is hidden, so it doesn't invite recording during playback. The playing card's "Now:" line wraps instead of being cut off.
- **Copy**: "Open the web app you want to guide" (the no-site empty state said "get started" right under the welcome's Get started). Settings → Sites says **Turn off** (as the panel does). Import errors say "guide file", not "pack". The broken-step confirmation says the Problems list is in Waymark's Settings. Help's Settings links say they open a new tab (visually hidden text). The bold tip reads "to make words bold, put two stars on each side: **like this**".
- **Layout**: "Go to the next step" stacks its label above a full-width select, which was cut off. Export checkboxes are 20 px. In forced colours the step toggle has a border. Site options stay open only for the site they were opened on.
- Not changed: the stitched full-page editor screenshot shows the sticky header and Save bar over the content. That is how a full-page capture draws sticky elements, not a layout bug (the design review checked). The not-found card, "Done" card counter and tooltip icon labels are the player's (D93/D106) and keep their accessible names and titles.

### D128. Built-in tutorials play on a bundled Practice page
*5 Nov 2026 · SPEC: Discovery; Player and overlay; Permissions (no new permission); issue #37 open question*

- **Where they play.** Guides play through the content script, which only runs on sites the user allows; extension pages never get one, and built-in guides must never touch real sites or ask for access. They play on `practice.html`, an unlisted extension page shaped like a small invoicing app ("Northwind Invoices", clearly marked Practice; nothing typed is kept, `autocomplete="off"`). Options weighed in `docs/UX.md` section 5.1: the demo app (needs a server and a grant), note-only guides (nothing to try), and a separate tour player for the panel (a second player; deferred).
- **The real player.** The page imports `PlayerUI` (spotlight, tooltip, cards), `waitForMatch` (the matcher) and `watchAdvance` (the advance rules) as libraries, driven by a small local run loop (`src/core/tutorials/runner.ts`, pure) in place of the service worker's run state. Each step's fingerprint is built from the live practice element (`buildFingerprint`) and found by the matcher; a browser test checks that every tutorial target is found uniquely. Nothing touches `runs.ts`, the frame board or registry, the recorder, or other tabs. The page's own off-track case (the learner opens another view of the app) shows the real off-track card, and Go back returns to the step's view; a target that isn't on the page (the warnings tutorial's demo) shows the real not-found card after 2.5 s (a real page waits 8 s). Report on that card explains what it does on real guides instead of saving a problem.
- **The pack.** `src/core/tutorials/pack.json`, five tutorials of 5–7 steps (How Waymark works, Record your first guide, Edit a guide, Share a guide, What the warnings mean), validated by `TutorialPackSchema` (ids unique, action steps have a target, targets are `practice-*` / `pic-*` names). Steps that explain the side panel point at a clearly labelled picture of it on the page ("Picture of the Waymark side panel"), not at real controls.
- **In the panel.** A **Tutorials** section (Built-in) lists them in every state, after the guides; it steps aside while recording or editing. **Start** opens the practice page in a new tab (`chrome.tabs.create`, no permission). **Hide** stores `ui:tutorialsHidden` in `storage.local`; Help → "Show the tutorials again" brings it back. The welcome has **Try a tutorial**, the no-site state **Or try a tutorial**, and Help **Tutorial: how Waymark works (1 min)**: one name, "tutorial", everywhere a person reads it.
- **Read-only, never guides.** Tutorials aren't stored: they don't count in the library, search, "For this page", badges or exports, and they never ask for site access. **Copy to my guides** (in a tutorial's ⋯) is offered only when the panel's tab is on an allowed site: it imports, through the existing `pack.import`, a local guide on that site whose steps are all note steps with the tutorial's titles, notes and spoken text (practice elements don't exist there, so the copy can never point at a wrong element). The author then edits or re-records it.
- **Size**: the practice page is 81 KB of JS (test build), loaded only when opened; the side panel gained the pack (about 9 KB).

### D129. Tutorial voice: ids in, bundled text out
*5 Nov 2026 · SPEC: Voiceover; Security ("messages are validated")*

- Two extension-page messages, Zod-checked and allowlisted for extension pages only: `tutorial.speak { tutorialId, stepId, explicit? }` and `tutorial.stop {}`. The service worker looks the step up in the bundled pack (`tutorialVoiceText`, the same `voiceTextFor` as guides) and speaks it with the voice guides use (`pickVoice`, on-device voices unless online voices are allowed). Payload keys other than the ids are dropped by the schema, so no page can make Waymark read text of its own.
- Same rules as guides: never while muted; only with "Read each step aloud" on, unless the learner pressed Replay voice (`explicit`). The tooltip's mute writes the shared setting (`voice.settings.set`). HD voice and the page `speechSynthesis` fallback are not used for tutorials: the system voice only.
- Text typed on the practice page never reaches the voice (e2e checks).

### Fixes from the independent reviews (D128, D129)
A design, accessibility and security review of the code, and a first-time-user walkthrough of the screenshots. Tests: `test/e2e/t1-tutorials.spec.ts` (keyboard, Copy, off-track), `test/unit/tutorial-voice.test.ts`, `test/unit/tutorials.test.ts`.
- **Stale tooltip** (high): while the next step was searched, the previous tooltip stayed on screen and its Next acted on the new step, so a double press skipped the not-found demo. The tooltip is cleared at the start of every draw, and a step whose view isn't showing goes to the off-track card at once instead of after the 2.5 s search.
- **Keyboard** (high): focus fell to the page after every step. On this page (ours, not a learner's app) focus now follows the guide: after Start, or a key press in the tooltip, the new step's Next (or the card's main button) gets focus, and an action step focuses the element to act on, so Enter does it. Alt+. / Alt+, / Exit guide reach the page (`chrome.commands.onCommand` in the focused practice page; a shortcut moves on only from steps that have Next, as in the player).
- **Enter sent the form** (high): implicit submission switched views mid-tutorial. Enter in the practice form's text fields is cancelled at keydown (the player still sees it, so a typing step moves on).
- **Off-screen targets** (high, both reviews): at 375 px the panel picture is below the app. The page scrolls the element into view when it's outside the viewport, as the content controller does.
- **Voice**: each step is read once (per step change), only once it's drawn; a card is not read as its step, and Go back no longer draws twice. `tutorial.stop` stops only a tutorial's own speech (a session flag that any other speech clears), so the practice page never cuts off a guide's voice in another tab; closing the practice tab stops its voice.
- **Start/Stop race**: a Stop (or another Start) while the voice setting is read no longer lets the tutorial start anyway. Stop in the list ends like Exit (status, focus on the Tutorials heading).
- **Copy to my guides**: the copy is titled "Draft: …" and starts with a note that says what it is, so practice text never reads as instructions on the real app; Copy says "Copied" after one copy; it checks the site is allowed right before importing, so it can never raise an access request.
- **Names** (walkthrough): one name, "tutorial", everywhere ("Try a tutorial", "Or try a tutorial", Help "Tutorial: how Waymark works (1 min)"). The action hint says "the highlighted item" instead of "element". Hide says (and its description reads) that Help brings the tutorials back, and focus goes to Help.
- **Panel picture**: the caption says it is for reading only and where the real panel opens, and steps that point at it say "(This is a picture: you do it in the real panel.)". tour-4, which explains the tooltip's own controls, is centred instead of pointing at Send.
- **Structure**: the practice page has an `h1`, the practice note is inside `main`, the status line is its own mounted live region (as is the panel's Copy message), the Tutorials heading no longer includes its badge, the current nav item is underlined in forced colours, the chart redraws on a theme change, and an open practice tab is reused (`runtime.getContexts`) so two never talk at once. Help's "Show the tutorials again" works even when the panel opens while recording.

### D130. Motion tokens: short, light, and only transform and opacity
*5 Nov 2026 · SPEC: Accessibility; UI sections (side panel, settings, overlay); issue #43*

- **Tokens** (`src/ui/tokens.css`, the same file the overlay uses): durations `--wm-dur-press` 80 ms, `--wm-dur-fast` 120, `--wm-dur-base` 180, `--wm-dur-slow` 240; easings `--wm-ease-standard`, `-enter` (decelerate), `-exit` (accelerate) and `-spring` (a small overshoot, for ticks and released presses); distances `--wm-move-sm/md/lg` (2/4/8 px), `--wm-lift` (−1 px) and the press scales `--wm-press` (0.97, buttons) and `--wm-press-lg` (0.99, rows and cards, where 3% is a visible jump). D90's `--wm-ease`, `--wm-fast`, `--wm-slow` stay as aliases. `src/ui/motion.ts` mirrors the numbers for JS; a unit test keeps them equal and in the 80–240 ms range.
- **Reduced motion is a token path.** Under `prefers-reduced-motion: reduce` every distance is 0, every scale 1 (also `--wm-press-sm` for checkboxes and the switch thumb, `--wm-arrive` for the toast), the tick's pop-in transform is `none` (`--wm-pop`) and the spring is the standard curve, so each animation that moves becomes a plain fade. State changes that travel (the switch thumb, a turning chevron, a progress fill) jump; endless ones (spinners, the REC halo) are off in their own rules, and focus rings don't animate. JS checks the same query (`reducedMotion()`) and skips glides.
- **What animates.** Transform and opacity only, so the compositor runs it and nothing triggers layout. Two paint-only exceptions are kept on purpose: the background and border fades D90 already had on hover (still only when motion is allowed), and the focus outline settling in from 5 px out (outline never affects layout; the alternative, a pseudo-element ring on every control, would cost more than one 120 ms paint). Box-shadow only animates in the spotlight ring's existing pulse (D93). A unit test finds every stylesheet (and every TS file with CSS in a string: the overlay, the launcher) and fails on any other transitioned or keyframed property, or `transition: all`; it reads every word of a transition, so `transition: 120ms ease height` fails too, box-shadow may never be transitioned, and neither may `color` (see D132). The switch's thumb used `left` with `transition: all`; it now moves with a transform.
- **No library and no lasting `will-change`.** CSS does almost everything; the rest uses the Web Animations API (`element.animate`), which runs transform and opacity on the compositor and leaves nothing behind when it finishes (no fill, no `will-change` to forget). Hover shadows that should grow fade a pre-drawn shadow layer's opacity instead of animating `box-shadow`.

### D131. Panel, Settings and Practice page feedback
*5 Nov 2026 · SPEC: Side panel; Settings; issue #43*

Only looks and motion change: no message, handler or stored value does, except the focus fix below.

- **Press**: every button (and file-picker labels) shows a pressed-in inner shade; with motion allowed it also squeezes to 0.97 in 80 ms and springs back on release (full-width buttons, step toggles and Help links: 0.99). Checkboxes and radios squeeze on press; the switch's thumb slides with a slight spring and squeezes while held.
- **Hover**: rows and cards you act on (library and tutorial rows, export format cards, the Practice page's tutorial list) lift 1 px and their shadow fades in (`.lift`; only on devices that really hover). Editor step cards don't lift: you type in them.
- **Focus**: the ring settles in once per focus (120 ms).
- **Folds**: step bodies, More options, the library's More panel, Site options, inline help, the Help card and every `<details>` settle in from 4 px above with a fade (`.unfold`). The chevrons turn instead of swapping icons. Folding back is instant (an exit would mean keeping removed content around).
- **Lists**: a new row rises in (`enter`): a recorded step in the live list, a guide restored with Undo or brought back by a filter, the steps when the editor opens. Move up / Move down glide the two rows that swapped (FLIP, `useFlipList` in `src/ui/useMotion.ts`). What the bench taught:
  - measuring the list on every render (each keystroke) and gliding every row a delete shifted dropped frames and caused long tasks at 4× slower CPU, so the hook measures only when the order changes and moves only the rows whose order changed; rows shifted by a delete or Undo snap;
  - reading the new layout inside the click forced it there (long tasks); the glide now starts in the next frame's animation callbacks, before that frame's layout and paint, so the new order is never painted unmoved;
  - a second Move during a glide cancels the running glide and starts from where the row is drawn.

  Only keys new in a render get the entrance class: Preact re-inserts a moved row, which would restart a CSS entrance (the frame sequence caught it fading out mid-glide). Library rows never glide: search results are sorted by score, so their order changes with every keystroke, and rows must not slide under the cursor.
- **Toast**: slides up with a small spring; when it goes, an inert, `aria-hidden` copy fades and drops for 120 ms. Focus goes where it always did (D100) before the copy appears, and the live region's text is unchanged, so screen readers hear exactly what they did.
- **Success ticks**: a check pops in (spring) next to "Saved (version n).", the library's messages (Link copied, Restored, Imported, Made a copy), the tutorials' "Copied", and Settings' Copied buttons (the label swaps with a quick rise); the Completed badge's check pops when a guide is finished while the list is open (guides already finished when it was shown don't pop, so opening the panel or returning from the editor is quiet). Only success messages get a tick (not "Imported 0 guides…" or "Nothing was copied."). Status lines and alerts fade in.
- **REC**: the panel's REC dot no longer blinks; a soft halo grows out of it and fades every 1.6 s (transform and opacity, low contrast: nothing flashes). The playing card's progress fill eases with `scaleX` instead of a width.
- **Practice page**: its views (Dashboard, Invoices, New invoice) only fade in, and its rows don't lift: the player may be measuring what is in them, and a transform would move a target under the spotlight. The "sent" banner's check pops.
- **Focus fix**: Move up / Move down dropped focus to the page, because Preact re-inserts the moved row. The pressed button gets focus back after the move (or the other arrow, when the step reached the top or bottom). Found while testing that animations never take focus; the browser test fails on the old code.
- **Tests**: `test/unit/motion.test.ts` (tokens, reduced-motion values, allowed properties), `test/browser/motion.test.ts` (FLIP moves only what moved and nothing under reduced motion or a scroll, a second move mid-glide, focus after Move down, unfold and chevron, the toast's inert exit copy and focus, no exit copy under reduced motion, nothing moving under reduced motion, no glides while searching, the Completed tick).
- **Fixes from the independent review** (motion, accessibility, performance; each test fails on the first version): reduced motion still moved ticks, chevrons, the switch thumb, pressed checkboxes, the toast's scale and the progress fill; library rows glided on every search keystroke; the stylesheet scan only read a transition's first word and missed the launcher; the Completed check popped on every mount; a second Move mid-glide jumped; ticks showed on "Imported 0 guides" and similar; the screens script's `finish()` threw on endless animations; the focus animation is now `:where(:focus-visible)` so it never outranks a component's own animation; the bench used `element.click()` (no hover or press) and had no reorder scenario.

### D132. Measuring motion: `pnpm motion:bench` and frame sequences
*5 Nov 2026 · issue #43 ("60 fps on a low-spec laptop, test with 4× CPU throttling")*

- **`pnpm motion:bench`** (`test/bench/motion.bench.ts`, its own Playwright config, not in CI) builds the test extension and, under Xvfb with the CPU slowed 4× (CDP `Emulation.setCPUThrottlingRate`), plays each animation several times with real mouse clicks (so hover and press run too) while recording every frame's interval (requestAnimationFrame: the main thread's cadence) and long tasks and long animation frames (PerformanceObserver): the editor's fold, the step-delete toast and Undo, Move down / Move up, and the spotlight moving between steps on the Practice page (the real player). Each runs again under reduced motion as the control, since the clicks themselves cost main-thread work. Results: `artifacts/motion/bench.md` and `.json`.
- **Frame sequences**: `test/screens/motion.spec.ts` (part of `pnpm screens`) pauses each animation as it starts and scrubs it to 0, 40, 80, 120, 180 and 240 ms with Web Animations `currentTime`, so the frames are exact on any machine; `scripts/frames.py` makes a labelled strip and a GIF in `docs/screenshots/<dest>/`.
- **What it found**, besides the list fixes in D131: a `color` transition on buttons (added with the press feedback) restyles every icon inside on the main thread each frame, and buttons transitioning at all under reduced motion made the reduced runs slower than `main`. Buttons now fade only background and border, only when motion is allowed, and the stylesheet test bans `color` transitions.
- **Result** (10 rounds, against the same bench on `main`): with motion, Move up / down misses more frames than `main` (about 18–21 frames over 25 ms in 20 presses, against 5–8), with long tasks at 0–2 in both; that is the glide and the press, composited in software. Fold and toast are within the noise of `main`. Reduced motion is at `main`'s level.
- Xvfb has no GPU, so frames are composited in software; a real laptop with a GPU does better. Frame counts over 25 ms vary by a few between identical runs (they appear with reduced motion too), so the bench reports them next to the control rather than as a pass/fail.

### D133. On-page player motion: a gliding ring, a rising tooltip, a click ripple
*5 Nov 2026 · SPEC: Player and overlay; Recorder ("State"); Accessibility; issue #43*

Only looks and motion change: no advance rule, message, timer or run state does. Everything is off under `prefers-reduced-motion: reduce` (as D93), and nothing waits for an animation: the next step is drawn and clickable the moment it is ready.

- **Spotlight glide.** When a step follows one that was on screen in the last 1.5 s of the same run (and is not a Repeat of it), the ring starts where the last one was and slides and resizes to the new target (Web Animations, one transform, 240 ms). Scaling the ring scales its border and halo too, so it scales only between boxes of about the same size (×0.67–1.5); a bigger change (a toolbar, then an icon in it) slides the ring at its new size from the old box's centre, so no stretched border is painted over the target. A target still off screen (scrolling in) gets the plain fade-in. The dim's hole is around the new target at once, so the target is never covered while the ring travels, and the dim no longer fades in again at every step (the page used to flash brighter between steps). After a card, on another run, or later than 1.5 s, the ring fades in as before.
- **Tooltip.** It rises 4 px into place as it appears (180 ms). When the learner closes the guide (Exit, Esc, Close), it fades up and away as an inert, `aria-hidden` copy with no ids, actions, role or label, so nothing can press it, find it or read it. Between steps the new tooltip replaces the old one at once: the bench showed a copy fading under the new one cost long tasks at 4× slower CPU, for an effect hidden underneath.
- **Progress.** The tooltip's thin bar is a `scaleX` that eases from the last step's value in the same run.
- **"Click registered."** On an action step, a press on the target draws a ring that grows out of the spotlight and fades (240 ms). It is a passive `pointerdown` listener on the target in the capture phase (it never stops or changes the event), it ignores presses from Waymark's own overlay (`isOverlayPath(eventPath(e))`, D86), and the ring takes no pointer events and outlives the step (the next one may be drawn at once). Next steps have nothing to press, so no ripple.
- **Cards**: the done card's check pops in; the not-found card's icon gives one small shake (±3 px, 240 ms).
- **Tooltip buttons** press like the panel's (D131) and their focus rings settle in (outline offset and colour: paint only, the one exception to transform and opacity, as in D130).
- **REC pill**: the dot's blink is replaced by a soft halo that grows and fades every 1.6 s (as the panel's, D131); none while paused.
- **Cost on the host page.** `reducedMotion()` used to call `matchMedia()` on every step, between DOM changes, which made Chromium flush style and layout; it now creates the query once per window and keeps its answer from the change event (the controller's scroll into view uses it too). Bench, Practice page, 4× slower CPU, against PR 1: the spotlight scenario has 3–7 long tasks per 60 step changes (PR 1: 0–4) and more frames over 25 ms (about 66 against 52); p95 stays 16.7 ms. That is the glide, composited in software under Xvfb.
- **Closed root.** Production uses a closed shadow root and test builds an open one (D85). The browser tests run against both (`waymark-test-closed`); an e2e test plays a guide on the fixture site with the closed root and motion on, clicks the targets during the ripple and the glide, and checks the run finishes and that one glide and two ripples ran (test builds count them in `data-waymark-test-motion`, since nothing can look into a closed root).
- **Tests**: `test/browser/player-motion.test.ts` (both roots: glide geometry and the hole at once, when not to glide, no leftover tooltip between steps, the exit copy on close, the progress ease, the ripple never taking the click, focus kept, reduced motion), `test/e2e/p1-player-motion.spec.ts`, and `reducedMotion()` asking `matchMedia` once (`test/browser/motion.test.ts`).
- **Fixes from the independent review** (each test fails on the first version, on both roots): a large size change stretched the ring's border over the target (above); the exit copy went at the first animation ending inside it (the done card's tick), not its own; the same tutorial started again eased its bar backwards from the done card; an off-screen target kept the glide's no-fade classes and popped in; right and middle presses rippled; overlapping Exit timers; the e2e test no longer requires the glide (it depends on timing on slow runners; the browser tests check it); the REC halo grows to 2× (it overlapped the label).

### D134. Launcher motion
*5 Nov 2026 · SPEC: Discovery and hints; issue #43*

CSS only (`src/content/launcher.ts`); no listener, message or focus rule changes.

- The `?` button pops in with a small spring (240 ms), grows a little on hover, squeezes when pressed and fades its colour when the menu opens. The menu and the deep-link offer rise 8 px into place (180 ms). Menu rows and the offer's buttons press like the panel's (D131); focus rings settle in. All on the D130 tokens, transform and opacity only (plus the paint-only colour and outline fades of D130).
- Reduced motion: nothing animates or transitions; a pressed control still shows its inset shade.
- The pop scales about the button's centre, so a press lands while it is still popping in: the closed-root e2e test (#42) no longer waits 400 ms first, and runs twice, with motion and with reduced motion. `test/browser/launcher-motion.test.ts` checks the CSS in a closed root.
- **Keyframe names** (review): the launcher's and the player's stylesheets share the overlay's shadow root, so a `@keyframes` name defined in both resolves to whichever was added last. The launcher's `wm-pop` (a plain pop) and the player's `wm-pop` (the done tick, with a turn) collided, as did `wm-focus-in`. The launcher's are now `wm-launch-*`, and a unit test fails if any `@keyframes` name appears twice across the content-script stylesheets.
- **Found at release (0.4.0)**: the closed-root launcher e2e pressed `?` as soon as the launcher marker appeared. With motion on, about 1 run in 12 the press landed within ~20 ms of the overlay's insertion and went to the page; reduced motion passed 24 of 24. A person can't press a button that early (it is still near-invisible), so the test now waits until the point hits the overlay (`elementFromPoint`), which is still during the 240 ms pop-in. With the wait: 24 of 24 with motion.

## 2026-11-05 — Offer the HD voice when it matters (issue #44)

### D140. The HD voice is offered once, on an extension page, the first time a tutorial or guide speaks
*5 Nov 2026 · SPEC: Voiceover (HD voice); Permissions, privacy and security; issue #44*

- **Not at install** (decided with Thomas on #44): 170 MB before people trust the extension, slow or blocked networks, English only, and it would blur "optional" in the privacy policy and the listing. The gate on #44 ("a step is read within about 1 s on Thomas's laptop") passed, so the offer recommends it.
- **The card** (`src/ui/HdOffer.tsx`): "Try the HD voice. Tutorials (or Guides) sound much better with the HD voice. It runs on your device: one download of about 170 MB, and after that nothing is sent online." Buttons **Listen to a sample** (D141), **Download**, **Not now**, and a line that the usual voice keeps reading and that Settings has the switch.
- **Where** (constraint: the click must ask for the download hosts, which only an extension page can do):
  - the **Practice page**, beside the tutorial list, while a tutorial plays;
  - the **side panel**, under the playing card, while a guide plays on a site.
  - Not in the on-page overlay. A content script can't call `chrome.permissions.request`, and it would need the HD status and voice settings, which never go to content scripts. A guide started from the page (the `?` launcher, a deep link) with the panel closed is not asked; the next time the panel is open during a guide, or a tutorial plays, it is.
  - Not in the welcome either (the issue's optional "quiet tip line"): the welcome shows at install, the moment #44 rules out, and D121 keeps it to three things.
- **When it shows** (`shouldOfferHd` in `src/core/voice/offer.ts`, pure):
  - the browser language (`navigator.language`) is English, and so is what is about to be read (the guide's `lang`; tutorials are English); an unknown language is not English;
  - the device looks capable: `navigator.hardwareConcurrency` ≥ 4, and `navigator.deviceMemory` ≥ 4 GB where the browser reports it (it is Chromium-only and rounded; missing counts as unknown, not small). D51 measured 0.8–0.95× real time on 4 vCPUs, and the model takes about 800 MB while it speaks. The speed check after the download still has the last word ("too slow");
  - the HD voice is off (not ready, downloading, too slow or failed: Settings has Check again and Try again for those);
  - "Read each step aloud" is on, and the voice is not muted (added: someone who muted hears no voice, so the question makes no sense then);
  - not answered yet. **Not now** and **Download** both store `ui:hdOffer` in `storage.local`; neither is asked again. Settings' switch is unchanged. Ignoring the card is not an answer: it shows again next time. An answer on one page hides the card on the other at once (`storage.onChanged`).
- **Playback is never blocked**: the tutorial or guide draws and reads its step with the system voice while the card is up; the card never takes focus. **Download** runs the same code as Settings (`startHdDownload` in `src/ui/hdDownload.ts`, moved out of `HdVoice.tsx`; the service worker side is D51's `hdEnable`, speed check and host release, unchanged). Each step checks the HD status when it is read, so the first step after "ready" uses the HD voice. The card then follows the download (progress, "The next step uses it", too slow, failed with "try again in Settings", or **Cancel the download**, which is Settings' Remove), and focus moves to its heading when the pressed button goes away. **Not now** and **Close** put focus back on the page's Stop button.
- **No new data to content scripts**: the panel learns the guide's language from `RunView.lang` (the guide's own field, optional so older views still parse). Content scripts already receive their run's view, which is their own guide's data.
- **Test hook**: test builds read `test:hdOfferEnv` (`storage.local`) in place of the navigator's language, cores and memory, so e2e can test the gate on any machine.
- **Tests**: `test/unit/hd-offer.test.ts` (language, capability, asked once, installed, read-aloud and mute, size, sample file, `voice.stop` allowlist), `test/browser/hd-offer.test.ts` (the card: gates, Not now, Download from the click with the shared path, refused hosts keep the question, Cancel, the sample, focus), e2e `test/e2e/h1-hd-offer.spec.ts` (Practice page: the tutorial plays at once, Download through Chrome's dialog with the stub engine, hosts given back, the next step in HD, asked once; Not now remembered and focus; French browser and a 2-core device never see it).

### D141. Listen to a sample plays a bundled 3-second clip
*5 Nov 2026 · SPEC: Voiceover (HD voice); Security (no remote code); issue #44*

- `public/hd-sample.ogg`: about 3 s, 12 KB (Opus, 32 kbit/s, mono). The same model, voice (`af_heart`) and G2P as the extension, rendered once by `scripts/hd-sample.mjs` (Node, onnxruntime-node from transformers.js's own dependencies, the pinned files checked by SHA-256; not part of any build). It says "Hi! I'll guide you through this app, step by step.": no page names, so renames (D89's "tutorial page") never make it stale.
- **fp16 silence**: the first wording tried, "Hi! I'll guide you through this app, one step at a time.", came out of the fp16 model as 100 % NaN for its second sentence (silence after "Hi!"); "I will … one step at a time" and "I'll … step by step" were fine. The script now stops when more than 1 % of a sentence is NaN, so a silent sample can't be shipped, and it trims each sentence's quiet edges so the only gap is its 0.25 s pause. The extension had the same gap at playback; D148 fixes it.
- **License**: Kokoro-82M and its voices are Apache-2.0, so audio made with them ships under the same notice; `THIRD_PARTY_NOTICES.md` lists it. It is data (an audio file), not code.
- The button never downloads anything and needs no permission. It first stops what is being read with a new extension-page-only message, `voice.stop {}` (Zod-checked, not in the content allowlist), so the sample isn't talked over; pressing it again stops the sample (`aria-pressed`).

### D142. Tutorials use the HD voice once it is installed (amends D129)
*5 Nov 2026 · SPEC: Voiceover; issue #44*

- D129 kept tutorials on the system voice. The offer's first sentence is "Tutorials sound much better with the HD voice", so that has to be true: once the HD voice is ready, `tutorial.speak` reads with it, with the next tutorial step generated while the current one plays, exactly like a guide.
- D129's rules stay: ids in, bundled text out (`tutorialVoiceText`, `nextTutorialVoiceText`); never while muted; only with "Read each step aloud" on unless the learner pressed Replay voice.
- One code path: `speakHdFirst` in `src/background/voice.ts`, used by guides (`speakCurrentStep`) and tutorials. It keeps D51's fallback rules: on an HD failure or a 4 s timeout the system voice reads the step only while it is still the newest speech and the learner hasn't muted or left. The tutorial flag (`speech:tutorial`) is stored with the speech time, so the Practice page's Stop (`tutorial.stop`) also stops a pending HD step.
- Tests (`test/unit/hd-sw.test.ts`, "built-in tutorials on the HD voice"): HD with the next step; the system voice without HD; fallback on failure; muted and read-aloud off; no fallback after Stop; nothing for an unknown step. Three of them fail on the old handler.

### D143. The offer says "about 170 MB", the whole download
*5 Nov 2026 · SPEC: Voiceover (HD voice); issue #44*

- #44's copy says 163 MB, which is the model file alone (`model_fp16.onnx`, 163,234,740 bytes). The download also fetches the voice, the tokenizer and the 6 MB English word list: `HD_TOTAL_BYTES` is 169,860,620 bytes. Settings, the privacy policy and the listing already say 170 MB, so the offer uses `mb(HD_TOTAL_BYTES)` ("170 MB") too, and a unit test pins it. "Nothing sent online" became "after that nothing is sent online": the download itself is a request to Hugging Face and GitHub, as the privacy policy says.

### Fixes from the independent review (D140–D143)
A privacy, permissions, accessibility and copy review of the code. Each fix has a test that fails on the first version (`test/browser/hd-offer.test.ts` "review fixes", `test/unit/hd-sw.test.ts`).
- **Announcement** (medium): pressing Download turned the card's text paragraph into the live region and changed its text in the same update, which screen readers often don't announce. One keyed live region now stays mounted from the question through the download, and the focused heading is described by it.
- **Error copy**: the card wrapped the service worker's message ("The download failed: The download stopped. Try again.. …"). It now says one fixed sentence, "The download failed. You can try again in Settings."; Settings keeps the detail.
- **Stops only when it will speak**: `tutorial.speak` stopped all speech before knowing whether anything would read the step, so a step with HD off and no on-device voice cut off a guide in another tab. Speech is stopped only on the path that reads (`speakHdFirst`'s `stopFirst`, or `speakBundledText`), as before D142.
- **Sample**: on the Practice page it stops only the tutorial's speech (`tutorial.stop`), never a guide in another tab (D129's rule); in the panel it still sends `voice.stop`, which stops the panel's own guide. The sample pauses when the step changes, so it never talks over the next step.
- **Download that can't start**: if `hd.enable` fails after the hosts were granted, the card says so and keeps the question. `hdEnable` now records the hosts to give back before creating the offscreen document, and gives them back if that fails (Settings had the same gap).
- **Privacy policy**: says the offer shows while a tutorial plays, or while an English guide plays with the panel open, until answered (it said "first starts").
- **More tests**: `runView` carries the guide's `lang` (a French guide gets no offer); Close calls back so the page can restore focus; without a memory override the real `navigator.deviceMemory` is used.

### D148. A step the HD voice returns as NaN is read by the system voice (amends D51)
*5 Nov 2026 · SPEC: Voiceover (HD voice); found while making D141's sample; issue #44*

- **Finding**: the fp16 model can return NaN for a whole sentence. "I'll guide you through this app, one step at a time." came out 100 % NaN on onnxruntime (CPU), and close wordings were fine. D51's engine turned every NaN into silence, and the player then answered "played". So such a step was read in silence, with no system-voice fallback. Now that the offer (D140) sends more people to the HD voice, that matters.
- **Change**: the engine passes NaN through (`kokoro.ts`). The offscreen player (`player.ts`, `silenceNaN`) turns NaN into silence and counts them. If more than 1 % of the clip was NaN (`MAX_NAN_SHARE`, the same rule as `scripts/hd-sample.mjs`), it answers `failed` ("no sound: the voice model returned N% NaN samples"). D51's fallback then reads the step with the system voice, only while it is still the newest speech and not muted. A few stray NaN samples still play as silence, as before. The service worker's debug log now records why an HD speak failed (`voice.hd.failed`, with the reason: NaN, timeout or an engine error).
- **Not known yet**: whether the extension's WebAssembly runtime produces the same NaN as onnxruntime-node for that sentence. Either way, a NaN clip can no longer play as a silent step.
- **Tests**: `test/unit/hd-voice.test.ts`: an all-NaN clip answers `failed` and plays nothing; 1 % stray NaN still plays, as zeros. Both fail on the old player.


## 2026-11-05 — Highlight shade (issue #58)

### D144. Shade control: three named levels, in Settings and per guide
*5 Nov 2026 · SPEC: Player and overlay ("Spotlight"); issue #58 (Thomas). Builds on D89's lighter default.*

- **Levels, not a number**: Lighter, Medium (the default, `--wm-scrim`) and Darker. A closed set (`SHADES` in `src/core/player/shade.ts`) in every schema and message, so a guide file or a page can never ask for a black or invisible dim.
- **Derived from the default**: Lighter is `color-mix(in srgb, var(--wm-scrim) 60%, transparent)` and Darker is `color-mix(in srgb, var(--wm-scrim) 75%, #000)`, so both follow `--wm-scrim` in each scheme, and a later change to the default (D89) moves all three together. With D89's default (0.40 on light pages, 0.50 dark), the alphas are:

  | | Lighter | Medium (D89) | Darker |
  | --- | --- | --- | --- |
  | light pages | 0.24 | 0.40 | 0.55 |
  | dark scheme | 0.30 | 0.50 | 0.63 |

  The issue suggested about 0–60 %; dark Darker is 63 %, so a step stays visibly darker than the dark scheme's 50 % default. A browser test requires at least 0.1 between neighbouring levels, more than 0.1 for Lighter and at most 0.7 for Darker.
  There is no "off": the dim is half of what says "this is the step", and the ring alone is easy to miss on busy pages.
- **Drawing**: `.spot` paints `var(--wm-shade, var(--wm-scrim))`; `.spot[data-shade]` sets only that custom property to `--wm-scrim-lighter` or `--wm-scrim-darker` (new tokens, light and dark). So the forced-colours rule (`.spot { box-shadow: none }`) still wins, and the ring, the hole and every animation are untouched. Medium is the token itself, so D89's default carries over.
- **Settings → Highlight** (new section after HD voice): "Shade around the highlighted step", radio cards Follow each guide (default) / Lighter / Medium / Darker, with a small preview of a page and a highlighted button that uses the same tokens (hidden from screen readers), and one line that only the rest of the page gets darker. Stored as `playerSettings` in `storage.local` (`PlayerSettingsSchema`, an unknown value reads as "Follow each guide"), through `player.settings.get` / `player.settings.set`: Zod-checked, extension pages only.
- **Editor**: "Shade around the highlight · for this guide", a select with Default (Medium) / Lighter / Darker. Default removes the field. Team guides show it read-only.

### D145. Precedence: the learner's choice wins; content scripts get only the result
*5 Nov 2026 · SPEC: Player and overlay; Security ("content scripts never receive settings"); issue #58 open question*

- **Rule** (`resolveShade`): the learner's pick in Settings, if it is a level; else the guide's `shade`; else Medium. The issue offered two alternatives, "the learner can only make it lighter" and "the guide wins unless the learner turns on an override". Both put the author's taste over the person in front of the screen. Some people need it darker (focus, low vision), others lighter (they read the page around the step), and only they know. "Follow each guide" is the default, so an author's choice still applies to everyone who hasn't chosen.
- **What content scripts get**: `viewFor` adds `shade`, the resolved level, to the run view, next to `muted`. Not the settings object and not the guide's own field. On another site the view says Medium (it already drops the guide's identity there, D48). The overlay checks the value against the closed set again (`isShade`) and draws anything else as Medium.
- **Live**: changing the setting re-sends every running tab its view (`broadcastAllRuns`, shared with mute), and `PlayerUI.setShade` repaints the drawn step without redrawing or moving on.
- **Tutorials** have no shade of their own: the Practice page reads the setting when a tutorial starts and follows `storage.onChanged` while it plays.

### D146. Guide files: an optional field, no version bump
*5 Nov 2026 · SPEC: Data model; Sharing ("Import rules")*

- `GuideSchema.shade` is optional, so every older guide and guide file still parses and round-trips unchanged.
- **Older Waymark versions** parse guides with Zod's default object mode, which drops unknown keys. A file with `shade` imports there without it, and nothing else changes. So the field is not stripped on export, and `schemaVersion` / `formatVersion` stay at 1: a bump would make older versions refuse the whole file ("made by a newer version").
- **Newer values**: a `shade` this version doesn't know (say, a fourth level later) reads as not set (`.catch(undefined)`) instead of rejecting the guide.
- The export review doesn't list it: it shows text that could be private, and the shade is one of three fixed words.

### D147. Accessibility modes
*5 Nov 2026 · SPEC: Accessibility; issue #58 open question*

- **Forced colours**: unchanged; the dim is dropped at every level and the ring uses `Highlight`.
- **Reduced motion**: unaffected; the shade is a colour, and nothing animates when it changes.
- **High contrast** (`prefers-contrast: more`) and **reduced transparency** (`prefers-reduced-transparency`): no automatic change. The dim is translucent on purpose, so the page around the step stays readable, and making it opaque would hide the context the step is about. Someone who wants more separation picks Darker, which applies everywhere. Revisit with pilot feedback.
- **Tests**: `test/unit/shade.test.ts` (precedence, the closed set, an old guide file round-trips, the new field round-trips, an unknown value imports without it, settings fallback, message allowlists, the run view carries only the resolved level and Medium off-site); `test/browser/shade.test.ts` (open and closed root: each level paints its token on light and dark schemes and lighter < medium < darker ≤ 0.65; the ring and hole are identical at every level; an unknown or missing level is Medium; `setShade` repaints without a redraw; forced colours drop the dim); e2e `test/e2e/h2-shade.spec.ts` (closed root: the editor sets Darker, the exported guide file carries it, the page draws it, Settings → Lighter overrides it at once and Follow each guide restores it; the Practice page follows Settings, live).

### Fixes from the independent review (D144–D147)
A security, data, rendering, accessibility and copy review. Tests that fail on the first version: `test/browser/shade.test.ts` (levels), `test/browser/shade-ui.test.ts` (new), and `test/unit/shade.test.ts`.
- **Darker looked like Medium** (medium): the first version had fixed Lighter and Darker colours. On `main`'s default (0.5 light, 0.6 dark, before D89 lands), Darker was only 0.05 above Medium, and the table described the other branch. The levels are now derived from `--wm-scrim` (D144), and a test requires a visible step between them.
- **Settings hint** (medium): "Your choice here is used for every guide and tutorial" was false for the default, Follow each guide, and screen readers read it for the whole group. It now says "Pick a shade to use it for every guide and tutorial."
- **Locked or wrong Settings**: a failed read left every choice disabled. It now falls back to Follow each guide. A failed save showed the new choice although nothing was stored. It now puts back the choice in use and says it could not be saved (a mounted live region).
- **One name**: the editor says "Shade around the highlighted step", like Settings (`SHADE_NAME`).
- **Practice page race**: a Settings change that arrives while a tutorial's start reads the setting is no longer overwritten by the older read (a change counter). This one has no deterministic test: the window is one message round trip.
- **Tests that passed on broken code**: the run view is now checked to have exactly its own fields plus `muted` and `shade`; off-site stays Medium even when the learner picked Darker; unknown guide and pack keys are dropped (what D146's compatibility rests on); the editor's Default removes the field on save (`withGuideShade`); team guides show the select read-only; Duplicate keeps the shade.
- Not changed: the reviewer noted that the content script already bundles some Zod internals on `main`, before this change (this change adds about 0.7 KB and no Zod). Worth its own issue.

### D150. The on-page "?" launcher is on by default where a page has guides
*6 Nov 2026 · SPEC: Discovery (on-page launcher); issue #66*

- **Change**: SPEC said the launcher is "off by default; turned on per site". Thomas found that learners never saw it unless someone turned it on for each site first. It is now on unless turned off for the site: `site.settings.get` and `guide.forPage` read a missing per-site value as on. An explicit Off is stored as before and wins. The button still shows only on allowed sites, in the top frame, when the page has at least one matching guide, so a site with no guides is unchanged.
- **Why it is safe**: nothing new runs on a page. The content script was already on every allowed page (route watching for the badge), and the button lists only guides for that origin.
- **Tests**: `test/e2e/m5-discovery-sharing.spec.ts` checks that a page with no guides has no button. After a guide is recorded, the button shows with no setting changed. Turning it off for the site hides it and the switch stays off after reopening the panel; turning it on brings it back. The first two checks fail on the old code.

### D151. The default shade is Lighter
*6 Nov 2026 · SPEC: Player (shade, D144–D147); issue #58*

- **Change**: Thomas asked for the Lighter level as the default. `DEFAULT_SHADE` is now `lighter`, so it applies to guides with no shade of their own, to "Follow each guide", to unknown values and to runs on another site. The levels themselves don't change, and Medium keeps the `--wm-scrim` token from D89.
- **Effect on saved guides**: a guide whose editor choice was "Default" has no `shade` field, so it now plays Lighter. A guide that picked a level keeps it. The editor stores Medium explicitly now and drops Lighter (the new default).
- **Copy**: the editor's option reads "Default (Lighter)", built from the constant; the Settings hints were updated to match.
- **Tests**: `test/unit/shade.test.ts` and `test/browser/shade.test.ts` (the default is Lighter and lighter than the Medium token).

### D152. Test step tries every frame at the step's frame path, newest first
*6 Nov 2026 · SPEC: Editor (Test step), Element targeting (frames); issue #67 (found with the debug log, D110)*

- **Finding**: on an app that shows each screen in brand-new iframes, the frame map keeps the old frames at the same frame path. Test step took the first match in key order, which is the oldest frame, already gone. Its message failed, and the editor said "Waymark is not running on this page. Allow it on this site first." That happened while the guide was playing the same step in the live frame.
- **Change**: `framesAtPath` (in `src/core/frames/registry.ts`) lists every mapped frame at the path, newest first. `step.test` asks each in turn and uses the first answer. When none answers in a subframe, it says the frame did not answer and suggests a reload; the "Allow it on this site" text is only for the top frame.
- **Tests**:
  - unit: `framesAtPath` order;
  - e2e (`m6-nested-frames.spec.ts`): record a step in the nested frame, let the app rebuild its frames, then Test step finds it. Before the fix it failed with the message above.

### D153. While recording, an outline shows what a click will record
*6 Nov 2026 · SPEC: Recorder (event capture); issue #70*

- **Why**: authors only learned a click was "hard to find" (D82) or skipped (D47) after making it. Thomas asked to see what will be picked before clicking, on by default.
- **What**:
  - `previewClick` (`src/core/recorder/preview.ts`, pure) makes the recorder's choice for an event path:
    - the control;
    - the clickable card of D82 a plain-content click is promoted to (`ok`);
    - a low-confidence or canvas target (`warn`);
    - nothing to find it by (`skip`).
  - `src/content/rec-hover.ts` draws it in the overlay:
    - solid ring colour for `ok`, dashed orange with "Hard to find" for `warn`, red with "Won't be recorded" for `skip`;
    - `pointer-events: none` and `aria-hidden`;
    - hidden over Waymark's own UI, measured at most once per animation frame, memoized on the hovered element, and following scroll and resize;
    - each frame's content script draws its own outline.
- **Setting**: `recorderSettings.hover` in storage.local, on by default (Zod `catch(true)`). It is in Settings → Highlight. New messages `recorder.settings.get/set`. Content scripts may only `get`; it returns nothing but this switch. The content script asks each time the recording view arrives, so a change applies at the next step or page. A late reply never turns it back on after recording stops. The service worker's recording code is unchanged.
- **Tests**:
  - `test/browser/rec-hover.test.ts`: the choice for a control, a promoted card, plain text and an empty box. The outline sits exactly on the card, takes no pointer, shows its label, and is hidden over the overlay.
  - `test/e2e/r1-rec-hover.spec.ts` (closed root):
    - hover shows the outline;
    - the click is recorded as usual;
    - session storage has no trace of the outline;
    - Off in Settings removes it.
- **Fixes from the independent review** (each test fails on the reviewed version):
  - the outline promised a step where the recorder ignores the click: the page itself (`html`/`body`) and plain content inside a control deeper than the target search reaches. `previewClick` now follows the recorder's rules in its order, and a closed component is "hard to find" as the panel flags it. A browser test clicks the same elements through the real recorder and checks they agree;
  - every element the pointer crossed built fingerprints, which scan the page for look-alikes. The choice is now made only once the pointer rests on a new element (`REST_MS`, 60 ms);
  - a press hides the outline and decides again, since a click can rebuild the page;
  - the outline re-attaches when the page drops Waymark's overlay host.
- **Frames**: each granted frame's content script draws its own outline, so recording now mounts an overlay host in subframes too (the pill stays top-frame only).

### D154. Content scripts see only the hover switch of the recording settings
*6 Nov 2026 · SPEC: Security (content scripts are untrusted); follow-up to D153*

- **Change**: `recorder.settings.get` is the one settings read open to content scripts (D153). It returned the whole `RecorderSettings`, so any setting added later would have reached every granted page. The handler now passes the result through `recorderSettingsFor(settings, ctx.kind)`, which gives content senders `{ hover }` only. Extension pages still get everything.
- **Tests**: `test/unit/recorder-settings.test.ts`: with an extra future field, a content sender gets `{ hover }` only; the default is on, and a bad stored value falls back to on.

