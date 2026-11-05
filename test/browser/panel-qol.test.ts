/**
 * Side panel conveniences in a real browser (D100–D102): tag chips, the completed checkmark and
 * Restart, "More" (Start from step, Duplicate, Delete), and the Undo toast with focus handling.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { Library } from '../../src/entrypoints/sidepanel/Library';
import { Editor } from '../../src/entrypoints/sidepanel/Editor';
import { dismissToast } from '../../src/entrypoints/sidepanel/Toast';
import type { GuideIndexEntry } from '../../src/core/storage/guides';
import type { Guide } from '../../src/core/model/schema';

const entry = (id: string, title: string, tags: string[], steps = 3): GuideIndexEntry => ({
  id,
  revisionId: `R${id}`,
  title,
  tags,
  startUrl: 'https://app.test/start',
  updatedAt: '',
  appOrigins: ['https://app.test'],
  matchUrls: [],
  source: 'local',
  steps,
  stepTitles: Array.from({ length: steps }, (_, i) => `Do thing ${i + 1}`).join('\n'),
});

const guide: Guide = {
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay a bill', lang: 'en', tags: ['billing'],
  appOrigins: ['https://app.test'], startUrl: 'https://app.test/start', matchUrls: [], version: 1, source: 'local', updatedAt: '',
  steps: ['One', 'Two', 'Three'].map((t, i) => ({ id: `S${i}`, kind: 'note' as const, title: t, url: { kind: 'prefix' as const, value: '/' }, advance: 'next' as const })),
};

let sent: { type: string; payload: Record<string, unknown> }[];
let guides: GuideIndexEntry[];
let trash: { id: string; title: string; deletedAt: number; undoUntil: number }[];
let root: HTMLElement;

function answer(type: string, payload: Record<string, unknown>): unknown {
  switch (type) {
    case 'guide.list':
      return { guides };
    case 'allow.pending':
      return { origins: [] };
    case 'completions.list':
      return { completed: { A: '2026-11-04T10:00:00Z' } };
    case 'trash.list':
      return { items: trash };
    case 'guide.delete': {
      const g = guides.find((x) => x.id === payload.id);
      guides = guides.filter((x) => x.id !== payload.id);
      return { ok: true, undoUntil: g ? Date.now() + 8000 : null };
    }
    case 'guide.restore':
      guides = [...guides, entry(String(payload.id), 'Back', [])];
      return { ok: true };
    case 'guide.get':
      return structuredClone(guide);
    case 'guide.save':
      return { ...(payload.guide as Guide), version: 2, revisionId: 'R2' };
    case 'guide.duplicate':
      return { ...guide, id: 'COPY', title: `${guide.title} (copy)` };
    default:
      return {};
  }
}

beforeEach(() => {
  sent = [];
  trash = [];
  guides = [entry('A', 'Pay a bill', ['billing', 'Finance']), entry('B', 'Add a user', ['admin']), entry('C', 'Refund', ['billing'])];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string; payload: Record<string, unknown> }) => {
        sent.push(m);
        return { ok: true, data: answer(m.type, m.payload) };
      },
    },
    storage: { onChanged: { addListener() {}, removeListener() {} } },
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  dismissToast();
  render(null, root);
  root.remove();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const byTest = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const titles = () => [...root.querySelectorAll('.guide-title')].map((e) => e.textContent);

describe('library (D100–D102)', () => {
  let starts: [string, number | undefined][];
  const mount = () => {
    starts = [];
    render(h(Library, { tabId: 1, tabUrl: null, onEdit: () => undefined, onStart: (id: string, i?: number) => starts.push([id, i]) }), root);
  };

  it('filters by tag chips, with search, and says when nothing matches', async () => {
    mount();
    await tick();
    const chips = [...root.querySelectorAll<HTMLButtonElement>('button.chip')];
    expect(chips.map((c) => c.firstChild?.textContent ?? c.textContent)).toHaveLength(3);
    expect(byTest('tag-billing')!.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(byTest('tag-billing')!);
    expect(byTest('tag-billing')!.getAttribute('aria-pressed')).toBe('true');
    expect(titles().sort()).toEqual(['Pay a bill', 'Refund']);
    await userEvent.click(byTest('tag-admin')!);
    expect(titles()).toEqual([]);
    expect(byTest('no-match')!.textContent).toContain('No guides have all these tags');
    await userEvent.click(byTest('clear-tags')!);
    expect(titles()).toHaveLength(3);
  });

  it('marks finished guides and offers Restart; Start from step N', async () => {
    mount();
    await tick();
    expect(byTest('completed-A')!.textContent).toContain('Completed');
    expect(byTest('completed-B')).toBeNull();
    expect(byTest('start-A')!.textContent).toContain('Restart');
    expect(byTest('start-B')!.textContent).toContain('Start');
    await userEvent.click(byTest('more-B')!);
    expect(byTest('more-B')!.getAttribute('aria-expanded')).toBe('true');
    expect(byTest('more-B')!.getAttribute('aria-controls')).toBe('more-B');
    await userEvent.selectOptions(byTest('start-from-B')! as HTMLSelectElement, '2');
    expect(byTest('start-step-B')!.textContent).toContain('Start from step 3');
    await userEvent.click(byTest('start-step-B')!);
    expect(starts).toEqual([['B', 2]]);
  });

  it('deletes with an Undo toast that takes focus, and Undo restores', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('more-C')!);
    await userEvent.click(byTest('delete-C')!);
    await tick();
    expect(titles()).not.toContain('Refund');
    const t = byTest('guide-undo-toast')!;
    expect(t.textContent).toContain('Deleted “Refund”.');
    expect(t.closest('[role="status"]')).not.toBeNull();
    expect(document.activeElement).toBe(byTest('toast-undo'));
    await userEvent.click(byTest('toast-undo')!);
    await tick();
    expect(sent.some((m) => m.type === 'guide.restore' && m.payload.id === 'C')).toBe(true);
    expect(byTest('guide-undo-toast')).toBeNull();
    expect(byTest('library-message')!.textContent).toContain('Restored');
  });

  it('a panel opened during the undo window shows the toast again', async () => {
    trash = [{ id: 'Z', title: 'Gone guide', deletedAt: Date.now(), undoUntil: Date.now() + 3000 }];
    mount();
    await tick(100);
    expect(byTest('guide-undo-toast')!.textContent).toContain('Gone guide');
    // It did not steal focus: nothing was clicked in this panel.
    expect(document.activeElement).not.toBe(byTest('toast-undo'));
  });

  it('Duplicate makes a copy of a local guide', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('more-A')!);
    await userEvent.click(byTest('duplicate-guide-A')!);
    await tick();
    expect(sent.some((m) => m.type === 'guide.duplicate' && m.payload.id === 'A')).toBe(true);
    expect(byTest('library-message')!.textContent).toContain('Made a copy');
  });
});

describe('editor (D100, D102)', () => {
  const mount = () => render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
  const stepTitles = () => [...root.querySelectorAll('h4.step-title')].map((e) => e.textContent?.replace(/^Step \d+: /, ''));

  it('deletes a step with Undo, which puts it back in place', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('step-1-delete')!);
    expect(stepTitles()).toEqual(['One', 'Three']);
    expect(byTest('step-undo-toast')!.textContent).toContain('Deleted step 2.');
    await tick();
    expect(document.activeElement).toBe(byTest('toast-undo'));
    await userEvent.click(byTest('toast-undo')!);
    expect(stepTitles()).toEqual(['One', 'Two', 'Three']);
  });

  it('the toast disappears when it expires and focus returns to the steps heading', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('step-0-delete')!);
    await tick();
    expect(document.activeElement).toBe(byTest('toast-undo'));
    dismissToast();
    await tick();
    expect(byTest('step-undo-toast')).toBeNull();
    expect(document.activeElement?.id).toBe('steps-heading');
  });

  it('duplicates a step and edits tags', async () => {
    mount();
    await tick();
    await userEvent.click(byTest('step-0-duplicate')!);
    expect(stepTitles()).toEqual(['One', 'One', 'Two', 'Three']);
    const tags = byTest('guide-tags') as HTMLInputElement;
    expect(tags.value).toBe('billing');
    await userEvent.fill(tags, 'billing, Onboarding, billing');
    await userEvent.click(byTest('save-guide')!);
    await tick();
    const save = sent.find((m) => m.type === 'guide.save')!;
    expect((save.payload.guide as Guide).tags).toEqual(['billing', 'Onboarding']);
    expect((save.payload.guide as Guide).steps).toHaveLength(4);
  });
});
