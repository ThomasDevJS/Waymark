/**
 * D204 (#94): a click on an item of a menu that opened while the pointer rested on its trigger is
 * recorded as "Point at" the trigger, then the click. Tooltips, `title`, rows that highlight on
 * hover, click-opened menus and pages that restyle themselves record no hover step.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createRecorder, type Recorder, type RecorderOp } from '../../src/core/recorder/recorder';
import type { Step } from '../../src/core/model/schema';

let ops: RecorderOp[] = [];
let rec: Recorder | null = null;
let root: HTMLElement;

function steps(): Step[] {
  const out: Step[] = [];
  for (const op of ops) {
    if (op.op === 'add') out.push(op.step);
    else if (out[out.length - 1]?.id === op.stepId) out[out.length - 1] = op.step;
  }
  return out;
}
const titles = () => steps().map((s) => `${s.kind}: ${s.title}`);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function el(tag: string, attrs: Record<string, string>, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

beforeEach(() => {
  ops = [];
  root = el(
    'div',
    { style: 'font:14px sans-serif;padding:8px' },
    el('p', { id: 'start' }, 'Start here'),
    // A side nav whose item shows its flyout on mouseenter (style display:none → shown).
    el(
      'nav',
      { 'aria-label': 'Side', style: 'display:flex;flex-direction:column;width:160px' },
      el(
        'div',
        { class: 'nav-item', id: 'reports-item' },
        el('button', { id: 'reports' }, 'Reports'),
        el('div', { class: 'flyout', id: 'reports-flyout', style: 'display: none' }, el('a', { href: '#fuel', id: 'fuel' }, 'Fuel'), ' ', el('a', { href: '#idle', id: 'idle' }, 'Idle time')),
      ),
      el('button', { id: 'settings' }, 'Settings'),
    ),
    // A trigger whose menu is inserted into a portal on mouseenter.
    el('button', { id: 'more' }, 'More actions'),
    el('div', { id: 'portal' }),
    // A button with a tooltip inserted on hover, and one with a title.
    el('button', { id: 'tip' }, 'Archive'),
    el('button', { id: 'titled', title: 'Delete this' }, 'Delete'),
    // Rows that highlight on hover, with an action in each.
    el(
      'table',
      {},
      el(
        'tbody',
        {},
        el('tr', { id: 'r1' }, el('td', {}, 'Truck 1'), el('td', {}, el('button', { id: 'edit1' }, 'Edit truck 1'))),
        el('tr', { id: 'r2' }, el('td', {}, 'Truck 2'), el('td', {}, el('button', { id: 'edit2' }, 'Edit truck 2'))),
      ),
    ),
    // A menu opened by a click.
    el('button', { id: 'click-menu' }, 'Export'),
    el('div', { id: 'click-flyout', hidden: '' }, el('button', { id: 'csv' }, 'As CSV')),
    // A button that shows a panel a moment after its click.
    el('button', { id: 'details' }, 'Details'),
    el('div', { id: 'details-panel', hidden: '' }, el('button', { id: 'close-details' }, 'Close details')),
    // A live panel that restyles itself.
    el('section', { id: 'live', style: 'width: 100px' }, el('button', { id: 'refresh' }, 'Refresh')),
  );
  document.body.append(root);

  const item = q('#reports-item');
  const flyout = q('#reports-flyout');
  item.addEventListener('mouseenter', () => (flyout.style.display = 'block'));
  item.addEventListener('mouseleave', () => {
    if (!flyout.dataset.sticky) flyout.style.display = 'none';
  });

  q('#more').addEventListener('mouseenter', () => {
    if (q('#portal').firstChild) return;
    q('#portal').append(el('div', { role: 'menu', id: 'more-menu' }, el('button', { role: 'menuitem', id: 'dup' }, 'Duplicate')));
  });

  q('#tip').addEventListener('mouseenter', () => q('#tip').after(el('div', { role: 'tooltip', id: 'tooltip' }, 'Moves it to the archive')));
  q('#tip').addEventListener('mouseleave', () => document.getElementById('tooltip')?.remove());

  for (const r of ['#r1', '#r2']) {
    q(r).addEventListener('mouseenter', () => q(r).classList.add('row-hover'));
    q(r).addEventListener('mouseleave', () => q(r).classList.remove('row-hover'));
  }

  q('#click-menu').addEventListener('click', () => q('#click-flyout').removeAttribute('hidden'));

  q('#details').addEventListener('click', () => setTimeout(() => q('#details-panel').removeAttribute('hidden'), 300));

  rec = createRecorder({ emit: (op) => ops.push(op) });
});
afterEach(() => {
  rec?.stop();
  root.remove();
});

describe('hover menus (D204)', () => {
  it('a flyout shown on mouseenter records "Point at" its trigger, then the click', async () => {
    await userEvent.hover(q('#reports'));
    await settle();
    await userEvent.click(q('#fuel'));
    await settle();
    expect(titles()).toEqual(['hover: Point at **Reports**', 'click: Click **Fuel**']);
    expect(steps()[0]!.target?.text).toBe('Reports');
  });

  it('a menu inserted into a portal on mouseenter records "Point at" its trigger', async () => {
    await userEvent.hover(q('#more'));
    await settle();
    await userEvent.click(q('#dup'));
    await settle();
    expect(titles()).toEqual(['hover: Point at **More actions**', 'click: Click **Duplicate**']);
  });

  it('a second click in the same open menu records no second hover', async () => {
    await userEvent.hover(q('#reports'));
    await settle();
    await userEvent.click(q('#fuel'));
    await userEvent.click(q('#idle'));
    await settle();
    expect(titles()).toEqual(['hover: Point at **Reports**', 'click: Click **Fuel**', 'click: Click **Idle time**']);
  });

  it('no hover for a tooltip: on the clicked button itself, or on another button before', async () => {
    await userEvent.hover(q('#tip'));
    await settle();
    await userEvent.click(q('#tip'));
    await userEvent.hover(q('#tip'));
    await settle();
    await userEvent.click(q('#titled'));
    await settle();
    expect(titles()).toEqual(['click: Click **Archive**', 'click: Click **Delete**']);
  });

  it('no hover for a title attribute', async () => {
    await userEvent.hover(q('#titled'));
    await settle(200);
    await userEvent.click(q('#titled'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('no hover for a row that highlights while the pointer crosses it', async () => {
    await userEvent.hover(q('#r1 td'));
    await settle();
    await userEvent.hover(q('#r2 td'));
    await settle();
    await userEvent.click(q('#edit2'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('a menu opened by a click is two clicks', async () => {
    await userEvent.hover(q('#click-menu'));
    await settle();
    await userEvent.click(q('#click-menu'));
    await settle();
    await userEvent.click(q('#csv'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click', 'click']);
  });

  it('no hover when the page restyles a container while the pointer rests elsewhere', async () => {
    await userEvent.hover(q('#settings'));
    q('#live').style.width = '120px';
    q('#live').className = 'tick';
    await settle();
    await userEvent.click(q('#refresh'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('no hover when the pointer wandered off the menu before the click', async () => {
    // the menu is sticky here: it stays open when the pointer leaves
    q('#reports-flyout').dataset.sticky = '1';
    await userEvent.hover(q('#reports'));
    await settle();
    await userEvent.hover(q('#start'));
    await settle();
    await userEvent.click(q('#fuel'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('no hover for a panel a click loaded while the pointer drifted onto another button', async () => {
    await userEvent.click(q('#details'));
    await userEvent.hover(q('#titled'));
    await settle(400);
    await userEvent.click(q('#close-details'));
    await settle();
    expect(titles()).toEqual(['click: Click **Details**', 'click: Click **Close details**']);
  });

  it('a trigger that announces its popup may open it later, even right after a step', async () => {
    const more = q('#more');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('mouseenter', () => setTimeout(() => q('#portal').firstElementChild?.removeAttribute('hidden'), 900), { once: true });
    // the menu is inserted hidden at once, then shown 900 ms later
    q('#portal').append(el('div', { role: 'menu', hidden: '' }, el('button', { role: 'menuitem', id: 'dup2' }, 'Rename')));
    await userEvent.click(q('#settings'));
    await userEvent.hover(more);
    await settle(1000);
    await userEvent.click(q('#dup2'));
    await settle();
    expect(titles()).toEqual(['click: Click **Settings**', 'hover: Point at **More actions**', 'click: Click **Rename**']);
  });

  it('no hover when a step was recorded after the pointer reached the trigger', async () => {
    await userEvent.hover(q('#more'));
    // a keyboard-activated click elsewhere is recorded while the pointer rests on the trigger
    q('#settings').focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    await userEvent.click(q('#dup'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click', 'click']);
  });
});
