# Waymark — In-App Guide Extension Spec

Spec as of Nov 4, 2026. Source of truth: the Claude Doc "Waymark — In-App Guide Extension Spec"; this file is a copy for development.

## Summary, goals and non-goals

Waymark (working name) is a Chromium extension that records a click-by-click walkthrough of any web app and replays it on the live page. Each step spotlights the real button or field, shows a note, and can read it aloud. v1 stores no screenshots, needs no servers, and costs $0 to run.

**Goals for v1**

- Record a guide by simply using the app: clicks, field entries, selections and page changes become steps.
- Edit each step: title, note, voice text, order, delete, and add note-only steps.
- Play a guide on the live app: spotlight, tooltip, voice, and advance when the learner does the action, across pages.
- Tell learners that guides exist for the page they are on, and let them search guides.
- Share guides with teammates without a backend.
- Run at $0 in Chrome, Edge, Brave, Vivaldi and Opera.

**Non-goals for v1**

- Screenshots, video export or PDF docs.
- Cloud AI or cloud text-to-speech APIs.
- A JS snippet embedded in a website, or customer-facing distribution.
- Analytics dashboards, SSO, Firefox or Safari.
- Automatic "user is stuck" detection.
- Apps that draw their UI on a canvas (Google Sheets, Figma): there is no element to target.

## Users, scope and assumptions

v1 serves one team learning web apps they already have access to. The extension is designed for any web app, with a faster, more reliable path when we control the app's code.

| Role | Does | v1? |
| --- | --- | --- |
| Author | Records and edits guides; usually a team lead or trainer | Yes |
| Learner | Finds and plays guides while using the app; usually a new hire | Yes |
| Admin | Publishes the team library and manages who can edit | Phase 2 |

**Constraints**

- $0 running cost. The only possible spend is the one-time $5 Chrome Web Store registration.
- Manifest V3, Chromium 120 or newer, desktop only.
- No screenshots, no typed values, no secrets in the extension.

**Assumptions to confirm**

- Target app is not yet chosen. Guides target any web app; per-site profiles tune matching for each app.
- If the target app is our own, we add `data-guide-id` attributes to key elements for near-perfect matching.
- Up to about 50 learners and a few hundred guides in the first year.
- Learners log in to the target app themselves. Guides never carry credentials or business data.

## User flows

An author records by doing the task once; a learner plays it on the real page and moves forward by doing each action.

**Record (author)**

1. On the target app, click the Waymark toolbar icon. It opens the side panel and gives Waymark temporary access to that tab.
2. The first time on a site, the panel shows Allow on this site; one click grants that site only.
3. In the panel, choose New guide, name it, and press Record.
4. The author does the task. Each action appears live in the side panel as a step, such as "Click **Save**".
5. The author can pause, undo the last step, or add a note-only step.
6. Stop opens the editor.

**Edit (author)**

1. Edit each step's title, note, voice text, advance mode (on action or Next button), and whether it is optional.
2. Test step highlights the matched element on the current page.
3. Re-pick element lets the author click the right element when the match is wrong.
4. Reorder, delete or insert steps; Save bumps the guide version.

**Play (learner)**

1. Pick a guide from the side panel, the toolbar badge, or the on-page launcher, and press Start.
2. If the learner is not on the start page, Waymark offers to open it.
3. For each step, Waymark finds the element, scrolls to it, dims the page around it, shows the tooltip, and speaks the note.
4. The guide advances when the learner clicks or fills the element, or presses Next on note-only steps.
5. Page loads and in-app route changes keep the run going.
6. If the element is not found within 8 seconds, the learner sees Retry, Skip, Exit, and Report broken step.
7. The last step shows a Done card; completion is saved locally.

**Discover and share**

- The toolbar badge shows how many guides match the current page.
- Authors export guides as a pack file and teammates import it, or the team subscribes to a shared library URL (see Sharing and storage).

## Architecture

Waymark is four parts inside the browser and no server. The service worker routes every message and owns storage; the content script is the only part that touches the target page.

```
 Side panel  <--messages-->  Service worker (hub)  <--pack--  Team library URL (optional)
 (library, recorder,          routes messages, runs,          static HTTPS pack file,
  editor, site access)        badge, registration, voice      fetched every 6 hours
                               |          |          |
                          read/write   messages    speak
                               v          v          v
                      chrome.storage  Content script  Browser voice
                      local: guides,  (each granted   (chrome.tts,
                      settings        frame: recorder, on-device voices)
                      session: runs,  matcher, player)
                      recording           |
                                   reads DOM, draws overlay
                                          v
                               Target web app page
                     (real DOM; Waymark overlay in a closed shadow root)
```

The side panel and the page never talk directly: every request goes through the service worker.

- **Service worker**: keeps no state in memory, because the browser stops it after 30 seconds idle; everything lives in `chrome.storage`. It opens the side panel from `action.onClicked`, calling `sidePanel.open` before any `await`; that click also grants `activeTab`, so it can read the tab's URL. It also sets the toolbar badge and speaks through `chrome.tts`.
- **Content script**: built as an unlisted WXT script, so the manifest has no `content_scripts` or `host_permissions`. It is registered at runtime with `chrome.scripting.registerContentScripts` for granted sites only (`allFrames`, `matchOriginAsFallback`, `document_start`). Registrations are re-synced with `chrome.permissions.getAll()` on install, startup and every permission change. After a grant or an update, it is injected into already-open tabs with `executeScript`. A leftover script from an old version detects its dead context and removes its overlay.
- **Side panel**: guide library, recorder controls and editor. It never reads the page. It calls `chrome.permissions.request` itself, because that call needs the user's click.
- **Messages**: one typed union in `core/messaging`, such as `guide.forPage`, `guide.save`, `rec.start`, `rec.step`, `run.start`, `run.advance` and `tts.speak`. Each sender type has its own allowlist (see Security).

## Data model

A guide is a small JSON document of steps, and each step carries a fingerprint with several independent ways to find its element again. Schemas are defined once in Zod and shared by recorder, player, storage and import.

```ts
interface Guide {
  id: string;                 // ULID; a duplicated guide gets a new id
  schemaVersion: 1;
  revisionId: string;         // new ULID on every save; identifies one exact copy
  forkedFrom?: { guideId: string; revisionId: string };
  title: string;
  description?: string;
  lang: string;               // BCP 47, e.g. "en"; picks templates and voice
  tags: string[];
  appOrigins: string[];       // e.g. ["https://app.example.com"]
  startUrl: string;
  matchUrls: UrlRule[];       // pages where the guide is offered
  steps: Step[];
  version: number;            // +1 on every save; for display only
  source: 'local' | 'library';
  updatedAt: string;          // ISO 8601
}

// A URL matches when its origin is in appOrigins AND its path matches the rule.
interface UrlRule { kind: 'prefix' | 'pattern'; value: string } // pattern: /orders/:id/edit

interface Step {
  id: string;
  kind: 'click' | 'input' | 'select' | 'check' | 'submit' | 'navigate' | 'note';
  title: string;              // "Click **Save**"
  note?: string;              // limited markdown
  voiceText?: string;         // default: title + note
  url: UrlRule;               // page the step belongs to
  target?: ElementFingerprint;// absent for note and navigate
  advance: 'action' | 'next';
  optional?: boolean;         // shows a Skip button; never auto-skipped
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
}

interface ElementFingerprint {
  instance: 'unique' | 'any'; // 'any' = repeated element, e.g. a row's Edit button
  matchCount: number;         // matches of the best selector at record time
  guideId?: string;           // data-guide-id fast path
  testId?: { attr: string; value: string }; // data-testid, data-test, data-cy, data-qa
  id?: string;                // only when judged stable
  tag: string;
  role?: string;
  accessibleName?: string;    // aria-label, aria-labelledby or <label> text
  name?: string;              // name attribute
  inputType?: string;
  placeholder?: string;
  text?: string;              // own visible text; omitted if over 80 chars or data-like
  hrefPath?: string;          // normalized path only, no query string
  cssPath: string;            // built from stable attributes and classes only
  xpath: string;              // positional fallback
  ancestors: { tag: string; role?: string; label?: string }[]; // up to 3 landmarks
  shadowPath: string[];       // open shadow host selectors
  framePath: string[];        // iframe selectors, resolved through the service worker
  rect: { x: number; y: number; w: number; h: number; vw: number; vh: number };
}

interface RunState {          // chrome.storage.session, key run:<tabId>
  guideSnapshot: Guide;       // the exact copy the run started with
  stepIndex: number;
  status: 'running' | 'paused' | 'finished';
  startedAt: string;
}

interface GuidePack {         // export / import / library file
  format: 'waymark-pack';
  formatVersion: 1;
  exportedAt: string;
  guides: Guide[];
}
```

**Storage**

- Guides and settings live in `chrome.storage.local` with `unlimitedStorage`, one key per guide plus an index. A few hundred guides at 1 to 1.5 KB per step can pass the default 10 MB limit.
- All writes go through one queue in the service worker, so a guide and the index never disagree.
- Run and recording state live in `chrome.storage.session`.
- Both areas are set to `TRUSTED_CONTEXTS`, so content scripts get guides only through the service worker.
- Older schema versions are migrated on read. A newer `schemaVersion` or `formatVersion` is rejected with a message, never silently trimmed.

## Element targeting (core)

Finding the recorded element again on a changed page is the product; every other part depends on it. The rule: highlighting the wrong element is worse than saying "not found", so the matcher prefers no answer over a weak one.

**At record time**

1. Resolve the meaningful target. From `event.composedPath()`, take the nearest interactive element within 5 levels: `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `[contenteditable]`, or a widget role (button, link, menuitem, option, tab, checkbox, radio, switch, combobox). A `<label>` resolves to its control.
2. Fill every fingerprint field available, then drop unstable values:
   - ids and classes that look generated: CSS-in-JS hashes (`css-1x9f2k`, `sc-`, `jss12`), React `useId` values (`:r0:`), `ember123`, long digit runs, UUIDs;
   - text that looks like data: emails, phone numbers, amounts, dates, codes, or anything longer than 80 characters. The same filter runs on accessible names, option labels, link paths and page titles.
3. Check uniqueness of each selector with `querySelectorAll` and store the match count. If the best selector matches more than one element (an Edit button on every row), set `instance: 'any'`.
4. Normalize the step URL. Numeric, UUID, hex and other key-like path segments become parameters (`/orders/123` becomes `/orders/:id`). Query strings are ignored unless the site profile keeps named keys. For hash-routed apps (a site profile setting), `#/…` counts as the path.

**At playback**

1. Fast path: a unique match on `data-guide-id` or a test id wins immediately.
2. Candidates: the union of matches from id, role plus accessible name, tag plus text, CSS path and XPath. If empty, every visible element with the same tag or role, capped at 500. Each candidate is reduced to its nearest interactive ancestor, then de-duplicated. Tag (or role) must match; it is a filter, not a score.
3. Score each visible, enabled candidate against the signals the fingerprint actually has. Text compares after trimming, collapsing whitespace and ignoring case; v1 has no fuzzy matching. Starting weights, tuned by the robustness suite:

| Signal | Weight | Strong |
| --- | --- | --- |
| Test id | 40 | Yes |
| Stable id | 25 | Yes |
| Role plus accessible name | 25 | Yes |
| Own text | 20 | Yes |
| `name` attribute | 15 | Yes |
| Link path | 10 | Yes |
| Placeholder | 10 | No |
| CSS path | 10 | No |
| Ancestor landmarks | 10 | No |
| XPath | 5 | No |
| Position near the recorded spot | 5 | No |

```latex
\text{score} = 100 \times \frac{\sum \text{weights of matched signals}}{\sum \text{weights of signals present in the fingerprint}}
```

4. Accept the best candidate only if at least one strong signal matched exactly and it scores 60 or more. For `instance: 'unique'`, it must also lead the runner-up by 15 points or more.
5. For `instance: 'any'`, spotlight the first visible tied candidate and advance on a click on any of them.
6. If nothing qualifies, wait: re-run on DOM changes and on route changes, at most once per 100 ms, for up to 8 seconds. Observe the document and each open shadow root on the step's `shadowPath`, because a document observer does not see inside shadow roots.
7. Still nothing: show the not-found card. Never fall back to a guess.
8. Across frames: each frame's matcher reports its best score and margin to the service worker, which picks one winner by `frameId`. Only the winning frame draws the spotlight and tooltip.

**Per-site profiles** let an author add stable attributes (such as `data-qa`), extra ignore patterns, hash routing, and query keys to keep. Each successful match also logs which signals matched, so the editor can flag fragile steps that matched on a single strong signal.

## Recorder

The recorder turns raw browser events into a short list of human-sized steps, and it never stores what the author types.

**Event capture**

- Listen on `document` in the capture phase for `pointerdown`, `click`, `input`, `change`, `submit` and `keydown` (Enter in a field). Use `composedPath()` to see inside open shadow roots.
- Build a pending fingerprint on `pointerdown`, before the app can re-render the element. On `click`, use it if the click target is that node, or is linked to it in `composedPath()`, within 1 second.
- Otherwise build the fingerprint from the click target. This also covers keyboard activation (Enter or Space on a button), which fires `click` with no `pointerdown`.
- Ignore untrusted events (`isTrusted === false`) and anything inside Waymark's own overlay.

**Merge rules**

- Clicking a field and typing into it becomes one input step.
- Many `input` events on the same field become one input step.
- A native `<select>`: click plus `change` becomes one select step.
- A checkbox, radio or switch: a direct click or a label click becomes one check step.
- A click on a submit button followed by `submit` becomes one submit step.
- A double-click becomes one click step.
- A custom dropdown stays two steps: open it, then "Choose **{option}**". Options rendered in a portal are matched by role and name, not position.
- A click on a non-interactive area is kept only if it has no interactive ancestor, and it is flagged low-confidence in the editor.

**Navigation**

- Full page loads: the content script starts on the new page and tells the service worker the new URL.
- In-app route changes: watch the Navigation API (`navigation` events) in the content script, plus a 500 ms URL check as a fallback. Whether those events reach the content script's isolated world is unverified; a fixture test decides.
- A navigation within 1.5 s of a recorded click belongs to that click. Others become a navigate step, except replace-type navigations and query-only changes.
- If a click opens a new tab, recording continues there; the service worker links the tabs by `openerTabId`.

**Frames and shadow DOM**

- Content scripts run in all frames of granted sites, including `about:blank` and `srcdoc` frames.
- A cross-origin frame cannot compute its own path (`frameElement` is null there). Instead, the service worker issues a nonce, the parent frame posts it into the iframe, and the child sends it back. The service worker then maps the iframe's selector to its `frameId`.
- Cross-origin iframes need their own site permission. The side panel shows Allow for that site, because content scripts cannot request permissions.
- Closed shadow roots cannot be entered. The recorder records the host element and flags the step.

**Privacy guards**

- Never store values typed into fields. Input steps store which field, not what was typed; the author can add an example value to the note.
- Password, credit-card (`autocomplete="cc-*"`) and one-time-code fields are recorded as "Enter your …" with no value, ever.
- For select steps, store the visible option label. The author can edit or remove it.

**State**: recording status lives in `chrome.storage.session`, so it survives page loads and service worker restarts. A REC badge on the toolbar icon, which takes precedence over the guide count, and a small on-page pill show that recording is on. The on-page pill also shows the last recorded step, so authors can follow along without the side panel.

## Player and overlay

The player draws on top of the real app without touching its styles, and the learner progresses by doing the real action.

**Overlay**

- One host element with a closed shadow root; test builds use an open root so Playwright can reach it. All Waymark styles live inside it, so the app cannot break them and they cannot break the app.
- The host is a manual popover (`showPopover()`), so it sits in the top layer above any `z-index`. If the target is inside an open modal `<dialog>`, the host mounts inside that dialog instead, because a modal dialog makes everything outside it inert.
- Only the frame that contains the target draws the overlay (see Element targeting, step 8).
- `pointer-events: none` except on the tooltip. The host stops pointer, mouse and click events from reaching the app, so the app's "click outside" handlers do not close its menus. The tooltip calls `preventDefault` on `mousedown`, so the app's field keeps focus.
- Spotlight: four dimmed panels around the target's box plus 6 px padding. The target stays clickable through the gap.
- Default is relaxed mode: the dimmed area does not block clicks, so scrolling and side actions still work. A strict mode that blocks clicks outside the target is a later option.

**Tooltip**

- Positioned with Floating UI (`computePosition` plus `autoUpdate`), so it follows scrolling, resizing and layout shifts, and flips when there is no room.
- Shows step n of N, title, note, Back, Next (note-only steps), Exit, and a mute toggle.
- If the target is removed or re-rendered, the matcher runs again on the same step.

**Advancing**

| Step kind | Advances when |
| --- | --- |
| click | A trusted click lands on the target, or on any tied candidate when `instance` is `any` |
| input | `change`, or blur with a non-empty value, or Next |
| select | `change` on a native select; a click on the option for custom dropdowns |
| check | `change` on native inputs; a click on ARIA checkbox, radio or switch roles, which fire no `change` |
| submit | The form's `submit` event, or the page navigates away within 1.5 s of the click |
| navigate | The URL matches the step's URL rule |
| note | Next |

Optional steps also show Skip. After any action, wait 300 ms before searching for the next target.

**Runs across pages**

- Run state is stored per tab in `chrome.storage.session`, with a snapshot of the guide. On every page load, the content script asks the service worker whether this tab has an active run and resumes at the saved step.
- A link that opens a new tab carries the run to that tab (`openerTabId`); the old tab's run pauses.
- Off track: if the current page does not match the step's URL rule and the target is missing for 3 s, show Go back, Skip, or Exit.
- Guide updated mid-run: the run continues on its snapshot.
- Runs in two tabs are allowed, but there is one voice channel: only the focused tab speaks.

**Accessibility and performance**

- Tooltip uses `role="dialog"` and an `aria-live="polite"` region, and it never steals focus from the field the learner must use.
- Keyboard: Next, Back and Exit are `chrome.commands`, so users can change the shortcuts. Avoid Alt+Shift combinations, which switch input language on Windows. Esc exits only when focus is in the tooltip.
- Respect `prefers-reduced-motion` and light and dark schemes.
- Route watching runs on every granted page, because the badge and launcher need it. DOM observers run only while a run or recording is active.

## Voiceover and AI text

Voice and step text are free: the browser's on-device voices read each step, and templates write the first draft of every step title.

**Voiceover**

- Use the `chrome.tts` extension API from the service worker; Chrome and Edge support it. M4 checks Brave, Opera and Vivaldi, and whether speech stops when the service worker is stopped.
- On-device voices only by default. Voices marked `remote: true`, such as Chrome's "Google …" voices, send the text to a server, so they stay hidden unless the user turns on Allow online voices.
- Settings: voice picker filtered by the guide's `lang`, speed, and auto-play on or off.
- Automatic voice (D46): unless the user picked one, use the best usable voice for the `lang`: names with Natural, Neural, Enhanced or Premium first (remote ones among them first, when online voices are allowed), then on-device over remote, then the guide's region (else the browser's), then the browser's list order. The `speechSynthesis` fallback ranks the same way, without the user's choice (settings never reach content scripts). Settings shows the voice in use and how to install better voices on the user's OS.
- Speech stops on step change, Back, Exit, or mute (`chrome.tts.stop`).
- Fallback where `chrome.tts` is missing: `speechSynthesis` in the content script, unlocked by the learner's Start click.

**Template step text (always on)**

| Step kind | Template |
| --- | --- |
| click | Click **{name}** |
| input | Enter {name} |
| select | Choose **{option}** in **{name}** |
| check | Check (or uncheck) **{name}** |
| submit | Submit the form |
| navigate | Go to {page title} |

`{name}` falls back in order: accessible name, own text, placeholder, `name` attribute, `title` attribute, then a role word such as "the button". Templates are keyed by the guide's `lang`; v1 ships English, and other languages fall back to it.

**Optional on-device AI (Phase 2)**

- Not in v1. When added, use only Chrome's Prompt API (`LanguageModel`), stable for extensions since Chrome 138. The Writer and Rewriter APIs are origin trials.
- It needs desktop Chrome with 22 GB free disk and either more than 4 GB of video memory or 16 GB of RAM with 4 cores. Edge, Brave, Opera and Vivaldi do not have it, so feature-detect and hide the buttons.
- Input is limited to step titles, field labels and page titles. Page content is never sent.
- No cloud AI. If it is added later, calls go through a server-side proxy; no API key ever ships in the extension.

## Discovery and hints

In v1, a learner discovers guides by the page they are on and by search; automatic "you look stuck" hints wait until the basics prove reliable.

- **Toolbar badge**: the service worker matches the tab URL against every guide's URL rules and sets that tab's badge count. It learns the URL from `tabs.onUpdated` and from route reports sent by the content script. The REC badge takes precedence.
- **Side panel**: "For this page" first, then all guides with search over title, description, tags and step titles. Search is client-side (MiniSearch).
- **On-page launcher**: a small "?" button in the overlay, bottom right, listing matching guides. Off by default; turned on per site.
- **First-run access**: a new learner has no sites granted, so nothing would show. When a pack is imported or a library is subscribed, the panel offers one Allow request covering every site in its `appOrigins`.
- **Deep link**: `waymark=<guideId>` in the URL hash or query string offers to start that guide. The content script reads it at `document_start`, passes it to the service worker, and removes it with `history.replaceState`, so hash-routed apps are not disturbed.
- **Later**: rage clicks, repeated form errors or long idle time on a form suggest a matching guide. Off by default, and never more than once per page visit.

## Sharing and storage

v1 is local-first and shares guides as files, so there is no server to run or pay for. A free-tier backend comes only if the team needs shared editing.

| Stage | How guides are shared | Cost | Trade-off |
| --- | --- | --- | --- |
| v1: packs | Export selected guides as a `.waymark.json` pack; teammates import it. Share through a Drive folder, Git repo or chat. | $0 | Manual; updates need a re-import |
| v1: library URL | An admin publishes a pack at a fixed HTTPS URL. The extension fetches it at startup and every 6 hours (`chrome.alarms`), and shows those guides as read-only team guides. The library's site is requested as a permission when the URL is entered, unless the host sends CORS headers. | $0 | Anyone with the URL can read the pack, which reveals screen labels of the target app |
| Phase 2: workspace | Firebase free tier: Google sign-in, Firestore with workspaces, members and guides; security rules limit reads to members and writes to authors. Needs Firebase JS SDK 10.8 or newer with `firebase/auth/web-extension`, an offscreen document for sign-in, and each store's extension ID as an authorized domain. | $0 at team scale | Accounts and security rules to maintain; Edge has no `identity.getAuthToken` |

**Import rules**

- Every pack is untrusted input. Validate it with the Zod schema, cap it at 5 MB and 500 steps per guide, and reject newer schema versions with a message.
- Before export, show a review of everything the pack contains (titles, notes, labels, URLs), so the author can remove business data.
- Same id and same `revisionId`: nothing to do. Same id, different `revisionId`: library guides always take the library copy; for local guides the user picks keep, replace, or keep both. Keep both gives the import a new id with `forkedFrom` set.
- Library guides are read-only. Duplicating one gives a new id with `forkedFrom` set.
- Report broken step saves the step and page URL to a local Problems list. The learner can copy a report to send to the author; there is no server in v1.

## Permissions, privacy and security

Waymark asks for access one site at a time, stores no page content beyond element labels, and sends nothing off the device in v1 unless the user turns on online voices.

| Permission | Why | Install warning |
| --- | --- | --- |
| `storage` | Guides, settings, run state | None |
| `unlimitedStorage` | Lifts the 10 MB limit on `chrome.storage.local` | None |
| `sidePanel` | Library, recorder and editor UI | None |
| `scripting` | Register content scripts for granted sites | None |
| `activeTab` | Read the current tab's URL after a toolbar click, before the site is granted | None |
| `tts` | Voiceover | None |
| `alarms` | Library refresh every 6 hours | None |
| `optional_host_permissions`: `https://*/*`, `http://*/*` | Requested per site with `chrome.permissions.request`, from a click in the side panel | Shown only when a site is requested |

Not requested: `tabs`, `webNavigation`, `history`, `<all_urls>` at install. Granted sites already expose their own tab URLs, which is all the badge needs.

**Privacy**

- No screenshots, no typed values, and no page text beyond element labels and short own text. The data-like filter also covers accessible names, option labels, link paths, URL segments and page titles.
- An export review shows everything in a pack before it leaves the browser.
- Online voices are off by default, because they send step text to the voice provider.
- No analytics or telemetry. Run history stays local.
- A one-page privacy policy (free on GitHub Pages) is required for the store listing.

**Security**

- Manifest V3 with no remote code: every script is bundled.
- Notes render through an allow-list: bold, italic, line breaks, and `https:` links that open in a new tab with `rel="noopener noreferrer"`. User strings never reach `innerHTML`.
- Packs and library files are untrusted; see the import rules.
- Only `chrome.runtime` messaging between parts, with an allowlist per sender type. A content script (a sender with `sender.tab`) may send only `rec.step` while its tab is recording, `run.advance`, route reports and `guide.forPage`.
- `guide.forPage` returns only guides whose `appOrigins` include `sender.origin`. Content scripts never receive settings or unrelated guides, since data sent to them can leak to the page.
- The service worker speaks only the stored `voiceText`, never text a content script supplies.
- Page `postMessage` is never trusted, except the frame nonce, which the service worker verifies.
- No API keys or secrets in the extension, ever. Any paid service later goes through a server-side proxy.

## Distribution and cost

Total cost is $0 to $5: one codebase ships to every Chromium browser, and the only optional spend is the one-time Chrome Web Store registration.

| Channel | Cost | Auto-updates | Best for |
| --- | --- | --- | --- |
| Load unpacked (developer mode) | $0 | No | Development and a pilot of up to 5 people |
| Chrome Web Store, private (Workspace domain or Google Group) | $5 once | Yes | An internal team; only invited people can see or install it |
| Chrome Web Store, unlisted | $5 once | Yes | Anyone with the link, in Chrome, Brave, Vivaldi; Edge can install from it too. Still goes through review |
| Microsoft Edge Add-ons | $0 | Yes | Edge users |
| Opera add-ons | Not verified | Yes | Opera users |
| Managed policy (Google Admin, Intune) | $0 extra | Yes | Company-managed browsers: force-install for everyone |

Each store gives the extension a different ID, which matters for managed policies and Phase 2 sign-in.

**Running cost**: no servers in v1; voices run on the device by default; the library URL can be a free static host; Phase 2 fits Firebase's free tier at team scale.

**Browser differences** are handled by feature detection, not by browser name:

- Confirmed: Chrome and Edge support `sidePanel` and `tts`. Brave, Opera, Vivaldi and Arc are checked in the M6 browser matrix.
- No `chrome.sidePanel` (reportedly Opera and Arc): set a popup at runtime with `action.setPopup`, only when the side panel is missing. A popup in the manifest would block `action.onClicked`.
- The popup closes when the page is clicked, so recording relies on the on-page pill, and editing opens in a full-page tab.
- No built-in AI: the Phase 2 AI buttons stay hidden.
- Few or robotic voices: the voice picker shows what exists; templates and notes still work silently.

## Tech stack, repo layout and testing

The stack is TypeScript on WXT, all open source, and the code lives in [ThomasDevJS/Waymark](https://github.com/ThomasDevJS/Waymark). Matching quality is measured by an automated robustness suite, not by eye.

| Area | Choice |
| --- | --- |
| Extension framework | WXT (Manifest V3, Vite, per-browser builds); the content script is an unlisted script registered at runtime |
| Language | TypeScript, strict mode |
| UI (side panel, editor) | Preact with signals |
| Overlay | Plain DOM in a shadow root (closed in production, open in test builds) |
| Positioning | `@floating-ui/dom` |
| Schemas | Zod |
| Ids | ULID |
| Search | MiniSearch |
| Unit tests | Vitest with happy-dom for pure logic; Vitest browser mode in Chromium for anything that needs layout (visibility, rects, position) |
| End-to-end tests | Playwright with a persistent context, loading the built extension into the bundled Chromium |
| Package manager and CI | pnpm, GitHub Actions |

**Repo layout**

```
waymark/
  docs/SPEC.md
  src/
    entrypoints/
      background.ts      # service worker: messages, storage, runs, tts, badge, permissions
      content/index.ts   # recorder + player bootstrap, registered per granted site
      sidepanel/         # library, recorder controls, editor
      popup/             # fallback when the side panel API is missing
      options/           # voice, site profiles, library URL
    core/
      fingerprint/       # build fingerprints, filter unstable ids and data-like text
      matcher/           # candidates, scoring, wait loop
      recorder/          # event capture, merge rules
      player/            # overlay, spotlight, tooltip, advancing
      model/             # Zod schemas, migrations
      storage/           # guide repository, settings, run state
      messaging/         # typed message bus
      text/              # step templates, markdown-lite renderer
  test/
    fixtures/site/       # the tricky test app
    unit/
    e2e/
```

**Fixture test app**: a small local site that reproduces what breaks guides: in-app routing (history and hash), a modal, a native `<dialog>` and a popover, a div-based custom dropdown with portal options, ARIA switches, a table with an Edit button on every row, a list that re-renders and replaces nodes, class names re-hashed on every load, an open shadow DOM widget, same-origin and cross-origin iframes, a virtualized list, a canvas area, and content that appears after 2 seconds.

**CI guards**: the built manifest must have no `content_scripts` and no `host_permissions`; voice tests spy on `chrome.tts.speak`, because CI machines have no voices; service worker restarts are forced through the DevTools protocol (`ServiceWorker.stopAllWorkers`).

**Robustness suite**: record guides on fixture version A, replay them on mutated version B, and report the find rate and any wrong matches.

- Mutation set A: re-hashed classes, reordered siblings, extra wrapper elements. Target: 95% or more found, zero wrong matches.
- Mutation set B: changed button text. Target: wrong matches stay at zero; not-found is acceptable.
- Repeated elements: row buttons record as `instance: 'any'` and play back on any row; unique look-alikes never match the wrong one.

## Milestones

v1 takes about 8 to 10 weeks for one developer, built core-first: the matcher is proven on the fixture app before any UI depends on it. A milestone is done when its automated checks pass in CI; checks marked manual are done by hand in real browsers.

1. **M0 Scaffold** (3 to 4 days): WXT project, strict TypeScript, lint, CI, side panel opened from the toolbar click, typed messaging with sender allowlists, per-site permission from the panel, runtime content script registration and re-sync.
   - [ ] The build loads in Playwright's Chromium, and the CI manifest guard passes.
   - [ ] Granting a site registers the content script there and nowhere else; revoking removes it; already-open tabs get it after a grant.
   - [ ] Manual: loads unpacked in Chrome and Edge.
2. **M1 Fingerprint and matcher** (1.5 to 2 weeks): core library, fixture app, robustness suite, frame nonce mapping.
   - [ ] Mutation set A: 95% or more found, zero wrong matches.
   - [ ] Ambiguity tests return not-found; repeated-element tests pass.
   - [ ] A fixture test settles whether Navigation API events reach the content script.
3. **M2 Recorder** (1 week): capture, merge rules, navigation, frames, privacy guards, live step list and on-page pill.
   - [ ] The fixture's 10-action scenario, including keyboard activation, a native select, a checkbox and a custom dropdown, yields exactly the expected steps.
   - [ ] A test asserts no typed value is ever stored.
4. **M3 Player** (1.5 weeks): overlay in the top layer and inside modal dialogs, spotlight, tooltip, advance rules per step kind, runs across pages and new tabs, not-found and off-track cards.
   - [ ] End-to-end test plays the scenario across 3 pages, an in-app route change, an iframe and a modal dialog.
   - [ ] A run survives a service worker stopped through `ServiceWorker.stopAllWorkers`.
5. **M4 Editor and voice** (1 week): edit, reorder, delete, note-only steps, re-pick element, test step, templates, `chrome.tts` with online voices hidden.
   - [ ] An author can fix a wrong match by re-picking.
   - [ ] A spy shows `chrome.tts.speak` gets the stored `voiceText` once per step and `stop` on step change and Exit.
   - [ ] Manual: voice is audible in Chrome and Edge.
6. **M5 Discovery and sharing** (1 week): badge, "For this page", search, launcher, deep link, export review, import, library URL on `chrome.alarms`, first-run Allow request.
   - [ ] A pack imported into a second browser profile plays the same way.
   - [ ] The badge count is correct on matching and non-matching pages, including after in-app route changes.
7. **M6 Release** (1 week): popup fallback, browser matrix, private store listing, privacy policy, pilot guides.
   - [ ] Manual: browser matrix for Chrome, Edge, Brave, Opera and Vivaldi (Arc best effort) recorded in `docs/BROWSERS.md`.
   - [ ] Pilot guides recorded on one or two real apps.

**Pilot check**, two weeks after release and outside CI: 90% or more of pilot steps are still found.

Phase 2, only if needed: Firebase workspace sync, on-device AI through the Prompt API, and stuck-user hints.

## Risks and open questions

The biggest risk is guides breaking when the target app changes; the design answers it with redundant fingerprints, a strict no-guess rule, and fast author repair.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Target app UI changes | Steps not found; learners stall | Multi-signal fingerprints, Report broken step, Re-pick element, fragile-step flags, site profiles |
| Wrong element highlighted | Learner is misled, worse than not found | Score threshold plus margin over runner-up; never guess |
| Canvas UIs, closed shadow roots, virtualized lists | Some actions cannot be targeted | Detect at record time, warn the author, use a note-only step |
| Store review slowed by broad optional host permissions | Release delay | Per-site runtime permissions, clear privacy policy, unlisted listing |
| Service worker stopped by the browser | Lost recording or run | All state in `chrome.storage.session`; the content script owns the on-page UI |
| Missing APIs in some Chromium browsers | A feature fails | Feature detection with fallbacks (popup UI, Web Speech, hidden AI) |
| Public library URL | Screen labels of an internal app visible to anyone with the link | Share packs privately, or move to the Phase 2 workspace |

**Open questions**

- [ ] Which app or apps will the first guides target, and do we control their code?
- [ ] Which browsers does the team actually use? Side panel and voice support in Brave, Opera, Vivaldi and Arc is not yet verified.
- [ ] Is the team on Google Workspace? If so, a private Chrome Web Store listing limits installs to the team.
- [ ] Where should the team library live: packs in a shared folder, a library URL, or a Phase 2 workspace?
- [ ] Is Waymark the final name?

## Audit log

An independent review on 4 Nov 2026 checked the first draft against current Chrome, MDN, Edge, WXT, Firebase and Playwright docs. It found 22 issues; all are fixed in the sections above, and claims it could not verify are listed as open questions or milestone checks.

| ID | Severity | Finding | Change in this spec |
| --- | --- | --- | --- |
| A1 | High | Weights summed to 170 against a 60-of-100 threshold; weak signals alone could reach 100% | Score normalized over signals present; one strong signal required; tag is a filter; exact text rules |
| A2 | High | Identical buttons in table rows always tie, so they would never be found | `instance: 'any'` set at record time; any tied candidate is valid at playback |
| A3 | High | Keyboard clicks have no `pointerdown`, and re-renders move the click target | Pending fingerprint linked by `composedPath()`; fallback to the click target |
| A4 | High | The side panel cannot read the tab URL or request permissions from the service worker | Toolbar click opens the panel and grants `activeTab`; the panel requests site access itself |
| A5 | High | Cross-origin frames cannot compute their path; a top-frame overlay cannot reach iframe elements | Nonce-based frame mapping; the service worker picks one winner frame, which draws the overlay |
| A6 | Medium | WXT's default content script registration adds an all-sites install warning | Unlisted script registered at runtime; CI checks the manifest |
| A7 | Medium | Registrations drift from granted sites; open tabs and updates are not covered | Re-sync on install, startup and permission changes; inject into open tabs; clean up old scripts |
| A8 | Medium | Modal dialogs and popovers sit above any `z-index` and make the overlay inert | Overlay as a manual popover, or mounted inside the open dialog; event isolation |
| A9 | Medium | Chrome's "Google" voices are remote, which breaks the on-device promise | Online voices hidden by default; fallback moved to the content script |
| A10 | Medium | Storage could exceed 10 MB; `alarms` missing; library fetch needs CORS or permission | `unlimitedStorage`, `alarms`, library site permission, `TRUSTED_CONTEXTS` |
| A11 | Medium | Version counters collide across copies; runs cannot finish on an old version | `revisionId`, `forkedFrom`, run snapshots, reject newer schemas |
| A12 | Medium | Hash routing and key-like URL segments break matching; `#waymark=` breaks hash routers | Origin plus path rule, hash-routing profile, deep link removed with `replaceState` |
| A13 | Medium | Content scripts are less trusted, and messages from them were not limited | Per-sender allowlists; origin-scoped guide access; stored voice text only |
| A14 | Medium | Merges and advance rules were missing for several step kinds | Merge rules for select, check and submit; advance table per step kind; shadow root observers |
| A15 | Medium | New learners have no granted sites, so hints never appear | One Allow request for all sites in an imported pack or library |
| A16 | Medium | Labels, titles and URLs can carry business data into shared packs | Data-like filter on all text fields; export review |
| A17 | Medium | happy-dom has no layout; some milestone checks were not testable | Vitest browser mode, CI guards, manual checks marked, pilot check moved after release |
| A18 | Medium | Writer and Rewriter APIs are origin trials; AI was both v1 and Phase 2 | AI moved to Phase 2, Prompt API only, hardware limits stated |
| A19 | Low | Alt+Shift switches input language on Windows | Shortcuts through `chrome.commands`, changeable by users |
| A20 | Low | A manifest popup blocks `onClicked`, and popups close on page click | Popup set at runtime only when the side panel is missing; on-page pill |
| A21 | Low | Badge conflict, new-tab runs, one voice channel, i18n, write races, broken-step reports | Precedence, `openerTabId`, focused-tab voice, `lang`, a write queue, a local Problems list |
| A22 | Low | Unlisted listings are still reviewed; Phase 2 Firebase needs more setup | Private listing option; Firebase SDK and offscreen requirements noted |
