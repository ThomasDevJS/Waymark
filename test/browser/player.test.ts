/** Advance rules per step kind and overlay drawing, with trusted events and real layout. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { watchAdvance } from '../../src/core/player/advance';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';
import { PlayerUI, modalDialogOf } from '../../src/content/player/ui';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import { overlayHost, destroyOverlay } from '../../src/content/overlay/host';
import { matchOnce } from '../../src/core/matcher';
import { render } from './harness';

let keys: Map<string, Element[]>;
let advanced = 0;
let stop: (() => void) | null = null;
const q = (k: string) => keys.get(k)![0] as HTMLElement;

function stepFor(kind: Step['kind'], el: Element): Step {
  return { id: 's', kind, title: 't', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(el) };
}
function watch(kind: Step['kind'], els: Element[]) {
  stop = watchAdvance({ step: stepFor(kind, els[0]!), targets: els, onAdvance: () => advanced++ });
}

beforeEach(() => {
  keys = render({ seed: 1, layoutSeed: 1, portalOpen: true });
  advanced = 0;
});
afterEach(() => {
  stop?.();
  stop = null;
  destroyOverlay();
});

describe('advance rules', () => {
  it('click: a trusted click on the target; not elsewhere; not a script click', async () => {
    watch('click', [q('tb-import')]);
    q('tb-import').click(); // untrusted
    await userEvent.click(q('tb-export'));
    expect(advanced).toBe(0);
    await userEvent.click(q('tb-import'));
    expect(advanced).toBe(1);
  });

  it("click on any tied candidate for instance 'any'", async () => {
    const rows = keys.get('row-edit')!;
    watch('click', rows);
    await userEvent.click(rows[3]!);
    expect(advanced).toBe(1);
  });

  it('input: blur with a non-empty value, or change; not blur when empty', async () => {
    watch('input', [q('pf-first')]);
    await userEvent.click(q('pf-first'));
    await userEvent.click(q('pf-last')); // blur, empty
    expect(advanced).toBe(0);
    await userEvent.type(q('pf-first'), 'x');
    await userEvent.click(q('pf-last'));
    expect(advanced).toBe(1);
  });

  it('select: change on a native select; click on a custom option', async () => {
    watch('select', [q('pf-country')]);
    q('pf-country').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(advanced).toBe(1);
    stop?.();
    watch('select', [q('dd-closed')]);
    await userEvent.click(q('dd-closed'));
    expect(advanced).toBe(2);
  });

  it('check: change on a native checkbox (via its label); click on an ARIA switch', async () => {
    watch('check', [q('pf-newsletter')]);
    await userEvent.click(q('pf-newsletter').closest('label')!);
    expect(advanced).toBe(1);
    stop?.();
    watch('check', [q('sw-dark')]);
    await userEvent.click(q('sw-dark'));
    expect(advanced).toBe(2);
  });

  it("submit: the form's submit event", async () => {
    const form = q('pf-save').closest('form')!;
    form.addEventListener('submit', (e) => e.preventDefault());
    watch('submit', [q('pf-save')]);
    await userEvent.click(q('pf-save'));
    expect(advanced).toBe(1);
  });

  it('ignores events inside the overlay', async () => {
    const host = document.createElement('div');
    const b = document.createElement('button');
    b.textContent = 'inside';
    host.append(b);
    document.body.append(host);
    stop = watchAdvance({ step: stepFor('click', b), targets: [b], isOwnEvent: (p) => p.includes(host), onAdvance: () => advanced++ });
    await userEvent.click(b);
    expect(advanced).toBe(0);
    host.remove();
  });
});

describe('overlay drawing', () => {
  const handlers = { next() {}, back() {}, skip() {}, exit() {}, retry() {}, report() {}, goBack() {} };
  const view = (step: Step, extra: Partial<RunView> = {}): RunView => ({ ...NO_RUN, active: true, status: 'running', guideTitle: 'Demo', stepIndex: 1, total: 4, step, stepToken: 't', ...extra });

  it('draws four panels and a ring around the target, and a tooltip next to it in the top layer', async () => {
    const target = q('tb-new');
    const ui = new PlayerUI(handlers);
    ui.showStep(view({ ...stepFor('click', target), title: 'Click **New order**' }), target);
    await new Promise((r) => setTimeout(r, 50));
    const root = overlayHost()!.shadowRoot!;
    expect(overlayHost()!.matches(':popover-open')).toBe(true);
    const ring = root.querySelector('.ring')!.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    expect(Math.round(ring.left)).toBe(Math.round(Math.max(0, box.left - 6)));
    expect(Math.round(ring.right)).toBe(Math.round(box.right + 6));
    expect(Math.round(ring.top)).toBe(Math.round(Math.max(0, box.top - 6)));
    expect(root.querySelectorAll('.panel')).toHaveLength(4);
    const tip = root.querySelector('.tip') as HTMLElement;
    expect(tip.getAttribute('role')).toBe('dialog');
    expect(tip.textContent).toContain('Step 2 of 4');
    expect(tip.querySelector('strong')?.textContent).toBe('New order');
    const t = tip.getBoundingClientRect();
    expect(t.top).toBeGreaterThanOrEqual(box.bottom); // placed below the target
    // the target stays clickable through the gap: the panels do not take pointer events
    expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(target);
    ui.clear();
  });

  it('flips the tooltip above a target at the bottom of the viewport', async () => {
    const target = document.createElement('button');
    target.textContent = 'Bottom';
    Object.assign(target.style, { position: 'fixed', bottom: '4px', left: '200px' });
    document.body.append(target);
    const ui = new PlayerUI(handlers);
    ui.showStep(view(stepFor('click', target)), target);
    await new Promise((r) => setTimeout(r, 50));
    const tip = overlayHost()!.shadowRoot!.querySelector('.tip')!.getBoundingClientRect();
    expect(tip.bottom).toBeLessThanOrEqual(target.getBoundingClientRect().top);
    ui.clear();
    target.remove();
  });

  it('mounts inside an open modal dialog so the tooltip is not inert', async () => {
    const dialog = document.createElement('dialog');
    const b = document.createElement('button');
    b.textContent = 'Confirm';
    dialog.append(b);
    document.body.append(dialog);
    dialog.showModal();
    expect(modalDialogOf(b)).toBe(dialog);
    let exited = 0;
    const ui = new PlayerUI({ ...handlers, exit: () => exited++ });
    ui.showStep(view(stepFor('click', b)), b);
    expect(overlayHost()!.parentElement).toBe(dialog);
    const exit = overlayHost()!.shadowRoot!.querySelector('[data-action="exit"]') as HTMLElement;
    await userEvent.click(exit);
    expect(exited).toBe(1);
    ui.clear();
    dialog.close();
    dialog.remove();
  });

  it('never steals focus from the field the learner is typing in', async () => {
    const field = q('pf-first') as HTMLInputElement;
    await userEvent.click(field);
    let next = 0;
    const ui = new PlayerUI({ ...handlers, next: () => next++ });
    ui.showStep(view({ ...stepFor('input', field), kind: 'input' }), field);
    await new Promise((r) => setTimeout(r, 30));
    await userEvent.click(overlayHost()!.shadowRoot!.querySelector('[data-action="next"]') as HTMLElement);
    expect(next).toBe(1);
    expect(document.activeElement).toBe(field);
    ui.clear();
  });

  it('reports a lost target so the matcher can run again', async () => {
    const target = q('tb-import');
    let lost = 0;
    const ui = new PlayerUI(handlers);
    ui.showStep(view(stepFor('click', target)), target, () => lost++);
    target.remove();
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 50));
    expect(lost).toBeGreaterThan(0);
    ui.clear();
  });

  it('the matcher finds the tied row buttons that the advance rule accepts', () => {
    const rows = keys.get('row-edit')!;
    const fp = buildFingerprint(rows[0]!);
    const r = matchOnce(document, fp);
    expect(r.status === 'found' && r.tied.length).toBe(5);
  });
});

describe('review regressions (M3)', () => {
  function shadowForm() {
    const host = document.createElement('fx-shadow-player');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const form = document.createElement('form');
    form.addEventListener('submit', (e) => e.preventDefault());
    const select = document.createElement('select');
    for (const t of ['Small', 'Large']) select.append(Object.assign(document.createElement('option'), { textContent: t }));
    const box = document.createElement('input');
    box.type = 'checkbox';
    const send = document.createElement('button');
    send.textContent = 'Send';
    form.append(select, box, send);
    root.append(form);
    return { host, select, box, send };
  }

  it('select, check and submit steps inside an open shadow root advance', async () => {
    const { host, select, box, send } = shadowForm();
    watch('select', [select]);
    select.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(advanced).toBe(1);
    stop?.();
    watch('check', [box]);
    await userEvent.click(box);
    expect(advanced).toBe(2);
    stop?.();
    watch('submit', [send]);
    await userEvent.click(send);
    expect(advanced).toBe(3);
    host.remove();
  });

  it('a submit step does not advance on an in-app route change after its click', async () => {
    const b = document.createElement('button');
    b.type = 'button'; // the app validates and does not submit
    b.textContent = 'Pay';
    b.addEventListener('click', () => history.replaceState(history.state, '', location.href.split('#')[0] + '#paid'));
    document.body.append(b);
    watch('submit', [b]);
    await userEvent.click(b);
    await new Promise((r) => setTimeout(r, 50));
    expect(advanced).toBe(0);
    b.remove();
    history.replaceState(history.state, '', location.href.split('#')[0]);
  });

  it('cards and note tooltips mount inside an open modal dialog, where they stay clickable', async () => {
    const dialog = document.createElement('dialog');
    dialog.append(Object.assign(document.createElement('p'), { textContent: 'Modal' }));
    document.body.append(dialog);
    dialog.showModal();
    let skipped = 0;
    const ui = new PlayerUI({ ...{ next() {}, back() {}, exit() {}, retry() {}, report() {}, goBack() {} }, skip: () => skipped++ });
    const step: Step = { id: 's', kind: 'click', title: 'Click **X**', url: { kind: 'pattern', value: '/' }, advance: 'action' };
    ui.showCard('not-found', { ...NO_RUN, active: true, status: 'running', step, stepIndex: 0, total: 2 });
    expect(overlayHost()!.parentElement).toBe(dialog);
    await userEvent.click(overlayHost()!.shadowRoot!.querySelector('[data-action="skip"]') as HTMLElement);
    expect(skipped).toBe(1);
    ui.clear();
    dialog.close();
    dialog.remove();
  });
});
