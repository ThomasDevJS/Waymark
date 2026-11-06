/**
 * The player's side of Pick the right element (D210, review): the controller hides while a pick
 * is under way, brings the card back when it is cancelled, says why a start was refused, ends the
 * pick on an in-app route change, and the top frame ends it when the service worker stops accepting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIX_TTL_MS, NO_RUN, type RunView } from '../../src/core/player/run';
import type { ElementFingerprint } from '../../src/core/model/schema';
import { overlayRoot } from '../../src/content/overlay/host';

type Listener = (msg: unknown, sender: { id: string }, reply: (r: unknown) => void) => void;
let listeners: Listener[] = [];
let sent: { type: string; payload: unknown }[] = [];
let answer: (type: string) => unknown = () => ({ ok: true, data: { ok: true } });

const marker = (name: string) => document.documentElement.getAttribute(`data-waymark-test-${name}`);

const target: ElementFingerprint = {
  instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Missing button', text: 'Missing button',
  cssPath: 'button.missing', xpath: '/html/body/button[9]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 },
};

function view(over: Partial<RunView> = {}): RunView {
  return {
    ...NO_RUN,
    active: true,
    status: 'running',
    guideId: 'g1',
    guideTitle: 'Guide',
    appOrigins: [location.origin],
    stepIndex: 0,
    total: 2,
    step: { id: 's1', kind: 'click', title: 'Click **Missing button**', url: { kind: 'prefix', value: '/' }, target, advance: 'action' },
    stepToken: 't1',
    cause: 'start',
    runId: 'run1',
    rev: 1,
    phase: 'searching',
    fixable: true,
    ...over,
  };
}

function push(v: RunView) {
  for (const l of listeners) l({ type: 'run.changed', payload: v }, { id: 'ext' }, () => undefined);
}

const card = () => overlayRoot().querySelector<HTMLElement>('.tip');

beforeEach(() => {
  listeners = [];
  sent = [];
  answer = () => ({ ok: true, data: { ok: true } });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext',
      sendMessage: async (m: { type: string; payload: unknown }) => {
        sent.push(m);
        return answer(m.type);
      },
      onMessage: { addListener: (l: Listener) => listeners.push(l), removeListener: (l: Listener) => (listeners = listeners.filter((x) => x !== l)) },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function player() {
  const { startPlayerClient } = await import('../../src/content/player/controller');
  return startPlayerClient({ frameToken: 'f0', framePath: () => [], isTop: true });
}

describe('the player during Pick the right element (D210)', () => {
  it('hides while picking and shows the not-found card again when the pick is cancelled', async () => {
    const p = await player();
    try {
      // Not found: the card, with the fix button on the author's own guide.
      push(view({ rev: 1 }));
      await expect.poll(() => marker('player'), { timeout: 12_000 }).toBe('not-found:0');
      expect(card()?.querySelector('[data-action="fix"]')?.textContent).toContain('Pick the right element');
      push(view({ rev: 2, fixing: true }));
      expect(marker('player')).toBe('fixing:0');
      expect(card()).toBeNull();
      // Esc: the same step without `fixing`. The search runs again and the card comes back.
      push(view({ rev: 3, fixing: false }));
      await expect.poll(() => marker('player'), { timeout: 12_000 }).toBe('not-found:0');
      expect(card()).not.toBeNull();
    } finally {
      p.dispose();
    }
  }, 30_000);

  it('a library guide’s card has no fix button', async () => {
    const p = await player();
    try {
      push(view({ fixable: false }));
      await expect.poll(() => marker('player'), { timeout: 12_000 }).toBe('not-found:0');
      expect(card()?.querySelector('[data-action="report"]')).not.toBeNull();
      expect(card()?.querySelector('[data-action="fix"]')).toBeNull();
    } finally {
      p.dispose();
    }
  }, 30_000);

  it('says why a start was refused', async () => {
    answer = (t) => (t === 'run.fix.start' ? { ok: true, data: { ok: false, why: 'guide' } } : { ok: true, data: { ok: true } });
    const p = await player();
    try {
      push(view());
      await expect.poll(() => marker('player'), { timeout: 12_000 }).toBe('not-found:0');
      card()!.querySelector<HTMLButtonElement>('[data-action="fix"]')!.click();
      await expect.poll(() => card()?.querySelector('.flash')?.textContent ?? '').toContain('Only your own guides');
      expect(sent.find((m) => m.type === 'run.fix.start')?.payload).toEqual({ stepId: 's1' });
    } finally {
      p.dispose();
    }
  }, 30_000);

  it('an in-app route change during the pick ends it (pick.abort)', async () => {
    const p = await player();
    try {
      push(view({ fixing: true }));
      expect(marker('player')).toBe('fixing:0');
      p.onRoute(`${location.origin}/elsewhere`);
      expect(sent.some((m) => m.type === 'pick.abort')).toBe(true);
    } finally {
      p.dispose();
    }
  });

  it('the top frame ends a pick the service worker no longer accepts', async () => {
    vi.useFakeTimers();
    const p = await player();
    try {
      push(view({ fixing: true }));
      await vi.advanceTimersByTimeAsync(FIX_TTL_MS - 1000);
      expect(sent.some((m) => m.type === 'pick.abort')).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent.some((m) => m.type === 'pick.abort')).toBe(true);
    } finally {
      p.dispose();
    }
  });
});
