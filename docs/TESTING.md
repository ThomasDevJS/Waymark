# Testing Waymark

A guide to installing Waymark and trying everything once. It takes about 30 minutes.

## 1. Install

Get the build, either way:

- **From chat:** the file `waymark-0.3.2-chrome.zip`.
- **From GitHub:** open the repository, then **Actions**, then the latest green run on `waymark-v1`. Under **Artifacts**, download **waymark-extension**. That download is a zip that contains `waymark-0.3.2-chrome.zip`.

Unzip `waymark-0.3.2-chrome.zip` into a folder you will keep (for example `Documents/waymark`). The browser loads Waymark from that folder, so don't delete it.

| Browser | Open this page |
| --- | --- |
| Chrome | `chrome://extensions` |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |

1. Turn on **Developer mode** (top right in Chrome and Brave, left side in Edge).
2. If an older Waymark is listed, click **Remove**.
3. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
4. Click the puzzle-piece icon in the toolbar and pin **Waymark**.

To update later, unzip the new build into the same folder and click the reload arrow on Waymark's card.

## 2. Test script

Use a real web app you can log in to, ideally one with forms and more than one page. Tick each box as you go. If something fails, note the step number and see section 4.

### A. Allow a site
- [ ] Open the app, then click the Waymark icon (a white flag on a blue tile). The side panel opens with a short welcome (Allow, Record, Play on one card); press **Get started**. The panel shows the site's name and "Waymark is off on this site".
- [ ] Press the small **?** next to that sentence: it explains what Allow does. Click **Allow on this site** and accept the browser's prompt. The site card now shows a green **Allowed** badge.
- [ ] Press the **?** (Help) next to the gear: Help offers the welcome again, shortcuts, and **What the warnings mean**. Close it with **×**.
- [ ] Open **Settings** (the gear in the panel). Under **Sites**, the site is listed with **Remove**.

### B. Record a guide
- [ ] Type a name under **Record a guide** (for example "Create an invoice") and press **Record**. The toolbar icon shows **REC**, and a red **REC** pill appears at the bottom left of the page.
- [ ] Do a real task of 6 to 10 actions. Include:
  - typing into a field;
  - a dropdown;
  - a checkbox or switch;
  - a link or button that opens another page.
- [ ] Each action appears in the panel as a step, and the pill shows the latest one.
- [ ] What you typed never appears anywhere. Steps say "Enter Email", not the email itself.
- [ ] Try **Pause**, **Undo** and **Add note** once each.
- [ ] Press **Stop**. The editor opens with your steps.

### C. Edit the guide
- [ ] Steps are folded to one line each (steps with a warning start open). Click a step's title to open it, then change its **Title** (`**bold**` and `*italic*` work).
- [ ] Add a note to a step. Open **More options** on another and write a **Spoken text**.
- [ ] In **More options**, click **Add a note after** and write a short note step.
- [ ] Move a step with the ↑ ↓ buttons on its card, and delete one you don't need (the bin button).
- [ ] Click **Test step** on an open step. The element is highlighted on the page, and the panel says "Found on this page." (**How Waymark found it** lists the clues).
- [ ] Click **Re-pick element** on a step, then click a different element on the page. The click does not trigger the app. Click **Use title …** if the suggested title is better.
- [ ] Press **Save**. The panel shows "Saved (version 2)".

### D. Play the guide
- [ ] First, open **Settings** in the panel. Under **Voice**, **In use** names the voice Waymark picked by itself (the best one on this device). Press **Test voice**. You should hear a sample sentence. If you hear nothing, there may be no voice installed for English; the guide still works, silently.
- [ ] If the voice sounds robotic, open **Get better voices** and follow the steps for your system, then restart the browser. **In use** should now show the new voice; on macOS its name contains Premium or Enhanced. On Windows, the natural voices added for Narrator can't be used by browsers. In Edge, turning on **Allow online voices** switches to an “Online (Natural)” voice instead; that one sends the step text to Microsoft. Please tell us which voice **In use** shows on your machine.
- [ ] **HD voice** (optional; downloads 170 MB). In **Settings**, press **Turn on HD voice**. The browser asks to access huggingface.co and raw.githubusercontent.com: allow it (Waymark gives this access back when the download ends). A bar shows the download, then "Checking how fast this device speaks…", then "On. English guides use the HD voice." Press **Test HD voice**: the sample should sound natural. If it says **Too slow**, your computer can't generate speech fast enough; guides keep using the system voice. Please tell us which one you got.
- [ ] With HD voice on, play an English guide. Each step should start speaking within a second or two (the first step can take a few seconds). If a step's HD audio isn't ready in 4 seconds, the system voice reads it instead.
- [ ] Press **Remove HD voice** in Settings. It says "Off.", and guides use the system voice again.
- [ ] Go back to the guide's first page and press **Start** in the panel. The page dims around the first element, with a tooltip reading "Step 1 of N". The step is read aloud.
- [ ] Do each action. The tooltip says what to do ("Click the highlighted item to continue.") and the guide moves on by itself. Note steps have a **Next** button.
- [ ] Try **Back** in the tooltip, and the shortcuts `Alt+.` (next) and `Alt+,` (back).
- [ ] The guide follows you onto the second page.
- [ ] Press the speaker button at the top of the tooltip to mute; the next step is silent.
- [ ] The last step ends with a **Done!** card.
- [ ] Start again from another page of the app. The panel offers **Open start page**.
- [ ] During a run, go to an unrelated page. After about 3 seconds an **off track** card offers **Go back**, **Skip** and the **×** (exit) button.

### E. Find guides on the page
- [ ] On a page where a guide starts, the toolbar icon shows a number: how many guides belong to that page.
- [ ] In the panel, the guide is listed under **For this page**. Type part of a step title in the search box and it shows up.
- [ ] Open **Site options** on the site card, turn on **Show a ? button on this site’s pages** and reload the page. A blue **?** button appears at the bottom right; it lists the guide and starts it.
- [ ] Open the guide's **⋯** (More) menu and click **Copy link**, paste the link into the address bar and open it. The page offers "Start the guide …?".

### F. Share a guide (export and import)
- [ ] In the panel, click **Export…** under the list: checkboxes appear. Select the guide and click **Export 1 selected…**. (For one guide, **⋯ → Share…** does the same.) Read the review: it lists every text and address that will be in the file; element paths are folded under **Technical details**. Click **Remove** on anything that is business data, then **Download guide file**.
- [ ] Make a second browser profile: Chrome profile menu (top right), then **Add**. Install Waymark there too (section 1).
- [ ] In the second profile, open the panel, click **Import…** and choose the file. Confirm **Import**.
- [ ] The panel offers **Allow** for the guide's site. Accept the prompt.
- [ ] Open the app (log in if needed) and press **Start**. It plays the same way as in the first profile.
- [ ] Optional: import the same file again after editing the guide in the first profile. Waymark asks whether to keep yours, replace it, or keep both.

### G. Team library (optional)
- [ ] Put an exported pack at a fixed HTTPS address (for example a raw file in a GitHub repository).
- [ ] In **Settings**, under **Team library**, paste the address and press **Subscribe**. Its guides appear with a **Team** badge and are read-only. **Duplicate** gives you an editable copy.

### H. Library and editor conveniences
- [ ] Open a guide in the editor and type two **Tags**, separated by a comma (for example `billing, onboarding`). Press **Save**. In the list, the tags appear as chips under the search box. Click one: only guides with that tag are listed. Click **Clear**.
- [ ] In the editor, open a step's **More options** and click **Duplicate**. A copy appears right after it. Delete a step with the bin button: a message at the bottom says "Deleted step N." with **Undo**. Press **Undo** within 8 seconds: the step is back in its place.
- [ ] In the list, open a guide's **⋯** (More) menu and click **Duplicate**. A copy named "… (copy)" appears.
- [ ] In the **⋯** menu, click **Delete**. The guide disappears and "Deleted …" shows with **Undo**. Close the side panel and open it again within a few seconds: the message is still there, and **Undo** brings the guide back. Wait 8 seconds after another delete: the message goes, and the guide is gone for good.
- [ ] Play a guide to the end. In the list it now has a green **Completed** badge, and its button reads **Restart**.
- [ ] While a guide plays, press **Restart** in the panel's playing card: the guide starts again at step 1.
- [ ] Open the **⋯** menu of a guide with several steps, pick a step under **Start from**, go to that step's page and press **Start from step N**. The guide starts at that step. On another page the panel tells you which page to open.

### I. Sharing and playback conveniences
- [ ] Open a guide's **⋯** menu and click **Share…**. Under **Format**, pick **How-to text (Markdown)**. The list now shows only the guide title, its site and the steps' titles and notes. A note with an email, amount or code has a yellow **Looks like data** badge. Remove it, then **Download how-to** and open the `.md` file: numbered steps, and no address except the site's.
- [ ] Do the same with **Printable how-to**, open the `.html` file in the browser, and print it (Ctrl+P or ⌘P): one clean page of numbered steps.
- [ ] On an allowed site, press **Alt+R**. The side panel opens and recording starts (REC). Do two actions, then press **Alt+R** again: recording stops and the editor opens on "Untitled guide". On a site that is not allowed, **Alt+R** opens the panel with "Recording didn't start: Allow Waymark on this site first."
- [ ] Press **Alt+W** in a window where the side panel is closed: it opens. Change both keys at `chrome://extensions/shortcuts`; **Settings → About** shows the new keys.
- [ ] While a guide plays, press the speech button in the tooltip (**Replay voice**): the step is read again. Scroll the page away from the highlighted element, Tab to **Repeat step** and press Enter (or click it before scrolling): the page scrolls back, the highlight pulses and the step is read again. Mute: **Replay voice** greys out. Unmute with the same button: it works again in the same step.

## 3. What the warnings mean

The panel lists these too: **?** (Help) → **What the warnings mean**.

| You see | It means | What to do |
| --- | --- | --- |
| "**Not recorded**" in the REC pill | You clicked something Waymark could never find again: no name, text, label or id (for example a long sentence, or a widget with no label). No step was added. | Click the real button, link or field instead, or **Add note** for that part. |
| ⚠ **Hard to find** on a step | You clicked something that isn't a button, link or field (often plain text). It is harder to find again. (A clickable card that the page marks with an id is recorded as the card, without this warning.) | Delete the step if it wasn't needed, or **Re-pick element** to choose the real control. |
| ⚠ **Drawing area** | The click was on a drawing area (chart, map). There is nothing inside it to point at. | Replace the step with a note step. |
| ⚠ **Closed component** | The click was inside a closed web component that Waymark can't see into. It recorded the outer box. | **Test step**. If it is wrong, use a note step. |
| "**Found, but it may break**" after **Test step** | It was found, but only one strong clue matched. A small app change may break it. | **Re-pick element**. If you own the app, add a `data-guide-id` attribute to that element. |
| "Waymark can't find this step" card | The element wasn't found within 8 seconds. Waymark never guesses. | **Retry**, **Skip**, or **Report broken step**. |

### J. First-time clarity (issue #37)
- [ ] In a fresh profile, the welcome is one card. **Get started** hides it; Help (**?**) → **Show the welcome again** brings it back.
- [ ] On an allowed site, the site card is one line. **Site options** shows the **?** button switch and **Turn off Waymark on this site**.
- [ ] Guide rows show only **Edit**, **⋯** and **Start**. Export checkboxes appear only after **Export…**, and **Cancel** hides them.
- [ ] In the editor, steps are one line each. Open one, and **More options** shows spoken text, when to move on, Optional, Add a note after and Duplicate. **Open all steps** opens every step.
- [ ] In Settings, the language list shows names ("English (en)").
- [ ] Open a deep link (**⋯ → Copy link**) on a page where the **?** button is on: the "Start the guide…?" card sits above the button, not under it.

### K. Built-in tutorials (issue #37)
- [ ] In the panel, scroll to **Tutorials** (Built-in): five short guides. Press **Start** on **How Waymark works**. A new tab opens the tutorial page (headed **Tutorial page**) and the guide starts, with voice if it's on.
- [ ] Follow it: press **Next** on notes, click the highlighted **New invoice**, type a name and press **Next**, click **Send invoice**. The **Done!** card ends it. Nothing you typed is read aloud.
- [ ] While **Record your first guide** points at **New invoice**, click **Invoices** in the practice app's top bar instead. After a few seconds a card says the step is on another page; **Go back** returns to it.
- [ ] **What the warnings mean**: step 4 shows the real “can’t find this step” card. **Report broken step** explains what it does on your own guides; **Skip** goes on.
- [ ] In the panel, press **Hide** on Tutorials: they're gone, also after reopening the panel. Help (**?**) → **Show the tutorials again** brings them back. The welcome's **Try a tutorial** opens the tour.
- [ ] On an allowed site, open a tutorial's **⋯** and press **Copy to my guides**. It appears under your guides as “… (copy)”, made of note steps, on that site. On a site that isn't allowed, ⋯ says to allow Waymark first instead.
- [ ] Tutorials never appear in search, **For this page**, the toolbar badge or an export.

## 4. Report a problem

**Debug log** (when something doesn't behave as you expect: a click recorded on the wrong thing, a step that doesn't move on, a step that isn't read aloud):
1. Open **Settings** (the gear in the panel), go to **Problems** and turn on **Keep a debug log**.
2. Do again what went wrong: record it, or play the guide up to the step that misbehaves.
3. Back in **Settings → Problems**, press **Copy debug log** and paste it into the chat. (On a "can’t find this step" card, the copy button copies that page’s part.) Then turn the switch off and press **Clear**.

The log has step titles, element types, scores and page paths, never what you typed, and it is deleted when the browser closes.

- **A step that breaks:** on the "can't find this step" card, click **Report broken step**. Reports are listed in **Settings** under **Problems**; click **Copy as text** to get the text.
- **Anything else:** note the following:
  - browser and version (from `chrome://version`);
  - Waymark's version (on its card in the extensions page; this build is 0.3.2);
  - the step from section 2 where it happened;
  - what you did, what you expected, and what happened instead;
  - a screenshot.

  Leave out passwords and customer data.
- If the panel or page seems stuck: close the side panel, reload the page, and if needed click the reload arrow on Waymark's card in the extensions page. Recordings and runs survive both.
