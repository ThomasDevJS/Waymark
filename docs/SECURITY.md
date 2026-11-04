# Waymark threat model

Waymark is a Manifest V3 extension with no backend. It records click-by-click guides of web apps and replays them on live pages. This file lists what we protect, from whom, and where the trust boundaries are. `docs/SPEC.md` ("Permissions, privacy and security", "Sharing and storage") has the rules this model checks; `docs/DECISIONS.md` records how they were built.

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| **Guides** (titles, notes, voice text, element fingerprints, URLs) | `chrome.storage.local`, one key per guide plus an index; packs on disk; a library URL | They reveal the target app's screens and labels, and they drive what the player highlights and what the voice says. A tampered guide can mislead a learner ("click Delete account"). |
| **Settings** (granted sites, library URL, per-site launcher, voice choice, Problems list, pending Allow) | `chrome.storage.local` | The library URL and granted sites show which internal apps a user works in. Settings decide which origins get the content script. |
| **Run and recording state** (guide snapshot, step index, frame map, nonces) | `chrome.storage.session` | A forged state could add steps to a recording or move a run. |
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
- **Permissions.** Host access is requested one site at a time from a click in the side panel or options; registrations follow `chrome.permissions.getAll()` and are re-synced on install, startup and every permission change.

## Rules to check

- Every message type is on exactly the right sender allowlist, and its handler authorizes using the sender (tab, frame, origin), not the payload.
- Every string and array in a schema has a maximum; nothing unbounded reaches storage.
- No user or page string reaches `innerHTML`, `href` (except `https:` in notes), `src`, or a CSS selector built without escaping.
- Content scripts receive only ids and titles of guides for their own origin, and the current step of a run on their tab.
- Typed values are never stored; the data-like filter is applied to every label-like string that is stored (accessible name, own text, placeholder, option label, link path, URL segment, page title).
- Nothing about the user's pages goes to logs (`console.*`) in production builds.

The audit against this model, its findings and fixes are recorded in `docs/DECISIONS.md` (D47 onward).
