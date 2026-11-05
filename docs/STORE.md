# Chrome Web Store listing (draft)

> **Not in use (D58):** Waymark is for internal use for now and is installed from GitHub Releases. This draft is kept for a later store listing.

A draft of everything the Chrome Web Store dashboard asks for, matching Waymark 0.3.2. Copy each block into the matching field. The plan in `docs/SPEC.md` ("Distribution and cost") is a **private** listing first, visible only to your Google Workspace domain or a Google Group, then unlisted or public later.

## Store listing tab

**Name:** Waymark

**Summary** (at most 132 characters). The dashboard takes it from the manifest `description`, which today is "Record click-by-click walkthroughs of web apps and replay them on the live page." To use this one (113 characters), set it in `wxt.config.ts` (`manifest.description`) and `package.json` first:

> Record click-by-click walkthroughs of any web app and replay them on the live page. On-device, no account needed.

**Category:** Workflow & Planning (alternative: Tools)

**Language:** English

**Long description:**

> Waymark turns "how do I do this in our app?" into a guide that plays on the real page.
>
> **Record once.** Open the web app, press Record and do the task. Waymark writes a step for every click, choice and form field ("Click Save", "Choose Monthly in Billing period"). It never stores what you type.
>
> **Play it on the live page.** Waymark spotlights the real button or field and shows your note next to it. When you do the step, it moves on, across pages, tabs, pop-up dialogs and embedded frames. If the app has changed and a step can't be found, Waymark says so instead of pointing at the wrong thing.
>
> **Hear it.** Steps can be read aloud with the voices on your device. An optional HD voice (English) runs entirely on your computer after a one-time download.
>
> **Find and share guides.**
> - The toolbar badge shows how many guides there are for the page you're on.
> - Search all guides from the side panel, or turn on a small "?" button on the page.
> - Share guides as a pack file, as a link that starts a guide, or through a team library URL your admin publishes.
> - Before a pack leaves your computer, a review shows everything in it.
>
> **Private by design.**
> - Waymark works only on sites you allow, one at a time.
> - Guides stay in your browser.
> - No account, no servers, no analytics, no screenshots.
> - Online voices are off unless you turn them on.
>
> Waymark is for teams that train people on internal tools, CRMs, admin consoles and other web apps: onboarding, support and change rollouts.

**Screenshots:** see the list below (1280×800 PNG, up to 5).

**Small promo tile:** 440×280 PNG (to be made with the screenshots).

**Store icon:** 128×128 PNG, uploaded separately on this tab (see "Screenshots to produce").

**Privacy policy URL:** the public URL of `docs/PRIVACY.md` (see "Hosting the privacy policy" below; GitHub Pages isn't available for this private repository).

**Homepage / support URL:** optional for a private listing; use the privacy policy host, or leave empty.

## Privacy practices tab

### Single purpose
> Waymark records step-by-step walkthroughs of web apps and plays them back as guided overlays on the live page.

### Permission justifications
The dashboard asks for one justification per permission. Waymark's manifest has no `host_permissions` and no `content_scripts`; site access is optional and asked for one site at a time.

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's guides, settings and the state of a running guide in `chrome.storage`. Nothing is synced or sent to a server. |
| `unlimitedStorage` | A team's guides can exceed the 10 MB default quota of `chrome.storage.local`; without it, saving or importing guides would start failing. It also lets the optional HD voice files (about 170 MB, Cache Storage) be kept. |
| `sidePanel` | The guide list, recorder and step editor live in the side panel, so they stay open next to the web app being recorded or learned. |
| `scripting` | Registers Waymark's content script (`chrome.scripting.registerContentScripts`) only on the sites the user has granted, injects the same bundled script into already-open tabs of a site right after it is granted (`executeScript`), and removes it when access is revoked. That script draws the spotlight and records steps. |
| `activeTab` | When the user clicks the toolbar icon, Waymark reads that tab's URL to offer "Allow on this site" for it, and to show the guides for it, before the site has been granted. |
| `tts` | Reads each step aloud with the browser's text-to-speech voices. Online (remote) voices are hidden unless the user opts in. |
| `alarms` | Refreshes the optional team library URL every 6 hours, and closes the idle HD voice engine after 3 minutes to free memory. |
| `offscreen` | Runs the optional on-device HD voice model (WebAssembly) and plays its audio in an offscreen document, since a service worker can't play audio or run the model's worker threads. Reasons: `AUDIO_PLAYBACK`, `WORKERS`. |
| Optional host permissions `https://*/*`, `http://*/*` | Requested at runtime for one site at a time, from a click on "Allow on this site" (or for the sites listed in a pack the user imports, each shown with a checkbox). Needed to record and play guides on that site. Also requested for the origin of a team library URL the user enters in Settings, when that server does not send CORS headers, so the pack file can be downloaded. Also used briefly for `https://huggingface.co/*` and `https://raw.githubusercontent.com/*` while the user downloads the optional HD voice model (the model file itself is served through Hugging Face's CDN, `*.cdn.hf.co`); those are released when the download ends. |

### Remote code
> **No, I am not using remote code.** All JavaScript and WebAssembly is bundled in the package. The optional HD voice downloads a voice model and a word list, which are data files (ONNX weights, a voice style file, and JSON for the tokenizer, config and lexicon), checked against pinned SHA-256 hashes; they are never executed as code. The extension pages' CSP adds only `'wasm-unsafe-eval'`, for the bundled WebAssembly.

### Data usage
Tick **none** of the data types: Waymark does not collect or transmit user data. For each type, the reason:

| Data type | Collected? | Notes |
| --- | --- | --- |
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | |
| Personal communications | No | |
| Location | No | |
| Web history | No | Page addresses of granted sites are saved only inside guides and the local Problems list, on the device. |
| User activity | No | Clicks are recorded into guides only while the user records, and kept on the device. |
| Website content | No | Only short element labels are stored, on the device, to find elements again. No screenshots, no typed values. |

Then certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

If a reviewer asks about the online voices: they are the browser's own `chrome.tts` voices marked `remote`. Waymark never contacts a voice service itself, and they are off unless the user turns on "Allow online voices".

## Screenshots to produce
The design session will produce these at 1280×800 (PNG, no browser chrome needed), using the demo app (`pnpm demo`) so no real customer data appears:
1. **Playing a guide:** the spotlight on a real button with the step tooltip and its note.
2. **Recording:** the side panel's live step list next to the page, with the REC pill visible.
3. **Editor:** editing a step's title and note, with **Test step** and **Re-pick element**.
4. **Finding guides:** the toolbar badge count and the "For this page" list with search.
5. **Privacy and sharing:** the export review screen, or the "Allow on this site" prompt.

Also needed:
- a 440×280 small promo tile;
- **an icon.** The package has no icons yet (the manifest has no `icons` field). The store requires a 128×128 icon in the package and shows it in the listing, and a 16/32/48 px toolbar icon is wanted as well.

## Publishing as a private listing (domain or group)
1. **Workspace setting (domain listings).** A Workspace admin may first have to allow private items: Admin console → Devices → Chrome → Chrome Web Store settings, "Allow users to publish private apps that are restricted to your domain".
2. **Developer account.** Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that will own the listing ($5, once). For a Workspace domain listing, use an account in that domain.
3. **Group publishing (optional).** To let several people manage the listing, create a Google Group, then link it under **Account → Group publisher** in the dashboard.
4. **Privacy policy URL.** Publish `docs/PRIVACY.md` on a free host (see "Hosting the privacy policy" below) and keep the URL.
5. **Package.** Use the zip from the GitHub Release for the version (or the CI `waymark-extension` artifact). Don't rebuild by hand: the release zip is the one CI checked.
6. **New item.** In the dashboard, **New item → upload the zip**.
7. **Store listing tab.** Fill it from this file and add the screenshots.
8. **Privacy practices tab.** Single purpose, the permission justifications, "no remote code", and the data usage answers above.
9. **Distribution tab → Visibility:**
   - **Private.** Then choose who can install:
     - **Everyone at your domain** (Workspace accounts only); or
     - **Trusted testers:** a list of email addresses, or one or more **Google Groups**, managed on the dashboard's **Account** page. Group members can install it from the item's link.
   - Regions: all regions, unless there's a reason to limit them.
10. **Submit for review.** Private items are still reviewed. Expect a few days for a first submission; extensions with broad optional host permissions can take longer.
11. **After approval,** share the item's link with the domain or group. Admins can also force-install it with Google Admin (**Devices → Chrome → Apps & extensions**) using the item's ID.
12. **Updates:** `pnpm release X.Y.Z`, merge, tag the release (D56), upload the new release zip in **Package → Upload new package**, and submit. Installed copies update automatically.

Notes:
- The listing gives Waymark a new extension ID. Managed policies, and the Phase 2 sign-in, are tied to that ID.
- Edge Add-ons, a free separate listing, can reuse this text.

## Hosting the privacy policy
The Chrome Web Store needs `docs/PRIVACY.md` at a public URL. GitHub Pages isn't available for this repository, which is private on the GitHub Free plan. Free alternatives:
- **A separate public repository with GitHub Pages** (for example `waymark-privacy`) holding only this page. Free on the Free plan, stays on GitHub, and is easy to update.
- **A public GitHub Gist** with the policy. Free, renders Markdown, and keeps a stable URL across edits. Plainer, but needs no setup.
- **Cloudflare Pages** or **Netlify** (free tiers): deploy a single static page; both can build from a private repository.
- **Google Sites** (free with a Google account): a good fit for a private Workspace listing, since the reviewers and the audience are already in Google.
- **Codeberg Pages**: free static hosting from a public Codeberg repository.
Whichever you choose, put the URL in the store listing and in the README. Post only the policy itself.
