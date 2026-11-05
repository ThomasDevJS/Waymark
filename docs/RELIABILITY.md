# Real-site reliability

`pnpm test:real` (opt-in, needs network, runs under Xvfb, not in CI) records a guide on a public demo app by scripted interaction, reloads, and replays it. Each replayed step is:

- **found**: drawn on an element the task names (checked by identity: the test build marks the spotlighted element);
- **wrong**: drawn on any other element. The matcher rule is zero, always;
- **not found**: the honest "can't find this step" card;
- **stuck**: drawn on the right element, but the learner's action did not move the run on.

Variants: **reload** (always), **narrow viewport**, and **different items** (another list of todos). Harness: `test/real/`. Results and screenshots of wrong or stuck steps go to `test-results/real/`. `pnpm test:real` prints the table below and exits non-zero when any step is wrong, missing or stuck.

## Results

Last full run: 2026-11-05, version 0.2.6. "Before" is the same harness on main at 0.2.2.

| Site | Task | Steps | Before | After | Notes |
| --- | --- | --- | --- | --- | --- |
| TodoMVC React | add, complete, filter (hash routes), clear | 5 | 0/5 found, stuck on step 1 (×3 variants) | 5/5 (×3 variants) | D51: the input step now advances on Enter. The toggle is `instance: 'any'` (shared test id, no name). |
| TodoMVC Vue | same | 5 | not recordable | not recordable | The toggle has no name and no test id: since D47 it is not recorded (4 steps). Next fix. |
| TodoMVC Angular | same | 5 | not recordable | not recordable | Same as Vue. |
| the-internet | log in and out (form submit, full page loads) | 4 | 4/4 | 4/4 (×2) | |
| the-internet | dynamic controls (late, re-labelled, enabled) | 3 | 3/3 | 3/3 (×2) | |
| the-internet | sortable table with row actions | 2 | 2/2 | 2/2 (×2) | Row "edit" links are `any`. |
| the-internet | TinyMCE editor in an iframe | 3 | 3/3 | 3/3 | |
| SauceDemo (React) | log in, add a product, check out | 6 | 6/6 | 6/6 (×2) | |
| GlobalSQA bank (AngularJS, hash routes) | customer login and deposit | 6 | 6/6 | 6/6 (×2) | Two buttons named Deposit, told apart. |
| demoqa (React) | web table: add a record, edit a row | 9 | edit step not recordable | 9/9 (×2) | D53: an svg icon click records its wrapper span. |
| MUI (React) | portaled select | 2 | open step lost | 2/2 (×2) | D52: the select opens on mousedown behind a backdrop. |
| MUI (React) | modal dialog | 2 | 2/2 | 2/2 (×2) | |
| MUI X (React) | date picker | 2 | 2/2 | 2/2 | |
| Ant Design (React) | portaled select in a form | 2 | 3/4 | 4/4 (×2) | The one miss before was the page remount closing the open dropdown (see the date picker); the task now waits for it. |
| Ant Design (React) | date picker | 2 | **1 wrong** (intermittent) | 2/2 | ant.design remounts the page about 3 s after load; for about 1.5 s the only "Select date" field is a look-alike in another demo (taken in 4 of 6 runs before). D55 refuses it: 0 wrong in 21 runs since. The task now waits out the remount (which also closed the open calendar); the fixture tests cover the case. |
| Angular Material | portaled select | 2 | 0/2 (not found) | 2/2 (×2) | D54: `mat-select-10` style ids are generated. |

Tasks passing: **8 of 16 before, 14 of 16 after**. Wrong matches: **1 (intermittent) before, 0 after**. TodoMVC Vue and Angular show as "recorded 4 steps, expected 5" (next fix).

## Known limits

- **Unlabelled controls**: an input with no label, placeholder, name or test id (the-internet's dynamic-controls text field, the selects in Ant Design's Select demo, whose only visible text is their current value) has no strong signal. Since D47 such a step is not recorded, and the pill says so.
- **Data-like option text**: a date cell such as "15" is recorded by its text and position. It works while the calendar shows the same month.
- **Hash routes**: steps on hash-routed pages all share the page's path (no site profile UI yet, D41). Playback still works, because targets are matched on the current page.

## Harness notes

- Chrome's native "Change your password" breach warning (after logging in with a demo site's public password) swallows all input. The harness profile turns the password manager off.
- Locators in the tasks are exact (`exact: true`, scoped to the open popup). A broken locator is a harness error, never counted as a wrong match.
