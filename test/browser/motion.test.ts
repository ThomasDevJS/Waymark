/**
 * Panel motion (D130) in a real browser: list items glide when they move (FLIP) and keep focus;
 * folds and toasts animate only transform and opacity; the toast's exit copy is inert and hidden
 * from screen readers; reduced motion removes every movement.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { cdp, userEvent } from 'vitest/browser';
import { Editor } from '../../src/entrypoints/sidepanel/Editor';
import { Library } from '../../src/entrypoints/sidepanel/Library';
import { dismissToast, showToast, ToastSlot } from '../../src/entrypoints/sidepanel/Toast';
import { flipList, measure, reducedMotion } from '../../src/ui/motion';
import type { ElementFingerprint, Guide, Step } from '../../src/core/model/schema';
import '../../src/ui/components.css';
import '../../src/entrypoints/sidepanel/style.css';

const fp: ElementFingerprint = {
  instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', cssPath: 'form > button', xpath: '/html[1]/body[1]/form[1]/button[1]',
  ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 10, h: 10, vw: 100, vh: 100 },
};
const steps: Step[] = ['One', 'Two', 'Three'].map((t, i) => ({ id: `S${i}`, kind: 'click', title: `Click ${t}`, url: { kind: 'prefix', value: '/' }, advance: 'action', target: fp }));
const guide: Guide = {
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay a bill', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/start',
  matchUrls: [], version: 1, source: 'local', updatedAt: '', steps,
};

let root: HTMLElement;
let completions: Record<string, string> = {};
let onChanged: ((changes: Record<string, unknown>, area: string) => void) | null = null;
const entry = (id: string, title: string, stepTitles: string) => ({
  id, revisionId: `R${id}`, title, tags: [], startUrl: 'https://app.test/start', updatedAt: '', appOrigins: ['https://app.test'], matchUrls: [], source: 'local', steps: 2, stepTitles,
});
const GUIDES = [entry('A', 'Pay a bill', 'Open billing\nPay'), entry('B', 'Add a user', 'Open users\nInvite billing admin'), entry('C', 'Billing settings', 'Open billing'), entry('D', 'Export data', 'Export')];
function answer(type: string): unknown {
  switch (type) {
    case 'guide.get':
      return structuredClone(guide);
    case 'guide.list':
      return { guides: GUIDES };
    case 'allow.pending':
      return { origins: [] };
    case 'completions.list':
      return { completed: completions };
    case 'trash.list':
      return { items: [] };
    default:
      return {};
  }
}

async function setReduced(on: boolean): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
  // The page hears the change (the media query's change event) at its next rendering step.
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
}

beforeEach(async () => {
  await setReduced(false);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string }) => ({ ok: true, data: answer(m.type) }),
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    storage: { onChanged: { addListener: (f: typeof onChanged) => (onChanged = f), removeListener() {} }, session: { get: async () => ({}), remove: async () => undefined }, local: { get: async () => ({}), set: async () => undefined } },
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(async () => {
  root.querySelector<HTMLElement>('[data-testid="close-editor"]')?.click();
  dismissToast();
  render(null, root);
  root.remove();
  await setReduced(false);
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const byTest = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
/** The properties a running animation changes. */
const animatedProps = (el: Element) =>
  el.getAnimations().flatMap((a) => ((a.effect as KeyframeEffect | null)?.getKeyframes() ?? []).flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))));

describe('tokens (D130)', () => {
  it('reduced motion zeroes distances and scales, and the JS check follows it', async () => {
    const css = () => getComputedStyle(document.documentElement);
    expect(css().getPropertyValue('--wm-move-md').trim()).toBe('4px');
    expect(css().getPropertyValue('--wm-press').trim()).toBe('0.97');
    expect(reducedMotion()).toBe(false);
    await setReduced(true);
    expect(css().getPropertyValue('--wm-move-md').trim()).toBe('0px');
    expect(css().getPropertyValue('--wm-press').trim()).toBe('1');
    expect(reducedMotion()).toBe(true);
  });
});

describe('reducedMotion() (D133)', () => {
  it('asks matchMedia once per window, not on every call (calls between DOM changes forced style and layout)', () => {
    reducedMotion();
    const real = window.matchMedia;
    let calls = 0;
    window.matchMedia = (q: string) => (calls++, real.call(window, q));
    try {
      for (let i = 0; i < 10; i++) reducedMotion();
    } finally {
      window.matchMedia = real;
    }
    expect(calls).toBe(0);
  });
});

describe('FLIP lists (D130)', () => {
  function list(keys: string[]): HTMLElement {
    const ul = document.createElement('ul');
    for (const k of keys) {
      const li = document.createElement('li');
      li.dataset.flip = k;
      li.textContent = k;
      li.style.height = '30px';
      ul.append(li);
    }
    root.append(ul);
    return ul;
  }

  it('moved items glide with a transform from where they were; nothing else animates', () => {
    const ul = list(['a', 'b', 'c']);
    const before = measure(ul, 'data-flip');
    ul.prepend(ul.lastElementChild!); // c, a, b
    flipList(ul, 'data-flip', before);
    for (const li of Array.from(ul.children)) expect(animatedProps(li).every((p) => p === 'transform')).toBe(true);
    expect(ul.children[0]!.getAnimations()).toHaveLength(1);
    const first = (ul.children[0]!.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes()[0]!.transform;
    expect(first).toBe('translate(0px, 60px)'); // c started two rows lower
  });

  it('scrolling between two measures moves nothing', () => {
    const ul = list(['a', 'b']);
    const before = measure(ul, 'data-flip');
    document.body.style.paddingTop = '200px'; // the whole list moves, nothing inside it
    flipList(ul, 'data-flip', before);
    document.body.style.paddingTop = '';
    for (const li of Array.from(ul.children)) expect(li.getAnimations()).toHaveLength(0);
  });

  it('reduced motion: no glide at all', async () => {
    await setReduced(true);
    const ul = list(['a', 'b', 'c']);
    const before = measure(ul, 'data-flip');
    ul.prepend(ul.lastElementChild!);
    flipList(ul, 'data-flip', before);
    for (const li of Array.from(ul.children)) expect(li.getAnimations()).toHaveLength(0);
  });
});

describe('editor (D130)', () => {
  it('Move down glides the steps, and the pressed button keeps focus (it fell to <body> before)', async () => {
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick(100);
    const down = byTest('step-0-down')!;
    down.focus();
    await userEvent.keyboard('{Enter}');
    await new Promise(requestAnimationFrame); // the glide starts in the next frame, before its paint
    // Step "One" is now second; the moved rows are gliding.
    const moved = root.querySelector('[aria-labelledby="step-title-S0"]')!;
    expect(moved.getAttribute('data-testid')).toBe('step-1');
    expect(moved.getAnimations().length).toBeGreaterThan(0);
    // Only the glide: the row is re-inserted, which must not replay its entrance (a fade).
    expect([...new Set(animatedProps(moved))]).toEqual(['transform']);
    // Only the two rows that swapped move; step 3 stayed where it was.
    expect(root.querySelector('[aria-labelledby="step-title-S2"]')!.getAnimations()).toHaveLength(0);
    expect(document.activeElement).toBe(moved.querySelector('[data-testid="step-1-down"]'));
    await tick(300);
    expect(document.activeElement).toBe(moved.querySelector('[data-testid="step-1-down"]'));
    expect(moved.getAnimations()).toHaveLength(0); // nothing left running
    // At the bottom, Move down is disabled: Move up takes focus.
    await userEvent.keyboard('{Enter}');
    await tick(0);
    expect(document.activeElement).toBe(moved.querySelector('[data-testid="step-2-up"]'));
  });

  it('an opened step unfolds with opacity and transform only; the chevron turns', async () => {
    render(h(Editor, { guideId: 'G1', tabId: 1, onClose: () => undefined }), root);
    await tick(100);
    const toggle = byTest('step-2-toggle')!;
    if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.click(toggle);
    const body = root.querySelector('[data-testid="step-2"] .step-body')!;
    expect(body.getAnimations().map((a) => (a as CSSAnimation).animationName)).toContain('wm-unfold');
    const chev = toggle.querySelector('.chev')!;
    await tick(250);
    expect(getComputedStyle(chev).transform).toMatch(/^matrix\(-1, /); // rotated 180°
  });
});

describe('toast (D130, D100)', () => {
  const spec = () => ({ scope: 'library' as const, text: 'Deleted “A”.', action: { label: 'Undo', run: () => undefined }, until: Date.now() + 8000, testid: 'guide-undo-toast' });

  it('enters with a slide; leaves through an inert copy that screen readers never see', async () => {
    const fallback = document.createElement('button');
    document.body.append(fallback);
    render(h(ToastSlot, { scope: 'library' }), root);
    showToast({ ...spec(), focus: true, fallbackFocus: () => fallback });
    await tick();
    const live = root.querySelector('.toast-slot')!;
    const t = live.querySelector('.toast')!;
    expect(t.getAnimations().map((a) => (a as CSSAnimation).animationName)).toContain('wm-toast-in');
    expect(document.activeElement).toBe(byTest('toast-undo'));
    dismissToast();
    await tick(0);
    const ghost = live.querySelector('.toast.leaving') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector('[data-testid], button')).toBeNull();
    expect(byTest('guide-undo-toast')).toBeNull();
    // Focus went where it always did (D100), not into the leaving copy.
    expect(document.activeElement).toBe(fallback);
    await tick(250);
    expect(live.querySelector('.toast')).toBeNull();
    fallback.remove();
  });

  it('reduced motion: no exit copy', async () => {
    await setReduced(true);
    render(h(ToastSlot, { scope: 'library' }), root);
    showToast(spec());
    await tick();
    dismissToast();
    await tick(0);
    expect(root.querySelector('.toast')).toBeNull();
  });
});

describe('reduced motion everywhere (D130, review)', () => {
  it('ticks, toasts, chevrons, switches and fills do not move', async () => {
    await setReduced(true);
    render(
      h('div', null,
        h('p', null, h('svg', { class: 'tick', width: 16, height: 16 })),
        h('div', { class: 'toast' }, 'x'),
        h('button', { 'aria-expanded': 'false' }, h('svg', { class: 'chev', width: 16, height: 16 })),
        h('input', { type: 'checkbox', role: 'switch', class: 'switch' }),
        h('div', { class: 'meter', style: 'width:100px' }, h('span', { class: 'fill', style: 'transform:scaleX(.2)' })),
      ),
      root,
    );
    for (const sel of ['.tick', '.toast']) {
      const el = root.querySelector(sel)!;
      const [a] = el.getAnimations();
      expect(a, sel).toBeDefined();
      a!.pause();
      a!.currentTime = 0;
      expect(getComputedStyle(el).transform, sel).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
      expect(Number(getComputedStyle(el).opacity), sel).toBeLessThan(1); // still a fade
    }
    root.querySelector('button')!.setAttribute('aria-expanded', 'true');
    (root.querySelector('.switch') as HTMLInputElement).checked = true;
    (root.querySelector('.fill') as HTMLElement).style.transform = 'scaleX(.8)';
    for (const el of [root.querySelector('.chev')!, root.querySelector('.fill')!]) expect(el.getAnimations()).toHaveLength(0);
    expect(getComputedStyle(root.querySelector('.switch')!, '::after').transitionDuration).toBe('0s');
  });
});

describe('library (review)', () => {
  it('rows never glide while searching (results are sorted by score)', async () => {
    completions = {};
    render(h(Library, { tabId: 1, tabUrl: null, onEdit: () => undefined, onStart: () => undefined }), root);
    await tick(100);
    const order = () => Array.from(root.querySelectorAll('.guide-item')).map((li) => li.getAttribute('data-flip'));
    const start = order();
    await userEvent.type(byTest('search')!, 'billing');
    await tick(0);
    expect(order()).not.toEqual(start); // the scores reordered them
    for (const li of Array.from(root.querySelectorAll('.guide-item'))) expect([...new Set(animatedProps(li))]).not.toContain('transform');
  });

  it('the Completed check pops only for a guide finished while the panel is open', async () => {
    completions = { A: '2026-11-05T10:00:00Z' };
    render(h(Library, { tabId: 1, tabUrl: null, onEdit: () => undefined, onStart: () => undefined }), root);
    await tick(100);
    expect(byTest('completed-A')!.querySelector('svg')!.classList.contains('tick')).toBe(false);
    completions = { ...completions, B: '2026-11-05T11:00:00Z' };
    onChanged!({ completions: {} }, 'local');
    await tick(100);
    expect(byTest('completed-B')!.querySelector('svg')!.classList.contains('tick')).toBe(true);
    expect(byTest('completed-A')!.querySelector('svg')!.classList.contains('tick')).toBe(false);
  });
});

describe('FLIP with rapid moves (review)', () => {
  it('a second move during a glide starts from where the row is drawn, not from its in-flight offset', () => {
    const ul = document.createElement('ul');
    for (const k of ['a', 'b', 'c']) {
      const li = document.createElement('li');
      li.dataset.flip = k;
      li.style.height = '30px';
      ul.append(li);
    }
    root.append(ul);
    const before1 = measure(ul, 'data-flip');
    ul.append(ul.children[0]!); // b, c, a: a glides down 60 px
    flipList(ul, 'data-flip', before1, { only: new Set(['a', 'b', 'c']) });
    const a = ul.querySelector('[data-flip="a"]')!;
    a.getAnimations()[0]!.pause(); // frozen at the start: a is drawn at the top (0)
    const before2 = measure(ul, 'data-flip');
    expect(before2.get('a')!.y).toBe(0);
    ul.prepend(a); // back to a, b, c
    flipList(ul, 'data-flip', before2, { only: new Set(['a', 'b', 'c']) });
    // a is already drawn at 0 and lands at 0: nothing to glide (before the fix it jumped by the old offset).
    expect(a.getAnimations()).toHaveLength(0);
  });
});
