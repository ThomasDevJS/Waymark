/**
 * The shade controls (D144) in a real browser: Settings' section (copy, a failed read or save
 * never leaves it locked or wrong) and the editor's select (Default removes the field on save,
 * read-only for team guides). Review fixes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { ShadeSetting } from '../../src/entrypoints/options/Shade';
import { Editor } from '../../src/entrypoints/sidepanel/Editor';
import { dismissToast } from '../../src/entrypoints/sidepanel/Toast';
import type { Guide } from '../../src/core/model/schema';

let sent: { type: string; payload: Record<string, unknown> }[];
let fail: Set<string>;
let stored: Guide;
let root: HTMLElement;

const base = (extra: Partial<Guide> = {}): Guide => ({
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay a bill', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/start',
  matchUrls: [], version: 1, source: 'local', updatedAt: '',
  steps: [{ id: 'S0', kind: 'note', title: 'Hello', url: { kind: 'prefix', value: '/' }, advance: 'next' }],
  ...extra,
});

function answer(m: { type: string; payload: Record<string, unknown> }): unknown {
  if (m.type === 'player.settings.get') return { shade: 'darker' };
  if (m.type === 'player.settings.set') return { shade: (m.payload.patch as { shade: string }).shade };
  if (m.type === 'guide.get') return structuredClone(stored);
  if (m.type === 'guide.save') return { ...(m.payload.guide as Guide), revisionId: 'R2', version: 2 };
  return {};
}

beforeEach(() => {
  sent = [];
  fail = new Set();
  stored = base({ shade: 'darker' });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string; payload: Record<string, unknown> }) => {
        sent.push(m);
        return fail.has(m.type) ? { ok: false, error: 'nope' } : { ok: true, data: answer(m) };
      },
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    storage: {
      onChanged: { addListener() {}, removeListener() {} },
      session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      local: { get: async () => ({}), set: async () => undefined },
    },
    tabs: { sendMessage: async () => undefined },
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  root.querySelector<HTMLElement>('[data-testid="close-editor"]')?.click();
  dismissToast();
  render(null, root);
  root.remove();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const byTest = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('Settings → Highlight', () => {
  it('shows the stored choice; the hint says what picking a shade does, not that every choice applies to all', async () => {
    render(h(ShadeSetting, null), root);
    await tick();
    expect((byTest('shade-darker') as HTMLInputElement).checked).toBe(true);
    const fieldset = byTest('shade')!;
    expect(fieldset.querySelector('legend')!.textContent).toBe('Shade around the highlighted step');
    const hint = document.getElementById(fieldset.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toMatch(/^Pick a shade to use it for every guide and tutorial\./);
    expect(root.querySelector('.shade-preview')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('a failed read falls back to Follow each guide instead of locking every choice', async () => {
    fail.add('player.settings.get');
    render(h(ShadeSetting, null), root);
    await tick();
    expect((byTest('shade-guide') as HTMLInputElement).checked).toBe(true);
    expect((byTest('shade-lighter') as HTMLInputElement).disabled).toBe(false);
  });

  it('a failed save puts back the choice in use and says so', async () => {
    render(h(ShadeSetting, null), root);
    await tick();
    fail.add('player.settings.set');
    await userEvent.click(byTest('shade-lighter')!);
    await tick();
    expect((byTest('shade-darker') as HTMLInputElement).checked).toBe(true);
    expect((byTest('shade-lighter') as HTMLInputElement).checked).toBe(false);
    expect(byTest('shade-error')!.textContent).toBe('The shade could not be saved. Try again.');
  });
});

describe('the editor’s shade', () => {
  it('uses the same name as Settings; Default removes the guide’s shade when saved', async () => {
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    const select = byTest('guide-shade') as HTMLSelectElement;
    expect(select.value).toBe('darker');
    expect(select.closest('label')!.textContent).toContain('Shade around the highlighted step');
    await userEvent.selectOptions(select, '');
    await userEvent.click(byTest('save-guide')!);
    await tick();
    const save = sent.find((m) => m.type === 'guide.save');
    expect(save).toBeDefined();
    expect(save!.payload.guide).not.toHaveProperty('shade');
  });

  it('a team guide shows its shade read-only', async () => {
    stored = base({ shade: 'lighter', source: 'library' });
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    const select = byTest('guide-shade') as HTMLSelectElement;
    expect(select.value).toBe('lighter');
    expect(select.disabled).toBe(true);
  });
});
