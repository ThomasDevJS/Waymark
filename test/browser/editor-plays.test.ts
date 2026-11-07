/**
 * The editor's "may break" flags (D211) in a real browser: shown folded and open, hidden at once
 * by an unsaved Re-pick, updated while the editor is open when a play writes results, and the
 * warning's Re-pick button shows the pick under way (review of D211).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { Editor } from '../../src/entrypoints/sidepanel/Editor';
import { dismissToast } from '../../src/entrypoints/sidepanel/Toast';
import { targetHash } from '../../src/core/shots/lifecycle';
import type { ElementFingerprint, Guide } from '../../src/core/model/schema';
import type { Reason } from '../../src/core/stats/plays';

const fp: ElementFingerprint = {
  instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', text: 'Save', cssPath: 'form > button', xpath: '/html[1]/body[1]/form[1]/button[1]',
  ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 },
};
const guide: Guide = {
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/', matchUrls: [], version: 1, source: 'local', updatedAt: '',
  steps: [
    { id: 'S0', kind: 'click', title: 'Click **Save**', url: { kind: 'prefix', value: '/' }, advance: 'action', target: fp },
    { id: 'S1', kind: 'click', title: 'Click **Send**', url: { kind: 'prefix', value: '/' }, advance: 'action', target: { ...fp, text: 'Send', accessibleName: 'Send' } },
  ],
};

let plays: Record<string, { t: string; reasons: Reason[] }>;
let listeners: ((changes: Record<string, unknown>, area: string) => void)[];
let root: HTMLElement;
let statsAsked = 0;

beforeEach(() => {
  plays = { S0: { t: targetHash(fp), reasons: [{ kind: 'one-signal' }] } };
  listeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string }) => (m.type === 'stats.guide' && statsAsked++, {
        ok: true,
        data: m.type === 'guide.get' ? structuredClone(guide) : m.type === 'stats.guide' ? { steps: structuredClone(plays) } : m.type === 'pick.start' ? { ok: true } : {},
      }),
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    storage: {
      onChanged: { addListener: (f: (typeof listeners)[number]) => listeners.push(f), removeListener: (f: (typeof listeners)[number]) => (listeners = listeners.filter((x) => x !== f)) },
      session: { get: async () => ({}), remove: async () => undefined },
      local: { get: async () => ({}), set: async () => undefined },
    },
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  dismissToast();
  render(null, root);
  root.remove();
});

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const byTest = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const fire = (changes: Record<string, unknown>, area: string) => listeners.forEach((l) => l(changes, area));

describe('editor flags from plays (D211)', () => {
  it('shows the reason folded and open; Re-pick from the flag shows the pick, and the picked element hides the flag', async () => {
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    expect(byTest('step-0-may-break')!.title).toBe('Found by one signal only');
    expect(byTest('step-1-may-break')).toBeNull();
    await userEvent.click(byTest('step-0-toggle')!);
    expect(byTest('step-0-plays')!.textContent).toContain('Found by one signal only');
    const btn = byTest('step-0-plays-repick')!;
    await userEvent.click(btn);
    await tick();
    expect(byTest('step-0-plays-repick')!.getAttribute('aria-pressed')).toBe('true');
    expect(byTest('step-0-plays-repick')!.textContent).toContain('Cancel picking');
    // The picked element arrives: the flag was about the old one.
    fire({ 'pickResult:1': { newValue: { target: { ...fp, text: 'Save now' }, title: 'Click **Save now**', at: 1 } } }, 'session');
    await tick();
    expect(byTest('step-0-plays')).toBeNull();
  });

  it('a play while the editor is open updates the flags without reopening it', async () => {
    plays = {};
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick();
    expect(byTest('step-1-may-break')).toBeNull();
    plays = { S1: { t: targetHash(guide.steps[1]!.target), reasons: [{ kind: 'not-found', misses: 2, of: 3 }] } };
    const asked = statsAsked;
    fire({ 'stats:G1': { newValue: {} } }, 'local');
    await tick();
    expect(statsAsked).toBe(asked + 1);
    expect(byTest('step-1-may-break')!.title).toBe('Not found in 2 of the last 3 plays');
  });
});
