# Waymark UX: first-time user audit and plan

Issue #37: "super easy to understand & navigate (would be irony if a guide extension would need a guide)". This note is the audit (Step 1) and the plan the UX PRs follow. Decisions it leads to are D120–D129 in `docs/DECISIONS.md`.

**Method.** The baseline screenshots came from `SHOTS=before pnpm screens` on `main` at bc65773 (0.3.2): 44 panel and settings shots and 45 on-page shots. I did a heuristic evaluation against Nielsen's ten heuristics and a cognitive walkthrough of the first-time journey: install, open panel, allow site, record, edit, play, share/export, find guides later, settings. An independent subagent then walked the same journey from the screenshots only, acting as a non-technical office manager (section 2). Where we both found the same problem, the finding is marked **(both)**.

## 1. Findings, ranked by impact

Impact = how many first-time users hit it × how badly it stops them.

| # | Finding | Where | Heuristic | Impact |
|---|---|---|---|---|
| 1 | **The editor shows every field of every step at once.** A 7-step guide is a 4,400 px wall of Title, Note, Voice text, "Moves on", Optional, Test step, Re-pick, Note after and Duplicate repeated seven times. You can't see the guide's shape, or tell which steps need attention. **(both)** | Editor | 8 aesthetic & minimalist, 6 recognition | High |
| 2 | **No way to try Waymark without your own web app.** A first-timer has to pick a real site, grant access and record before seeing what a guide looks like. The welcome explains, but you can't *see* it. Nothing shows a guide playing until you have made one. **(both)** | First run | 10 help, 2 match real world | High |
| 3 | **The welcome reads like a manual.** Three paginated cards (Back / Next / tabs / Skip) to read three sentences. After the welcome there is no way to bring it back, and no help anywhere in the panel. **(both)** | Welcome, panel | 10 help, 7 efficiency | High |
| 4 | **The primary action is unclear on most screens.** On an allowed site, "Remove access" (red) sits next to the launcher switch on the site card, the most prominent thing above Record. In the library each row has five controls (checkbox, link, pencil, ⋯, Start) with equal weight. **(both)** | Panel | 8, 5 error prevention | High |
| 5 | **Jargon and system words**: raw origins in monospace (`http://127.0.0.1:8093`), "Not allowed" (sounds like an error), "pack", "Pack address", "Subscribe", "Moves on", "Voice text", "fragile", "CSS path", "surroundings", "page position", "Closed component", "Drawing area", `data-guide-id`, a language select showing "en". **(both)** | Everywhere | 2 match real world | High |
| 6 | **Export lives behind checkboxes** that every row shows all the time, with "Export selected…" disabled and a hint underneath. Sharing one guide, the common case, takes select, then Export, then review. Copy link is an unlabelled chain icon. **(both)** | Library | 6, 7 | Medium |
| 7 | **The learner isn't told what to do on the page.** An action step's tooltip has the title and icons, but no Next and no "do this to continue". The persona got stuck on step 1 ("Look at the revenue chart"): *"I don't know how to move on — dead end."* The four header icons have no visible labels. **(both)** | Tooltip | 1 visibility, 6 recognition | High |
| 8 | **Recording feedback is cut off and reads as blame.** The REC pill truncates "Not recorded: Waymark could not find this again. Click…", the instruction part. A chart click becomes "Click **the element**" with two warnings and three fixes in jargon ("Re-pick the real control", "note step"). **(both)** | REC pill, recorder | 9 help users recover | High |
| 8b | **The export review is a wall of code.** "Element path /html[1]/body[1]/main[1]/div[3]/canvas[1]" and CSS selectors, each with Remove, among the texts the author actually cares about. *"I'm afraid to remove anything."* (walkthrough) | Export review | 8, 2 | High |
| 8c | **Raw markdown in fields**: titles show `Click **Create invoice**` in the Title box and the export list; the persona thought it was broken. (walkthrough) | Editor, export | 4, 2 | Medium |
| 9 | **Empty states don't teach.** "No guides yet. Record one above, or import a pack someone shared with you." doesn't say what a guide is or what will happen next. With no site in the tab, the empty state is fine but doesn't offer the practice page. | Panel | 10 | Medium |
| 10 | **Warnings need context.** The recorder's inline warning text is good, but a learner sees "Hard to find" and "Drawing area" without knowing whether it's serious. There's no single place that explains every warning (it's only in docs/TESTING.md). | Recorder, editor, cards | 9 | Medium |
| 11 | **Settings mixes everyday and expert options.** Voice, HD voice (a 170 MB download, model names), Team library and a debug log all have equal weight, with long paragraphs of detail. | Settings | 8 | Medium |
| 11b | **Small on-page and settings bugs**: the `?` launcher covers the deep-link offer's Start button ("Sta…"); Settings shows "en" for the language and "not set Exit the guide" in the shortcut list; Sites shows `http://127.0.0.1` while the panel shows `:8093`. (walkthrough) | Page, Settings | 4, 9 | Medium |
| 12 | **Consistency gaps**: "Start" in the list vs "Play" in the welcome; "New guide" vs "Record"; "Team library" in Settings vs "Team" badge; "Import…" with no hint of the file it wants. | Panel | 4 consistency | Low |
| 13 | Two equal-weight actions in the playing card (Restart, Stop) with no step title; it says "Playing · step 1 of 7" but not what step 1 is. | Panel | 1 | Low |

What already works well (keep): the welcome's promise ("on the real page"), the spotlight and tooltip, the live step list while recording, inline warning explanations, Undo toasts instead of confirm dialogs, the Allowed badge, the not-found card's three clear choices, and the export review's "Looks like data" badges.

## 2. Independent first-time-user walkthrough

A subagent acting as a non-technical office manager walked the journey from the screenshots only, without the code or this audit. Its top problems, in its own ranking:

1. A step with nothing to click shows no Next button. Learners get stuck (high).
2. The export review is a wall of code ("Element path /html[1]/body[1]…") with Remove buttons (high).
3. The editor is overwhelming: about 10 controls per step, plus jargon ("Moves on", "Re-pick element", "CSS path") (high).
4. The recording warnings are jargon and read as blame. The REC pill message is cut off (high).
5. Raw `**` in titles and in the export (medium).
6. Unlabelled icons in the tooltip and library rows (link, pencil, ⋯; restart, replay voice, mute) (medium).
7. The first run stacks three empty boxes, and "click the Waymark icon in the toolbar" assumes you know it hides behind the puzzle piece (medium).
8. Settings is full of technical words (en, Kokoro, Hugging Face, 170 MB, HTTPS pack address, "into the chat", "not set"). The `?` launcher covers the deep-link Start button (medium).

What worked for it: the three-word welcome (Allow, Record, Play) and the single Allow button with its privacy line; "name it, press Record"; the dimmed page, highlight and progress; "This step is on another page. Go back"; the Undo toasts; the on-page `?` menu.

Its findings are merged into the table in section 1 (marked **(both)** or "walkthrough"). It found two things my own review missed: the export review's code rows (8b) and raw markdown (8c), plus the small bugs in 11b.

## 3. Information architecture and navigation

The side panel is one scrolling column; it stays one column. What changes is what's on it and in which order: one primary action per state, and everything else one click away.

```
Header:  [Waymark mark] Waymark                      [? Help] [⚙ Settings]

State A: no web page in the tab
  Card: "Open the web app you want to guide" + [Or try a tutorial]   ← new
  Guides (yours, if any)
  Tutorials                                                        ← PR 2

State B: a site Waymark isn't allowed on
  Card: site name (host only, no scheme/port noise) · "Waymark is off here"
        one sentence on what Allow means · [Turn on Waymark for <host>]  (primary)
  Guides (read-only list: you can see, not play)
  Tutorials

State C: an allowed site (the normal case)
  Site strip: host · "On" badge · [Site options ▾] → ? button switch, Turn off for this site
  Record card: "Record a guide" · name field · [● Record] (primary)  · (?) how recording works
  Guides: search (only with 4+ guides) · tag chips · For this page / Other guides
          row = title, meta · [Start] (primary) · [Edit] · [⋯]  (⋯ = Start from step, Share…, Copy link, Duplicate, Delete)
          footer = [Import…] [Export…] (Export enters "select" mode; checkboxes appear only then)
  Tutorials (PR 2; can be hidden)

Recording:   status, Stop (primary), Pause, Undo, Add note, live steps
Editor:      guide title, tags (folded under "Details"), steps as collapsed rows
             (number · kind · title · warning badge · ↑ ↓ 🗑 · ▸), one step open at a time,
             inside: Title, Note, [Test step] [Re-pick]; "More options" folds Voice text,
             When to move on, Optional, Duplicate, Note after.
             Sticky bar: Save (primary) · Close.
Help (?):    a panel card with: Take the tour (welcome again), Tutorials (PR 2),
             What the warnings mean, Keyboard shortcuts, Report a problem → Settings
```

Navigation rules:
- **One primary button per screen state** (Allow / Record / Stop / Save). Destructive actions (Remove access, Delete) are never primary and never sit next to the primary action; they move into a disclosure or menu.
- **Progressive disclosure**: anything a first-timer doesn't need on day one is folded: site options, the editor's advanced step fields, export selection, search until there are enough guides to search.
- **Help is contextual and inline**: small "?" disclosure buttons next to the concept they explain (Allow, Record, steps' "When to move on", Voice text, Tags, team library). They expand a sentence in place; no hover-only tooltips (unreachable for keyboard and touch).
- **The welcome can always come back** from Help.

## 4. Microcopy principles

1. **Say what happens, in the user's words.** "Turn on Waymark for this site" (not "Allow on this site" alone); "Waymark is off on this site" (not "Not allowed").
2. **Lead with the verb, one idea per sentence**, ≤ 20 words. Buttons are verbs: Record, Start, Save, Share.
3. **No system words in the main path.** Host names, not origins with schemes and ports. "Guide file", not "pack" (except where the file format itself is named, in export). "Team library address", not "Pack address". No "CSS path", "fragile", "signals".
4. **Every empty state teaches**: what this area is for, plus the one next step (a button when possible).
5. **Every warning says how serious it is and what to do.** "May not be found again. Re-pick the real button, or delete the step."
6. **Same name for the same thing everywhere**: Guide, Step, Record, Start (play), Edit, Share (export or link), Team library, Tutorials, Practice page.
7. **Reassure about privacy where the worry starts**: next to Record ("What you type is never saved") and Allow ("only on sites you turn on").
8. Keep texts the e2e tests assert only where they still read well; otherwise change the copy and the test together (D94's rule).

## 5. Built-in tutorials

### 5.1 The open question: where do built-in guides play?

Guides play on web pages through the content script, which is registered at runtime only on sites the user allows. Extension pages (`chrome-extension://…`) never get a content script, and built-in guides must never touch real sites or ask for access. The options were:

| Option | Shows the real player | New permissions | Teaches the panel | Cost | Verdict |
|---|---|---|---|---|---|
| **A. Bundled Practice page**: an extension page shaped like a small app that imports the player and overlay modules and plays guides on itself | Yes: the real spotlight, tooltip, cards, matcher, advance rules and voice | None | Through note steps and a picture of the panel | Medium | **Chosen** |
| B. The demo app | Yes | Site access to a localhost or hosted demo, which users don't have | No | Low | No: needs a server and a grant |
| C. Note-only guides pointing at the side panel | No | None | Partly | Low | No: nothing to try |
| D. A separate tour player for the panel itself (coach marks) | No, a second player | None | Yes | Medium | Later (PR 3), only if needed |

**Choice: A, the Practice page** (`practice.html`). It's an extension page, so it needs no new permission and runs no code on any site. It plays built-in guides with the *real* player UI (`PlayerUI`), the real matcher (`waitForMatch`) and the real advance rules (`watchAdvance`), driven by a small local run loop instead of the service worker. The learner sees exactly what their own learners will see. The page is a small fake app ("Northwind Invoices": a dashboard, an invoice form, a customer list), so the tutorials can make the learner *do* things (click, type, pick, check) and watch the guide move on.

Panel coach marks (D) are not built in PR 2. PR 1's inline "?" help plus collapsed editor steps should remove most of the need. Section 6 says when to revisit.

### 5.2 How the Practice page works

- `src/entrypoints/practice/` is an unlisted extension page. It renders the practice app and, given `?tutorial=<id>`, plays that tutorial on itself. Without an id it shows the app with a list of tutorials.
- **Local run loop** (`src/core/tutorials/runner.ts`, pure, unit-tested): holds `stepIndex`, builds a `RunView` for `PlayerUI`, and handles next, back, skip, exit, retry and done. The page shell finds the target with `waitForMatch`, draws with `PlayerUI.showStep`, and watches with `watchAdvance`. It doesn't use the service worker's run state, `runs.ts`, the frame board or the registry, so the D84 frame work is untouched.
- **Voice**: a new extension-page message `tutorial.speak { tutorialId, stepId }`. The service worker looks the text up in the *bundled* pack (it never speaks text sent by a page), honours mute and "Read each step aloud", and uses the same voice choice as guides (`pickVoice`; system voice only, no HD). `tutorial.stop` stops speech. Mute in the tooltip uses the existing `voice.settings.set`.
- **Off track and not found**: leaving the step's view of the practice app shows the real off-track card (Go back returns); the warnings tutorial points at a missing element to show the real not-found card.
- **Never touches real sites**: the page only runs its own document; tutorials have no `appOrigins` and can't be started with `run.start` (the pack isn't in guide storage).

### 5.3 The pack

`src/core/tutorials/pack.json`, bundled at build time, validated by a Zod `TutorialPackSchema` in a unit test and at load. Steps reuse `StepSchema` fields (kind, title, note, voiceText, advance). A target is written as the practice element's `data-guide-id`; at play time the page builds the element's fingerprint and the real matcher finds it (a browser test checks every target is found uniquely). Five guides, 5–8 steps each:

| Tutorial | What the learner does on the Practice page |
|---|---|
| **How Waymark works** (60 s tour) | Clicks through the app as a learner would: a click step, a typed field, a note step, Done. Learns the spotlight, the tooltip, Back, Mute and Exit. |
| **Record your first guide** | Practises the task they'd record (open the form, fill it in, submit). Note steps show the panel's Record card and what happens while recording (REC pill, live steps, typed text never saved, Stop opens the editor). Ends with "Try it on your app". |
| **Edit a guide** | A picture of an editor step on the page; note steps explain titles, notes, voice text, Test step and Re-pick, with a real "re-pick" exercise: click the button the guide should point at. |
| **Share a guide** | Export (guide file or how-to), Copy link, Import, Team library. Notes plus clicks on a "Share" menu in the practice app. |
| **What the warnings mean** | Hard to find, Drawing area, Closed component, "Found, but fragile", and the not-found card. The page shows a real not-found card by asking the player for a missing element, so the learner sees Retry, Skip and Report. |

### 5.4 In the panel

- A **Tutorials** section (with a "Built-in" badge) lists the five with their length. **Start** opens the Practice page in a new tab (`chrome.tabs.create`; no permission). It's shown in every state, including on a tab with no site. It can be **hidden** (`ui:tutorialsHidden` in `storage.local`), and Help brings it back.
- The welcome gets **Try a tutorial** next to Get started.
- Built-in guides are **read-only**. They aren't in the guide index, so they don't count against the library, never appear in exports, in "For this page", in badges or in search results, and never ask for site access.
- **Duplicate** ("Copy to my guides") copies a tutorial into the user's library *on the current allowed site*, as a starting template: the titles, notes and voice texts stay, and steps that point at practice elements become note steps, so the copy never plays wrongly. It's only offered on an allowed site, so it never asks for access by itself.

## 6. PR plan

1. **PR 1, clarity**: the IA in section 3 and the copy in section 4. That covers the collapsed editor, Help, the inline "?" help, the welcome, the empty states, the tooltip's "do it on the page" hint, the pill's full notice, folding the export review's technical rows under "Technical details", and the section 1 #11b fixes (language names, shortcut list, the launcher and the deep-link card). Tests change only where the UI changed.
2. **PR 2, tutorials**: section 5.
3. **PR 3 (optional)**: in-panel coach marks for the first use of the editor and Settings. Do it only if, after PR 1 and PR 2, the first-time-user review still gets stuck in the editor or Settings.
