/**
 * D153: while recording, an outline shows what a click would record: the control, the card of D82
 * a plain-content click is promoted to, a "hard to find" target, or nothing that would be recorded.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { buildFingerprint } from '../../src/core/fingerprint';
import { previewClick } from '../../src/core/recorder/preview';
import { createRecHover, REC_HOVER_LABEL, REST_MS } from '../../src/content/rec-hover';
import { destroyOverlay, overlayHost, overlayLayer } from '../../src/content/overlay/host';

const fpOf = (el: Element) => buildFingerprint(el, { framePath: [] });
const pathOf = (el: Element): EventTarget[] => {
  const p: EventTarget[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) p.push(n);
  return [...p, document, window];
};
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
/** The pointer rests on a new element, then the outline is drawn. */
const rested = async () => {
  await frame();
  await new Promise((r) => setTimeout(r, REST_MS + 20));
  await frame();
};

let root: HTMLElement;
beforeEach(() => {
  const el = (tag: string, attrs: Record<string, string>, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  root = el(
    'div',
    {},
    el('button', { id: 'save' }, 'Save invoice'),
    el('div', { id: 'card-overdue', style: 'cursor:pointer;width:200px;padding:8px' }, el('span', { class: 't' }, 'Overdue'), ' ', el('b', {}, '12')),
    el('p', { class: 'plain' }, 'Total this month'),
    el('div', { class: 'empty', style: 'width:40px;height:20px' }),
    // A control whose label sits deeper than the six levels the target search looks up.
    el('a', { href: '#deep', id: 'deep-link' }, el('div', {}, el('div', {}, el('div', {}, el('div', {}, el('div', {}, el('div', {}, el('span', { class: 'deep' }, 'Deep label')))))))),
    el('x-widget', { id: 'chart-widget', style: 'display:block;width:60px;height:20px' }),
  );
  document.body.append(root);
});
afterEach(() => {
  root.remove();
  destroyOverlay();
});

describe('previewClick (D153)', () => {
  it('a control is recorded as is', () => {
    const b = root.querySelector('#save')!;
    expect(previewClick(pathOf(b), fpOf)).toEqual({ element: b, tone: 'ok' });
  });
  it('plain content in a clickable card shows the card (D82), as the recorder records it', () => {
    const card = root.querySelector('#card-overdue')!;
    expect(previewClick(pathOf(root.querySelector('#card-overdue .t')!), fpOf)).toEqual({ element: card, tone: 'ok' });
  });
  it('no outline where the recorder ignores the click: the page itself, content deep inside a control', () => {
    expect(previewClick([document.body, document.documentElement, document, window], fpOf)).toBeNull();
    expect(previewClick(pathOf(root.querySelector('.deep')!), fpOf)).toBeNull();
  });
  it('a closed component is hard to find, as the side panel flags it after recording', () => {
    const w = root.querySelector('#chart-widget')!;
    expect(previewClick(pathOf(w), fpOf)).toEqual({ element: w, tone: 'warn' });
  });
  it('agrees with what the recorder records for the same clicks', async () => {
    const ops: RecorderOp[] = [];
    const rec = createRecorder({ emit: (op) => ops.push(op) });
    const cases: [string, 'ok' | 'warn' | 'skip' | null][] = [
      ['#save', 'ok'],
      ['#card-overdue .t', 'ok'],
      ['.plain', 'warn'],
      ['.empty', 'skip'],
      ['.deep', null],
      ['#chart-widget', 'warn'],
    ];
    try {
      for (const [sel, tone] of cases) {
        const target = root.querySelector<HTMLElement>(sel)!;
        expect(previewClick(pathOf(target), fpOf)?.tone ?? null, sel).toBe(tone);
        const before = ops.filter((o) => o.op === 'add').length;
        await userEvent.click(target);
        await new Promise((r) => setTimeout(r, 30));
        const added = ops.filter((o) => o.op === 'add').slice(before);
        // ok and warn record one step (warn with a flag); skip and null record nothing.
        expect(added.length, sel).toBe(tone === 'ok' || tone === 'warn' ? 1 : 0);
        if (added[0]?.op === 'add') expect((added[0].step.flags ?? []).length > 0, sel).toBe(tone === 'warn');
      }
    } finally {
      rec.stop();
    }
  });
  it('plain text is recorded but hard to find; something with nothing to find it by is not recorded', () => {
    const p = root.querySelector('.plain')!;
    expect(previewClick(pathOf(p), fpOf)).toEqual({ element: p, tone: 'warn' });
    const empty = root.querySelector('.empty')!;
    expect(previewClick(pathOf(empty), fpOf)).toEqual({ element: empty, tone: 'skip' });
  });
});

describe('the outline while recording (D153)', () => {
  const box = () => overlayHost()!.shadowRoot!.querySelector<HTMLElement>('.rec-box');

  it('follows the pointer onto what a click would record, labelled when it is not a good pick', async () => {
    const hover = createRecHover(() => []);
    hover.start();
    const card = root.querySelector('#card-overdue')!;
    root.querySelector('#card-overdue .t')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await rested();
    const r = card.getBoundingClientRect();
    const b = box()!.getBoundingClientRect();
    expect(box()!.dataset.tone).toBe('ok');
    expect([b.left, b.top, b.width, b.height]).toEqual([r.left, r.top, r.width, r.height]);
    expect(getComputedStyle(box()!).pointerEvents).toBe('none');

    root.querySelector('.plain')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await rested();
    expect(box()!.dataset.tone).toBe('warn');
    expect(box()!.textContent).toBe(REC_HOVER_LABEL.warn);
    hover.stop();
    expect(box()).toBeNull();
  });

  it('never outlines Waymark’s own UI', async () => {
    const hover = createRecHover(() => []);
    hover.start();
    root.querySelector('#save')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await rested();
    expect(box()!.style.display).toBe('block');
    const ours = document.createElement('button');
    ours.textContent = 'Stop';
    overlayLayer().append(ours);
    ours.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await frame();
    expect(box()!.style.display).toBe('none');
    hover.stop();
  });

  it('waits for the pointer to rest before deciding; a press hides it until it is decided again', async () => {
    const hover = createRecHover(() => []);
    hover.start();
    const save = root.querySelector('#save')!;
    save.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await frame();
    expect(box()!.style.display).toBe('none'); // still moving: nothing decided yet
    await rested();
    expect(box()!.style.display).toBe('block');
    save.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(box()!.style.display).toBe('none');
    await rested();
    expect(box()!.style.display).toBe('block');
    hover.stop();
  });

  it('comes back when the page rebuilt Waymark’s overlay', async () => {
    const hover = createRecHover(() => []);
    hover.start();
    destroyOverlay(); // the page dropped the host
    root.querySelector('#save')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await rested();
    expect(box()?.style.display).toBe('block');
    hover.stop();
  });
});
