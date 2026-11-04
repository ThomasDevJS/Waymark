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
