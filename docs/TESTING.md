# Testing Waymark

A guide to installing Waymark and trying everything once. It takes about 30 minutes.

## 1. Install

Get the build, either way:

- **From chat:** the file `waymark-0.2.2-chrome.zip`.
- **From GitHub:** open the repository, then **Actions**, then the latest green run on `waymark-v1`. Under **Artifacts**, download **waymark-extension**. That download is a zip that contains `waymark-0.2.2-chrome.zip`.

Unzip `waymark-0.2.2-chrome.zip` into a folder you will keep (for example `Documents/waymark`). The browser loads Waymark from that folder, so don't delete it.

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
- [ ] Open the app, then click the Waymark icon. The side panel opens and shows the site's address.
- [ ] Click **Allow on this site** and accept the browser's prompt. The panel now shows "Waymark is allowed on this site."

### B. Record a guide
- [ ] Type a name under **New guide** (for example "Create an invoice") and press **Record**. The toolbar icon shows **REC**, and a red **REC** pill appears at the bottom left of the page.
- [ ] Do a real task of 6 to 10 actions. Include:
  - typing into a field;
  - a dropdown;
  - a checkbox or switch;
  - a link or button that opens another page.
- [ ] Each action appears in the panel as a step, and the pill shows the latest one.
- [ ] What you typed never appears anywhere. Steps say "Enter Email", not the email itself.
- [ ] Try **Pause**, **Undo last step** and **Add note** once each.
- [ ] Press **Stop**. The editor opens with your steps.

### C. Edit the guide
- [ ] Rename a step: change the **Title** (`**bold**` and `*italic*` work).
- [ ] Add a note to a step, and a voice text to another.
- [ ] Click **Add note after** on a step and write a short note step.
- [ ] Move a step with ↑ ↓, and delete one you don't need.
- [ ] Click **Test step** on a step. The element is highlighted on the page, and the panel says "Found" with the signals that matched.
- [ ] Click **Re-pick element** on a step, then click a different element on the page. The click does not trigger the app. Click **Use title …** if the suggested title is better.
- [ ] Press **Save**. The panel shows "Saved (version 2)".

### D. Play the guide
- [ ] First, open **Settings** in the panel. Under **Voice**, **In use** names the voice Waymark picked by itself (the best one on this device). Press **Test voice**. You should hear a sample sentence. If you hear nothing, there may be no voice installed for English; the guide still works, silently.
- [ ] If the voice sounds robotic, open **Get better voices** and follow the steps for your system, then restart the browser. **In use** should now show the new voice; on macOS its name contains Premium or Enhanced. On Windows, the natural voices added for Narrator can't be used by browsers. In Edge, turning on **Allow online voices** switches to an “Online (Natural)” voice instead; that one sends the step text to Microsoft. Please tell us which voice **In use** shows on your machine.
- [ ] Go back to the guide's first page and press **Start** in the panel. The page dims around the first element, with a tooltip reading "Step 1 of N". The step is read aloud.
- [ ] Do each action. The guide moves on by itself. Note steps have a **Next** button.
- [ ] Try **Back** in the tooltip, and the shortcuts `Alt+.` (next) and `Alt+,` (back).
- [ ] The guide follows you onto the second page.
- [ ] Press the 🔊 button to mute; the next step is silent.
- [ ] The last step ends with a **Done!** card.
- [ ] Start again from another page of the app. The panel offers **Open start page**.
- [ ] During a run, go to an unrelated page. After about 3 seconds an **off track** card offers Go back, Skip and Exit.

### E. Find guides on the page
- [ ] On a page where a guide starts, the toolbar icon shows a number: how many guides belong to that page.
- [ ] In the panel, the guide is listed under **For this page**. Type part of a step title in **Search guides** and it shows up.
- [ ] Tick **Show the ? guide button on this site's pages** and reload the page. A blue **?** appears at the bottom right; it lists the guide and starts it.
- [ ] Click **Copy link** next to the guide, paste the link into the address bar and open it. The page offers "Start the guide …?".

### F. Share a guide (export and import)
- [ ] In the panel, tick the guide's checkbox and click **Export selected…**. Read the review: it lists every text and address that will be in the file. Click **Remove** on anything that is business data, then **Download pack**.
- [ ] Make a second browser profile: Chrome profile menu (top right), then **Add**. Install Waymark there too (section 1).
- [ ] In the second profile, open the panel, click **Import pack…** and choose the file. Confirm **Import**.
- [ ] The panel offers **Allow** for the guide's site. Accept the prompt.
- [ ] Open the app (log in if needed) and press **Start**. It plays the same way as in the first profile.
- [ ] Optional: import the same file again after editing the guide in the first profile. Waymark asks whether to keep yours, replace it, or keep both.

### G. Team library (optional)
- [ ] Put an exported pack at a fixed HTTPS address (for example a raw file in a GitHub repository).
- [ ] In **Settings**, under **Team library**, paste the address and press **Subscribe**. Its guides appear as read-only "team library" guides. **Duplicate** gives you an editable copy.

## 3. What the warnings mean

| You see | It means | What to do |
| --- | --- | --- |
| "**Not recorded**" in the REC pill | You clicked something Waymark could never find again: no name, text, label or id (for example a long sentence, or a widget with no label). No step was added. | Click the real button, link or field instead, or **Add note** for that part. |
| ⚠ **low-confidence** on a step | You clicked something that isn't a button, link or field (often plain text). It is harder to find again. | Delete the step if it wasn't needed, or **Re-pick element** to choose the real control. |
| ⚠ **canvas** | The click was on a drawing area (chart, map). There is nothing inside it to point at. | Replace the step with a note step. |
| ⚠ **closed-shadow** | The click was inside a closed web component that Waymark can't see into. It recorded the outer box. | **Test step**. If it is wrong, use a note step. |
| "**fragile**" after **Test step** | It was found, but only one strong clue matched. A small app change may break it. | **Re-pick element**. If you own the app, add a `data-guide-id` attribute to that element. |
| "Waymark can't find this step" card | The element wasn't found within 8 seconds. Waymark never guesses. | **Retry**, **Skip**, or **Report broken step**. |

## 4. Report a problem

- **A step that breaks:** on the "can't find this step" card, click **Report broken step**. Reports are listed in **Settings** under **Problems**; click **Copy** to get the text.
- **Anything else:** note the following:
  - browser and version (from `chrome://version`);
  - Waymark's version (on its card in the extensions page; this build is 0.2.2);
  - the step from section 2 where it happened;
  - what you did, what you expected, and what happened instead;
  - a screenshot.

  Leave out passwords and customer data.
- If the panel or page seems stuck: close the side panel, reload the page, and if needed click the reload arrow on Waymark's card in the extensions page. Recordings and runs survive both.
