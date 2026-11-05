/**
 * Debug log (D110) in the recorder and the advance rules: the reasons logged for region
 * promotion (D82), merges and near-miss clicks, with real layout and trusted events. Logging
 * changes nothing the recorder emits, never throws into it, and never sees typed values.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import { watchAdvance } from '../../src/core/player/advance';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';
import { PlayerUI } from '../../src/content/player/ui';
import { NO_RUN } from '../../src/core/player/run';
import { destroyOverlay, overlayHost } from '../../src/content/overlay/host';
import { render } from './harness';

type Logged = { ev: string; d: Record<string, unknown> };
const settle = () => new Promise((r) => setTimeout(r, 30));
const strip = (ops: RecorderOp[]) => JSON.stringify(ops, (k, v) => (k === 'id' || k === 'stepId' || k === 'at' ? undefined : v));

let recs: Recorder[] = [];
let stops: (() => void)[] = [];
let added: Element[] = [];

beforeEach(() => {
  render({ seed: 1, layoutSeed: 1, portalOpen: true });
});
afterEach(() => {
  recs.forEach((r) => r.stop());
  stops.forEach((s) => s());
  added.forEach((e) => e.remove());
  recs = [];
  stops = [];
  added = [];
  destroyOverlay();
});

function recorder(debug?: (ev: string, data: () => Record<string, unknown>) => void) {
  const ops: RecorderOp[] = [];
  recs.push(createRecorder({ emit: (op) => ops.push(op), ...(debug ? { debug } : {}) }));
  return ops;
}

const card = (attrs: Record<string, string>, ...kids: (Node | string)[]) => {
  const d = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  d.style.cssText = 'cursor:pointer;width:140px;height:60px;display:inline-block';
  d.append(...kids);
  added.push(d);
  document.body.append(d);
  return d;
};
const text = (t: string) => Object.assign(document.createElement('div'), { textContent: t });

describe('recorder', () => {
  it('logs the resolved target and why a card was or was not promoted to a region (D82)', async () => {
    const log: Logged[] = [];
    recorder((ev, d) => log.push({ ev, d: d() }));
    // As in #32: the title and count have classes of their own (class-less alike siblings would
    // each be a repeated item, D82's documented limit).
    const promoted = Object.assign(text('Unsafe Driving'), { className: 'title' });
    card({ id: 'unsafe-toggle', class: 'card' }, promoted, Object.assign(text('3'), { className: 'count' }));
    const plain = text('No id here');
    card({ class: 'other' }, plain);
    const withButton = text('Has a button');
    card({ id: 'with-button', class: 'x' }, withButton, Object.assign(document.createElement('button'), { textContent: 'Go' }));
    for (const t of [promoted, plain, withButton]) await userEvent.click(t);
    await settle();
    const targets = log.filter((l) => l.ev === 'target').map((l) => l.d.region);
    expect(targets).toEqual(['promoted at the press (D82)', 'not promoted: the region has nothing but its text to find it by', 'not promoted: a control (button) inside the region']);
    const emits = log.filter((l) => l.ev === 'emit').map((l) => [l.d.title, l.d.flags, l.d.signals]);
    expect(emits[0]).toEqual(['Click Unsafe Driving', [], expect.arrayContaining(['id'])]);
    expect(emits[1]![1]).toEqual(['low-confidence']);
  });

  it('logs merges and skips, and records exactly the same steps as without a logger', async () => {
    const log: Logged[] = [];
    const withLog = recorder((ev, d) => log.push({ ev, d: d() }));
    const without = recorder();
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Send me the newsletter') as HTMLElement;
    await userEvent.click(label);
    const nameless = card({}, '');
    nameless.style.cssText = 'width:60px;height:20px;display:block';
    await userEvent.click(nameless);
    await settle();
    expect(strip(withLog)).toBe(strip(without));
    expect(withLog.length).toBeGreaterThan(0);
    expect(log.map((l) => l.ev)).toContain('merge');
    expect(log.find((l) => l.ev === 'skip')?.d).toMatchObject({ why: 'nothing to find it by again (D47)', strong: false });
  });

  it('a logger that throws never breaks recording', async () => {
    const ops = recorder(() => {
      throw new Error('logger broke');
    });
    await userEvent.click(document.querySelector('#first-name') as HTMLElement);
    await userEvent.keyboard('Ada');
    await userEvent.tab();
    await settle();
    expect(ops.map((o) => (o.op === 'add' ? o.step.title : ''))).toEqual(['Enter First name']);
  });

  it('never logs what is typed', async () => {
    const log: Logged[] = [];
    recorder((ev, d) => log.push({ ev, d: d() }));
    await userEvent.type(document.querySelector('#email') as HTMLElement, 'ada.secret@example.com');
    await userEvent.type(document.querySelector('#first-name') as HTMLElement, 'Lovelace');
    await settle();
    const json = JSON.stringify(log);
    expect(log.length).toBeGreaterThan(0);
    expect(json).not.toContain('ada.secret');
    expect(json).not.toContain('Lovelace');
  });
});

describe('advance rules', () => {
  function button(x: number, y: number) {
    const b = Object.assign(document.createElement('button'), { textContent: 'Save debug' });
    b.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:100px;height:30px;z-index:10`;
    document.body.append(b);
    added.push(b);
    return b;
  }
  const stepFor = (el: Element): Step => ({ id: 's', kind: 'click', title: 't', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(el) });

  it('logs the listeners, near-miss clicks with the reason, and the advance; far clicks are not logged', async () => {
    const log: Logged[] = [];
    const b = button(300, 300);
    const near = Object.assign(document.createElement('span'), { textContent: 'near' });
    near.style.cssText = 'position:fixed;left:300px;top:345px;width:60px;height:20px;z-index:10';
    const far = Object.assign(document.createElement('span'), { textContent: 'far' });
    far.style.cssText = 'position:fixed;left:900px;top:20px;width:60px;height:20px;z-index:10';
    document.body.append(near, far);
    added.push(near, far);
    let advanced = 0;
    stops.push(watchAdvance({ step: stepFor(b), targets: [b], onAdvance: () => advanced++, debug: (ev, d) => log.push({ ev, d: d() }) }));
    expect(log[0]).toMatchObject({ ev: 'advance.watch', d: { kind: 'click', targets: 1, tags: ['button'], listeners: ['pointerdown@document', 'click@document'] } });
    await userEvent.click(far);
    await userEvent.click(near);
    expect(advanced).toBe(0);
    const misses = log.filter((l) => l.ev === 'click.miss');
    expect(misses).toHaveLength(1);
    expect(misses[0]!.d).toMatchObject({ why: 'the click was not on the target, and the press was not on it either', tag: 'span', inside: false });
    expect(misses[0]!.d.distancePx).toBeGreaterThan(0);
    expect(misses[0]!.d.distancePx).toBeLessThanOrEqual(30);
    await userEvent.click(b);
    expect(advanced).toBe(1);
    expect(log.at(-1)).toEqual({ ev: 'advance', d: { kind: 'click', why: 'a click on the target' } });
  });

  it('a near-miss logs only real ARIA role names, never a page-written role string (review #4)', async () => {
    const log: Logged[] = [];
    const b = button(300, 300);
    const odd = Object.assign(document.createElement('span'), { textContent: 'odd' });
    odd.setAttribute('role', 'customer jane.doe secret note');
    odd.style.cssText = 'position:fixed;left:300px;top:345px;width:60px;height:20px;z-index:10';
    const tab = Object.assign(document.createElement('span'), { textContent: 'tab' });
    tab.setAttribute('role', 'tab');
    tab.style.cssText = 'position:fixed;left:420px;top:300px;width:40px;height:20px;z-index:10';
    document.body.append(odd, tab);
    added.push(odd, tab);
    stops.push(watchAdvance({ step: stepFor(b), targets: [b], onAdvance: () => undefined, debug: (ev, d) => log.push({ ev, d: d() }) }));
    await userEvent.click(odd);
    await userEvent.click(tab);
    const roles = log.filter((l) => l.ev === 'click.miss').map((l) => l.d.role);
    expect(roles).toEqual([null, 'tab']);
    expect(JSON.stringify(log)).not.toContain('jane.doe');
  });

  it('a logger that throws never stops the step from advancing', async () => {
    const b = button(300, 300);
    let advanced = 0;
    stops.push(
      watchAdvance({
        step: stepFor(b),
        targets: [b],
        onAdvance: () => advanced++,
        debug: () => {
          throw new Error('logger broke');
        },
      }),
    );
    await userEvent.click(b);
    expect(advanced).toBe(1);
  });
});

describe('not-found card', () => {
  const handlers = { next() {}, back() {}, skip() {}, exit() {}, retry() {}, report() {}, goBack() {}, mute() {} };
  const step: Step = { id: 's', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/' }, advance: 'action' };
  const view = { ...NO_RUN, active: true, status: 'running' as const, step, stepIndex: 0, total: 2 };

  it('offers Copy log only while the debug log is on', async () => {
    let on = false;
    let copies = 0;
    const ui = new PlayerUI({ ...handlers, debugOn: () => on, copyLog: () => copies++ });
    ui.showCard('not-found', view);
    expect(overlayHost()!.shadowRoot!.querySelector('[data-action="copy-log"]')).toBeNull();
    on = true;
    ui.showCard('not-found', view);
    const copy = overlayHost()!.shadowRoot!.querySelector('[data-action="copy-log"]') as HTMLElement;
    expect(copy.getAttribute('aria-label')).toBe('Copy debug log');
    await userEvent.click(copy);
    expect(copies).toBe(1);
    ui.flash('Couldn’t copy here.', 'warn');
    ui.flash('Debug log copied.');
    // One message at a time.
    expect(overlayHost()!.shadowRoot!.querySelectorAll('.flash')).toHaveLength(1);
    ui.clear();
  });
});
