# Waymark threat model

Waymark is a Manifest V3 extension with no backend. It records click-by-click guides of web apps and replays them on live pages. This file lists what we protect, from whom, and where the trust boundaries are. `docs/SPEC.md` ("Permissions, privacy and security", "Sharing and storage") has the rules this model checks; `docs/DECISIONS.md` records how they were built.

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| **Guides** (titles, notes, voice text, element fingerprints, URLs) | `chrome.storage.local`, one key per guide plus an index; packs on disk; a library URL | They reveal the target app's screens and labels, and they drive what the player highlights and what the voice says. A tampered guide can mislead a learner ("click Delete account"). |
| **Settings** (granted sites, library URL, per-site launcher, voice choice, Problems list, pending Allow) | `chrome.storage.local` | The library URL and granted sites show which internal apps a user works in. Settings decide which origins get the content script. |
| **Run and recording state** (guide snapshot, step index, frame map, nonces) | `chrome.storage.session` | A forged state could add steps to a recording or move a run. |
| **Debug log** (only while the Settings switch is on; D110–D112) | `chrome.storage.session`, 2,000 entries | It describes what the user did on their sites (pages visited, step titles, clicks near targets). It must hold no typed values, no queries or fragments, and no page text beyond the guide's own. |
| **The user's page data** (typed values, record ids in URLs, names and amounts on screen) | the target page only | Must never be stored, exported, logged or sent anywhere. Only element labels and short own text are kept, after the data-like filter. |
| **Site access** (optional host permissions and the registered content script) | the browser | Each grant lets the content script read that site. A wrong grant or a stale registration widens access. |

## Attackers

1. **A malicious page script** on a granted site. It controls the DOM, can dispatch events, `postMessage` into frames, change `location`, overwrite page globals, and set element labels to anything. It cannot call `chrome.runtime` or read the content script's isolated world. It *can* shape every string the recorder or matcher reads.
2. **A malicious imported pack or library URL.** It controls every field of every guide in the file, its size and nesting, and (for a library) when and what the server answers. It wants to: run script in an extension page, get access to more sites, show convincing fake instructions, leak data, or exhaust storage.
3. **A compromised or hostile iframe**, cross-origin or same-origin, granted or not. It can post messages to its parent or children and race the frame nonce, and if its origin is granted it runs its own content script.
4. **A compromised renderer.** Chromium's guidance is that a content script's messages may be forged by a compromised renderer process. Everything from a content script is untrusted, and the service worker must use `sender.tab`, `sender.frameId` and `sender.origin`/`sender.url`, not values in the payload, for authorization.
5. **Another extension.** It can call `chrome.runtime.sendMessage(ourId, …)` only if we listen to `onMessageExternal` (we do not); it can inject its own content scripts into the same pages and see the same DOM (out of scope beyond our overlay).
6. **Anyone with a shared link** (a deep link `#waymark=<id>` or a library URL). A deep link can try to start a guide on a page; a library URL reveals the pack to anyone who has it.

Out of scope: a compromised browser or OS, a malicious extension with `debugger` or host access to `chrome-extension://` pages, physical access.

## Trust boundaries

```
 Page (untrusted)  ──DOM, events, postMessage──▶  Content script (isolated world; untrusted to the SW)
                                                     │ chrome.runtime messages (Zod + sender allowlist)
                                                     ▼
 Pack file / library URL (untrusted) ──text──▶  Service worker (trusted hub; owns storage, permissions, tts)
                                                     ▲ chrome.runtime messages (extension-page allowlist)
                                                     │
                                       Extension pages: side panel, popup, options (trusted UI,
                                       but render untrusted strings from guides and pages)
```

- **Page → content script.** Everything read from the DOM is untrusted text. It is filtered (data-like filter, length caps) before it becomes part of a fingerprint or a title, and it never reaches `innerHTML`. Page `postMessage` is ignored except the frame hello and nonce, and the nonce is only accepted after the service worker verifies it.
- **Content script → service worker.** The allowlist for senders with `sender.tab` (protocol `CONTENT_ALLOWED`); every payload is Zod-validated with length caps. Replies and pushes to a content script carry only data for its own origin: no settings, no other sites' guides, no library URL.
- **Pack and library → service worker.** Size cap (5 MB), Zod schema with string and array caps, 500 steps per guide, real http(s) origins without wildcards, newer versions rejected. Parsed with `JSON.parse` into plain data; no object merging that could reach `__proto__`.
- **Service worker → extension pages.** Pages are trusted code but show untrusted strings. Notes render through the markdown allow-list (bold, italic, line breaks, `https:` links with `target="_blank" rel="noopener noreferrer"`); all other strings are text nodes.
- **Storage.** Both `local` and `session` are `TRUSTED_CONTEXTS`, so a content script cannot read or write them directly.
- **Permissions.** Host access is requested from a click in the side panel or options. The one Allow request for the sites of imported or library guides (SPEC: Discovery, "First-run access") lists every site by name, each can be unticked, and at most 50 are queued (D48). Registrations follow `chrome.permissions.getAll()` and are re-synced on install, startup and every permission change. A library site granted only to fetch the pack is excluded and is not treated as allowed until the user allows it in the panel; unsubscribing gives that permission back (D80).

## Rules to check

- Every message type is on exactly the right sender allowlist, and its handler authorizes using the sender (tab, frame, origin), not the payload.
- Every string and array in a schema has a maximum; nothing unbounded reaches storage.
- No user or page string reaches `innerHTML`, `href` (except `https:` in notes), `src`, or a CSS selector built without escaping.
- Content scripts receive only ids and titles of guides for their own origin, and the current step of a run on their tab.
- Typed values are never stored; the data-like filter is applied to every label-like string that is stored (accessible name, own text, placeholder, option label, link path, URL segment, page title).
- Nothing about the user's pages goes to logs (`console.*`) in production builds.
- The debug log (D110–D112) is collected only while its switch is on. Content scripts append through `debug.log` only (Zod-checked, own tab and frame from the sender, 50 entries per message, 100 per tab per second, values capped and redacted again by the service worker). `debug.copy` gives a content script only its own tab's entries since its run started, about its own site or the run, with no settings, and only when that run's guide includes the sender's origin.

## Audit (4 Nov 2026)

The first audit against this model, with an independent review, is recorded in `docs/DECISIONS.md` D48 (findings, fixes, and what was deferred).

Known and accepted:
- Granting `http://localhost:3000` grants every port on that host, because match patterns cannot name a port.
- A library redirect is checked after it is followed, so one credential-less GET can reach the redirect target before the refresh is refused.
- A page can break frame mapping in its own tab (it can push its own frames' nonces out of the per-tab cap). It only hurts guides on that page.
