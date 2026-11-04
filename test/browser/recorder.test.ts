/** Recorder merge rules and privacy guards, with trusted events from the browser provider. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import type { Step } from '../../src/core/model/schema';
import { render } from './harness';

let ops: RecorderOp[] = [];
let rec: Recorder | null = null;

/** Applies ops like the service worker does. */
function steps(): Step[] {
  const out: Step[] = [];
  for (const op of ops) {
    if (op.op === 'add') out.push(op.step);
    else if (out[out.length - 1]?.id === op.stepId) out[out.length - 1] = op.step;
  }
  return out;
}
const titles = () => steps().map((s) => `${s.kind}: ${s.title}`);
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  ops = [];
  const keys = render({ seed: 1, layoutSeed: 1, portalOpen: true });
  void keys;
  rec = createRecorder({ emit: (op) => ops.push(op) });
});
afterEach(() => rec?.stop());

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const byText = (tag: string, text: string) => [...document.querySelectorAll(tag)].find((e) => e.textContent?.trim() === text) as HTMLElement;

describe('merge rules', () => {
  it('clicking a field and typing into it is one input step, and the value is never stored', async () => {
    await userEvent.click(q('#first-name'));
    await userEvent.keyboard('Ada Lovelace');
    await userEvent.type(q('#email'), 'ada@example.com');
    await settle();
    expect(titles()).toEqual(['input: Enter First name', 'input: Enter Email']);
    const json = JSON.stringify(ops);
    expect(json).not.toContain('Ada');
    expect(json).not.toContain('Lovelace');
    expect(json).not.toContain('ada@example.com');
  });

  it('a checkbox click through its label is one check step; an ARIA switch is one check step', async () => {
    const sw = q('[aria-label="Dark mode"]');
    // the app toggles the switch in its own click handler, after the recorder's capture listener
    sw.addEventListener('click', () => sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')));
    await userEvent.click(byText('label', 'Send me the newsletter'));
    await userEvent.click(sw);
    await userEvent.click(sw);
    await settle();
    expect(titles()).toEqual(['check: Check **Send me the newsletter**', 'check: Check **Dark mode**', 'check: Uncheck **Dark mode**']);
  });

  it('a click on a submit button followed by submit is one submit step', async () => {
    const form = q('form[aria-label="Profile"]') as HTMLFormElement;
    form.addEventListener('submit', (e) => e.preventDefault(), { once: true });
    await userEvent.click(byText('button', 'Save'));
    await settle();
    expect(titles()).toEqual(['submit: Submit the form']);
    expect(steps()[0]!.target?.text).toBe('Save');
  });

  it('a double-click is one click step; keyboard activation records a click', async () => {
    await userEvent.dblClick(byText('button', 'Import'));
    byText('button', 'Export').focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(titles()).toEqual(['click: Click **Import**', 'click: Click **Export**']);
  });

  it('a custom dropdown stays two steps: open it, then choose the option', async () => {
    await userEvent.click(q('[role=combobox]'));
    await userEvent.click(q('[role=option]:nth-child(2)'));
    await settle();
    expect(titles()).toEqual(['click: Click **Status**', 'select: Choose **Closed**']);
    expect(steps()[1]!.target?.role).toBe('option');
  });

  it('a native select records one select step with the visible option label', async () => {
    const select = q('#country') as HTMLSelectElement;
    select.focus();
    await userEvent.keyboard('{ArrowDown}');
    await settle();
    expect(titles()).toEqual(['select: Choose **Germany** in **Country**']);
  });

  it('ignores untrusted events and events inside the overlay', async () => {
    q('#first-name').click();
    byText('button', 'Import').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rec?.stop();
    const host = document.createElement('div');
    document.body.append(host);
    rec = createRecorder({ emit: (op) => ops.push(op), isOwnEvent: (p) => p.includes(host) });
    const b = document.createElement('button');
    b.textContent = 'Overlay button';
    host.append(b);
    await userEvent.click(b);
    await settle();
    expect(ops).toEqual([]);
    host.remove();
  });
});

describe('privacy guards', () => {
  it('password, credit-card and one-time-code fields are "Enter your …" with no value', async () => {
    const box = document.createElement('form');
    box.setAttribute('aria-label', 'Login');
    const make = (label: string, attrs: Record<string, string>) => {
      const id = `f-${label.replace(/\W/g, '')}`;
      const l = document.createElement('label');
      l.htmlFor = id;
      l.textContent = label;
      const i = document.createElement('input');
      i.id = id;
      for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
      box.append(l, i);
      return i;
    };
    const pw = make('Password', { type: 'password' });
    const cc = make('Card number', { autocomplete: 'cc-number' });
    const otp = make('Code', { autocomplete: 'one-time-code' });
    document.body.append(box);
    await userEvent.type(pw, 'hunter2-secret');
    await userEvent.type(cc, '4242424242424242');
    await userEvent.type(otp, '991122');
    await settle();
    expect(titles()).toEqual(['input: Enter your Password', 'input: Enter your Card number', 'input: Enter your Code']);
    const json = JSON.stringify(ops);
    for (const secret of ['hunter2', '4242', '991122']) expect(json).not.toContain(secret);
    box.remove();
  });
});

describe('review regressions', () => {
  it('clicking back into a field already typed into adds no step', async () => {
    const form = q('form[aria-label="Profile"]') as HTMLFormElement;
    form.addEventListener('submit', (e) => e.preventDefault(), { once: true });
    await userEvent.click(q('#first-name'));
    await userEvent.keyboard('Ada');
    await userEvent.click(q('#first-name'));
    await userEvent.click(byText('button', 'Save'));
    await settle();
    expect(titles()).toEqual(['input: Enter First name', 'submit: Submit the form']);
  });

  it('records a native select and a form submit inside an open shadow root', async () => {
    const host = document.createElement('fx-shadow-form');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const form = document.createElement('form');
    form.setAttribute('aria-label', 'Shadow form');
    form.addEventListener('submit', (e) => e.preventDefault());
    const label = document.createElement('label');
    label.htmlFor = 'size';
    label.textContent = 'Size';
    const select = document.createElement('select');
    select.id = 'size';
    for (const t of ['Small', 'Large']) {
      const o = document.createElement('option');
      o.textContent = t;
      select.append(o);
    }
    const save = document.createElement('button');
    save.textContent = 'Apply';
    form.append(label, select, save);
    root.append(form);

    await userEvent.click(select);
    select.focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(save);
    await settle();
    expect(titles()).toEqual(['select: Choose **Large** in **Size**', 'submit: Submit the form']);
    host.remove();
  });
});
