# Waymark privacy policy

_Last updated: 5 November 2026. Applies to Waymark 0.3.2 and later._

Waymark is a browser extension that records click-by-click walkthroughs ("guides") of web apps and plays them back on the live page. It has no servers and no accounts. **Everything it records stays in your browser unless you export it yourself.**

## The short version
- **No telemetry.** Waymark has no analytics, crash reporting, tracking or advertising, and it never phones home. The optional debug log stays in your browser until you copy it yourself.
- **Your guides stay on your device**, in the browser's extension storage.
- **Waymark never stores what you type** into a page, never takes screenshots, and keeps no page text beyond the short labels needed to find an element again (such as "Save" or "Invoice number").
- **Only three things can make a network request**, and each one starts with something you choose to do:
  1. a team library URL you enter;
  2. the optional HD voice download;
  3. online voices, if you turn on **Allow online voices**.
- Waymark only works on sites you allow: one site at a time, or the sites of a pack or team library you add, each shown with a checkbox.

## What Waymark stores, and where
Everything below is kept in the extension's own browser storage (`chrome.storage`, and Cache Storage for the HD voice files). Websites and other extensions can't read it. Waymark sends none of it anywhere.

| What | Why | How long |
| --- | --- | --- |
| **Guides:** titles, notes, step text; for each step how to find the element again (its label or short text, role, test id, id and name attributes, placeholder, link path, nearby section labels, CSS path, position on the page); and the guide's start address and address patterns | To play the guide back | Until you delete the guide or remove the extension. Team library guides are replaced at each refresh and removed when you unsubscribe |
| **Settings:** voice choices and speed, auto-play, the shade around a highlighted step, the team library URL, per-site options (such as the **?** button), sites waiting for your **Allow** and sites you said **Not now** to, and whether you answered the HD voice offer | To remember your choices | Until you change them or remove the extension |
| **Problems list:** when you press **Report broken step**, the guide, the step, the page's site and path (without query or fragment) and the time | So you can copy a report and send it to the guide's author yourself | The last 200 reports |
| **Completions:** the date and time you finished a guide | Kept for a future progress view; not shown or sent anywhere today | The last 50 per guide |
| **Run and recording state:** which guide is playing and on which step, or the steps of a recording in progress | So a guide keeps going across pages and tabs | Cleared when the browser closes (`chrome.storage.session`) |
| **Debug log** (only while you turn on **Keep a debug log** in Settings → Problems; off by default): what Waymark decided as you recorded and played, such as which kind of element a click picked, match scores, which clues matched, and why a step did or didn't move on or wasn't read aloud. It holds step and guide titles, element types and roles, and page addresses as the site and path only (no part after `?` or `#`, and numbers, ids and emails in the path replaced by `:id`). It never holds what you type, other page text, or your voice's name | So you can copy it and send it to whoever helps you with a problem. Waymark sends it nowhere | The newest 2,000 entries. Cleared when the browser closes (`chrome.storage.session`) or when you press **Clear**. Turning the switch off stops collecting at once |
| **HD voice files** (only if you turn HD voice on): the voice model and an English word list, about 170 MB | To generate speech on your device | Until you press **Remove HD voice** or remove the extension |

What Waymark keeps out of guides on purpose:
- **Values you type** into fields are never stored, not even while recording. A step says "Enter Email", never the email.
- **Text that looks like data** (emails, numbers, ids, dates, amounts, long sentences) is filtered out of labels, link paths, page titles and addresses before anything is saved. Record ids in addresses are dropped or replaced by patterns.
- **No screenshots** and no copies of the page.

## What leaves your device
Waymark itself sends nothing off your device. Three optional features make network requests, and only after you turn them on:

1. **Team library URL.** If you enter a library URL in Settings, Waymark downloads that file when you save it or press **Refresh now**, when the browser starts, and every 6 hours. The request goes only to the address you entered, without cookies or other credentials. That server sees an ordinary download (your IP address and browser); Waymark sends it no data about you or your guides. If that server doesn't allow extensions to read the file, Waymark asks for access to its site, and keeps it so the refresh keeps working. Remove the URL to stop.
2. **HD voice download.** HD voice stays optional and off until you choose it: in Settings, or with **Download** on the offer Waymark shows while a tutorial plays, or while an English guide plays with the side panel open, until you answer it (**Not now** is remembered; **Listen to a sample** plays a clip that ships with Waymark and downloads nothing). Whether to offer it is decided on your device from the browser's language and the number of processor cores and memory it reports; none of that is sent anywhere. If you turn on **HD voice**, Waymark downloads the voice model from Hugging Face (`huggingface.co`, which serves the large model file from its download network, `cdn.hf.co`) and an English word list from GitHub (`raw.githubusercontent.com`), once. Those hosts see an ordinary download request. Waymark gives back its access to them when the download ends. After that, speech is generated on your device, and **no step text is ever sent**.
3. **Online voices.** Your browser may offer voices that run on a server, such as Chrome's "Google …" voices or Edge's "Online (Natural)" voices. They send the text being read to the voice provider (Google or Microsoft), under that provider's privacy policy. Waymark hides and never uses them unless you turn on **Allow online voices**. Without that, only voices on your device are used.

**Sharing is always manual.** Exporting a pack writes a file to your computer, after a review screen that shows everything in it (titles, notes, labels and addresses) so you can remove anything sensitive. What you do with that file is up to you. A **Copy link** link is the guide's start page with `?waymark=<guide id>` added; the site sees that id when the link is opened, and Waymark removes it from the address bar.

## Permissions and why Waymark needs them
| Permission | What it's for |
| --- | --- |
| Access to a site you allow (`optional_host_permissions`) | Asked when you click **Allow on this site**, or **Allow** for the sites listed in a pack or team library you added (each with a checkbox). It lets Waymark record and play guides on that site. Waymark can't see sites you haven't allowed. You can remove a site with **Remove access** in the side panel or in your browser's extension settings. |
| Access to a team library's site | Asked only if you enter a team library URL whose server doesn't allow extensions to read it, and kept so the 6-hourly refresh works. You can remove it in your browser's extension settings. |
| `storage`, `unlimitedStorage` | Keep your guides and settings in the browser. `unlimitedStorage` lifts the 10 MB limit so large guide collections fit, and lets the optional HD voice files (about 170 MB) be kept. |
| `sidePanel` | Shows Waymark's guide list, recorder and editor in the browser's side panel. |
| `scripting` | Runs Waymark's on-page code (the spotlight and recorder) only on the sites you allowed, including tabs of that site that are already open. |
| `activeTab` | Reads the current tab's address when you click the Waymark icon, so it can offer **Allow on this site** for that site. |
| `tts` | Reads steps aloud with your device's voices. |
| `alarms` | Refreshes the team library every 6 hours, and closes the HD voice engine after 3 idle minutes to free memory. |
| `offscreen` | Runs the optional HD voice engine in a hidden extension page. |
| `huggingface.co`, `raw.githubusercontent.com` (temporary) | Asked only when you turn on HD voice, and given back when the download ends. |

Waymark does not ask for your browsing history, your tabs on other sites, or access to all websites.

## Children
Waymark is a workplace tool and is not directed at children. It collects no personal information from anyone.

## Changes to this policy
If Waymark's handling of data changes, this page and its date will change in the same release, and the change will be described here.

## Contact
Questions about this policy: _[contact email to be added before publishing]_.
