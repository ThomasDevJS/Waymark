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
