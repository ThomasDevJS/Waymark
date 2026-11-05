/**
 * The clarity pass (D120–D127) in a real browser: the one-card welcome, Help and inline "?" help,
 * the library's folded actions and export selection, the editor's folded steps, the export
 * review's technical details, and the tooltip's "do this to continue" hint.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { Library } from '../../src/entrypoints/sidepanel/Library';
import { Editor, initiallyOpen } from '../../src/entrypoints/sidepanel/Editor';
import { Welcome, welcomeShown, WELCOME_KEY } from '../../src/entrypoints/sidepanel/Welcome';
import { HelpCard, HelpTip, helpOpen, WARNINGS } from '../../src/entrypoints/sidepanel/Help';
import { ExportReview } from '../../src/entrypoints/sidepanel/ExportReview';
import { dismissToast } from '../../src/entrypoints/sidepanel/Toast';
import { PlayerUI, actionHint } from '../../src/content/player/ui';
import { destroyOverlay, overlayRoot } from '../../src/content/overlay/host';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import type { GuideIndexEntry } from '../../src/core/storage/guides';
import type { ElementFingerprint, Guide, Step } from '../../src/core/model/schema';

const entry = (id: string, title: string): GuideIndexEntry => ({
  id, revisionId: `R${id}`, title, tags: [], startUrl: 'https://app.test/start', updatedAt: '', appOrigins: ['https://app.test'], matchUrls: [], source: 'local', steps: 2, stepTitles: 'One\nTwo',
});

const fp: ElementFingerprint = {
  instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', cssPath: 'form > button', xpath: '/html[1]/body[1]/form[1]/button[1]',
  ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 },
};
const steps: Step[] = [
  { id: 'S0', kind: 'click', title: 'Click **Save**', url: { kind: 'prefix', value: '/' }, advance: 'action', target: fp },
  { id: 'S1', kind: 'click', title: 'Click the chart', url: { kind: 'prefix', value: '/' }, advance: 'action', target: fp, flags: ['canvas'] },
  { id: 'S2', kind: 'note', title: 'All done', url: { kind: 'prefix', value: '/' }, advance: 'next' },
];
const guide: Guide = {
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay a bill', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/start',
  matchUrls: [], version: 1, source: 'local', updatedAt: '', steps,
};

let sent: { type: string; payload: Record<string, unknown> }[];
let stored: Record<string, unknown>;
let root: HTMLElement;

function answer(type: string): unknown {
  switch (type) {
    case 'guide.list':
      return { guides: [entry('A', 'Pay a bill'), entry('B', 'Add a user')] };
    case 'allow.pending':
      return { origins: [] };
    case 'completions.list':
      return { completed: {} };
    case 'trash.list':
      return { items: [] };
    case 'guide.get':
      return structuredClone(guide);
    case 'guide.many':
      return { guides: [structuredClone(guide)] };
    default:
      return {};
  }
}

beforeEach(() => {
  sent = [];
  stored = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string; payload: Record<string, unknown> }) => {
        sent.push(m);
        return { ok: true, data: answer(m.type) };
      },
      openOptionsPage: async () => undefined,
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    tabs: { create: async (o: unknown) => sent.push({ type: 'tabs.create', payload: o as Record<string, unknown> }) },
    storage: {
      onChanged: { addListener() {}, removeListener() {} },
      session: { get: async () => ({}), remove: async () => undefined },
      local: { get: async (k: string) => ({ [k]: stored[k] }), set: async (o: Record<string, unknown>) => Object.assign(stored, o) },
    },
    sidePanel: {},
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  root.querySelector<HTMLElement>('[data-testid="close-editor"]')?.click();
  dismissToast();
  render(null, root);
  root.remove();
  destroyOverlay();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const byTest = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('welcome and help (D121, D122)', () => {
  it('shows all three steps on one card; Get started stores the flag; Help brings it back', async () => {
    welcomeShown.value = null;
    render(h('div', null, h(HelpCard, null), h(Welcome, null)), root);
    await tick();
    const w = byTest('welcome')!;
    expect(w.querySelectorAll('.welcome-list > li')).toHaveLength(3);
    for (const word of ['Allow', 'Record', 'Play']) expect(w.textContent).toContain(word);
    expect(byTest('welcome-next')).toBeNull(); // no paging
    await userEvent.click(byTest('welcome-done')!);
    expect(byTest('welcome')).toBeNull();
    expect(stored[WELCOME_KEY]).toBe(true);
    helpOpen.value = true;
    await tick();
    await userEvent.click(byTest('help-welcome')!);
    await tick();
    expect(byTest('welcome')).not.toBeNull();
    expect(byTest('help')).toBeNull();
  });

  it('lists every warning in Help, and opens Settings at a section', async () => {
    helpOpen.value = true;
    render(h(HelpCard, null), root);
    await tick();
    const text = byTest('help-warnings')!.textContent!;
    for (const w of WARNINGS) expect(text).toContain(w.label);
    await userEvent.click(byTest('help-shortcuts')!);
    expect(sent.find((m) => m.type === 'tabs.create')!.payload).toEqual({ url: 'chrome-extension://x/options.html#about' });
    helpOpen.value = false;
  });

  it('an inline "?" is a disclosure: aria-expanded, and its text appears next to it', async () => {
    render(h(HelpTip, { label: 'What is this?', testid: 'tip' }, 'Plain words.'), root);
    await tick();
    const b = byTest('tip')!;
    expect(b.getAttribute('aria-label')).toBe('What is this?');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(byTest('tip-text')).toBeNull();
    await userEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(byTest('tip-text')!.textContent).toBe('Plain words.');
    expect(b.getAttribute('aria-controls')).toBe(byTest('tip-text')!.id);
  });
});

describe('library (D124)', () => {
  const mount = () => render(h(Library, { tabId: 1, tabUrl: null, onEdit: () => undefined, onStart: () => undefined }), root);

  it('rows show Edit, More and Start; checkboxes only after Export', async () => {
    mount();
    await tick();
    const row = byTest('guide-A')!;
    expect(row.querySelector('input[type="checkbox"]')).toBeNull();
    expect(byTest('link-A')).toBeNull(); // Copy link is in More
    expect(byTest('edit-A')!.textContent).toContain('Edit');
    await userEvent.click(byTest('export')!);
    expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect((byTest('export-selected') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(root.querySelector<HTMLElement>('[aria-label="Select Pay a bill for export"]')!);
    expect(byTest('export-selected')!.textContent).toContain('Export 1 selected');
    await userEvent.click(byTest('select-cancel')!);
    expect(row.querySelector('input[type="checkbox"]')).toBeNull();
    expect(byTest('export')).not.toBeNull();
  });

  it('More has Share… (the review for that guide) and Copy link', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('more-A')!);
    expect(byTest('link-A')).not.toBeNull();
    await userEvent.click(byTest('share-A')!);
    await tick();
    expect(sent.find((m) => m.type === 'guide.many')!.payload).toEqual({ ids: ['A'] });
    expect(byTest('export-review')).not.toBeNull();
    root.querySelector<HTMLElement>('.export-review .editor-bar button.ghost')!.click(); // Cancel
  });
});

describe('review fixes (PR 1)', () => {
  const mountLib = () => render(h(Library, { tabId: 1, tabUrl: null, onEdit: () => undefined, onStart: () => undefined }), root);

  it('Export… moves focus to the selection bar, and Cancel back to Export…', async () => {
    mountLib();
    await tick();
    await userEvent.click(byTest('export')!);
    await tick();
    expect(document.activeElement).toBe(byTest('select-bar'));
    await userEvent.click(byTest('select-cancel')!);
    await tick();
    expect(document.activeElement).toBe(byTest('export'));
  });

  it('Select all picks only the guides on screen, not ones hidden by search', async () => {
    mountLib();
    await tick();
    await userEvent.fill(byTest('search') as HTMLInputElement, 'bill');
    await tick();
    await userEvent.click(byTest('export')!);
    expect(byTest('select-all')!.textContent).toBe('Select all 1 shown');
    await userEvent.click(byTest('select-all')!);
    expect(byTest('export-selected')!.textContent).toContain('Export 1 selected');
    await userEvent.click(byTest('select-cancel')!);
    await userEvent.fill(byTest('search') as HTMLInputElement, '');
  });

  it('a step title with a link has no link inside its toggle button', async () => {
    const withLink = { ...guide, steps: [{ ...steps[0]!, title: 'See [the docs](https://example.com/help)' }] };
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = async (m: { type: string }) => ({ ok: true, data: m.type === 'guide.get' ? structuredClone(withLink) : answer(m.type) });
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    expect(byTest('step-0-toggle')!.querySelector('a')).toBeNull();
    expect(byTest('step-0-toggle')!.textContent).toContain('the docs');
  });

  it('Open all / Fold all counts the steps there are, after a delete', async () => {
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    await userEvent.click(byTest('toggle-all-steps')!);
    expect(byTest('toggle-all-steps')!.textContent).toBe('Fold all steps');
    await userEvent.click(byTest('step-2-delete')!);
    await userEvent.click(byTest('step-0-toggle')!); // fold one of the two left
    expect(byTest('toggle-all-steps')!.textContent).toBe('Open all steps');
  });

  it('Escape closes Help and gives focus back to its button', async () => {
    helpOpen.value = true;
    const opener = document.createElement('button');
    opener.dataset.testid = 'open-help';
    document.body.append(opener);
    render(h(HelpCard, null), root);
    await tick();
    byTest('help-close')!.focus();
    await userEvent.keyboard('{Escape}');
    await tick();
    expect(byTest('help')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('editor (D125)', () => {
  it('starts with steps folded except flagged ones; More options holds the rest', async () => {
    expect([...initiallyOpen(steps)]).toEqual(['S1']);
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    expect(byTest('step-0-title')).toBeNull();
    expect(byTest('step-1-title')).not.toBeNull(); // flagged: open, with its warning explained
    expect(byTest('step-1-flags')!.textContent).toContain('Drawing area');
    const toggle = byTest('step-0-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect((byTest('step-0-title') as HTMLInputElement).value).toBe('Click **Save**');
    expect(byTest('step-0-voice')).toBeNull();
    await userEvent.click(byTest('step-0-more')!);
    expect(byTest('step-0-voice')).not.toBeNull();
    expect(byTest('step-0-optional')).not.toBeNull();
    // A new note opens unfolded, so the author can type its text at once.
    await userEvent.click(byTest('step-0-add-note')!);
    expect((byTest('step-1-title') as HTMLInputElement).value).toBe('New note');
    await userEvent.click(byTest('toggle-all-steps')!);
    expect(byTest('step-3-title')).not.toBeNull();
  });
});

describe('export review (D126)', () => {
  it('folds element paths under Technical details, and they can still be removed', async () => {
    render(h(ExportReview, { guides: [guide], onDone: () => undefined }), root);
    await tick();
    const tech = byTest('export-technical-G1') as HTMLDetailsElement;
    expect(tech.open).toBe(false);
    expect(tech.textContent).toContain('Element path');
    const main = root.querySelector('.export-review > .stack-sm > .review-list')!;
    expect(main.textContent).not.toContain('Element path');
    expect(main.textContent).toContain('Step title');
    tech.open = true;
    const remove = tech.querySelector<HTMLElement>('[data-testid^="remove-"]')!;
    await userEvent.click(remove);
    expect(remove.textContent).toBe('Keep');
  });
});

describe('tooltip hint (D127)', () => {
  const base = { next() {}, back() {}, skip() {}, exit() {}, retry() {}, report() {}, goBack() {}, mute() {} };
  const view = (step: Step): RunView => ({ ...NO_RUN, active: true, status: 'running', guideTitle: 'Demo', stepIndex: 0, total: 2, step, stepToken: 't' });

  it('says what to do for steps that move on by themselves, and not for Next steps', () => {
    expect(actionHint(steps[0]!)).toBe('Click the highlighted element to continue.');
    expect(actionHint({ kind: 'click', advance: 'next' })).toBeNull();
    expect(actionHint({ kind: 'note', advance: 'next' })).toBeNull();
    expect(actionHint({ kind: 'input', advance: 'action' })).toBe('Fill in the highlighted field to continue.');
  });

  it('shows the hint in a run, but not in the editor’s Test step highlight', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    document.body.append(btn);
    const run = new PlayerUI({ ...base, replayVoice() {} });
    run.showStep(view(steps[0]!), btn);
    const hint = overlayRoot().querySelector('[data-testid="action-hint"]')!;
    expect(hint.textContent).toContain('Click the highlighted element');
    // Screen readers hear it with the tooltip.
    expect(overlayRoot().querySelector('.tip')!.getAttribute('aria-describedby')!.split(' ')).toContain(hint.id);
    run.clear();
    const test = new PlayerUI(base);
    test.showStep(view(steps[0]!), btn);
    expect(overlayRoot().querySelector('[data-testid="action-hint"]')).toBeNull();
    test.clear();
    btn.remove();
  });
});
