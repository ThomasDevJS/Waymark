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

  /** #more gets a menu that is shown `delay` ms after the pointer comes onto it. */
  const lateMenu = (delay: number, expandOnOpen = false) => {
    const more = q('#more');
    more.addEventListener(
      'mouseenter',
      () =>
        setTimeout(() => {
          q('#portal').firstElementChild?.removeAttribute('hidden');
          if (expandOnOpen) more.setAttribute('aria-expanded', 'true');
        }, delay),
      { once: true },
    );
    q('#portal').append(el('div', { role: 'menu', hidden: '' }, el('button', { role: 'menuitem', id: 'dup2' }, 'Rename')));
    return more;
  };

  it('a trigger with aria-haspopup may open its menu up to 2 s later', async () => {
    const more = lateMenu(900);
    more.setAttribute('aria-haspopup', 'menu');
    await userEvent.hover(more);
    await settle(1000);
    await userEvent.click(q('#dup2'));
    await settle();
    expect(titles()).toEqual(['hover: Point at **More actions**', 'click: Click **Rename**']);
  });

  it('a trigger whose aria-expanded turns true with the menu may open it up to 2 s later', async () => {
    const more = lateMenu(900, true);
    more.setAttribute('aria-expanded', 'false');
    await userEvent.hover(more);
    await settle(1000);
    await userEvent.click(q('#dup2'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['hover', 'click']);
  });

  it('review fix: an aria-expanded that stays "true" does not stretch the window', async () => {
    const more = lateMenu(900);
    more.setAttribute('aria-expanded', 'true'); // an expanded nav group, always
    await userEvent.hover(more);
    await settle(1000);
    await userEvent.click(q('#dup2'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('review fix: even with aria-haspopup, a menu shown within 1.5 s of a step is that step\'s doing', async () => {
    const more = lateMenu(900);
    more.setAttribute('aria-haspopup', 'menu');
    await userEvent.click(q('#settings'));
    await userEvent.hover(more);
    await settle(1000);
    await userEvent.click(q('#dup2'));
    await settle();
    expect(titles()).toEqual(['click: Click **Settings**', 'click: Click **Rename**']);
  });

  it('review fix: a polled table replacing its rows is not a menu', async () => {
    const tbody = q('#r1').parentElement!;
    await userEvent.hover(q('#settings'));
    await settle(100);
    tbody.replaceChildren(el('tr', {}, el('td', {}, el('a', { href: '#t3', id: 'truck3' }, 'Truck 3'))));
    await settle(50);
    await userEvent.click(q('#truck3'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('review fix: plain content the pointer rested on is not a trigger', async () => {
    const panel = el('div', { id: 'plain-panel', hidden: '' }, el('button', { id: 'plain-item' }, 'Open file'));
    root.append(panel);
    q('#start').addEventListener('mouseenter', () => panel.removeAttribute('hidden'));
    await userEvent.hover(q('#start'));
    await settle();
    await userEvent.click(q('#plain-item'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['click']);
  });

  it('review fix: a submenu records each trigger, outermost first', async () => {
    const sub = el('div', { id: 'fuel-sub', style: 'display: none' }, el('a', { href: '#log', id: 'fuel-log' }, 'Fuel log'));
    const subTrigger = el('button', { id: 'fuel-more' }, 'Fuel reports');
    const wrap = el('div', {}, subTrigger, sub);
    q('#reports-flyout').append(wrap);
    wrap.addEventListener('mouseenter', () => (sub.style.display = 'block'));
    await userEvent.hover(q('#reports'));
    await settle();
    await userEvent.hover(subTrigger);
    await settle();
    await userEvent.click(q('#fuel-log'));
    await settle();
    expect(titles()).toEqual(['hover: Point at **Reports**', 'hover: Point at **Fuel reports**', 'click: Click **Fuel log**']);
  });

  it('review fix: no hover step before a click that is not recorded (nothing to find it by)', async () => {
    const blank = el('span', { style: 'cursor:pointer;display:inline-block;width:20px;height:20px' });
    q('#reports-flyout').append(blank);
    await userEvent.hover(q('#reports'));
    await settle();
    await userEvent.click(blank);
    await settle();
    expect(steps()).toEqual([]);
  });

  it('review fix: suggestions for what is being typed are not a hover menu', async () => {
    const field = el('input', { id: 'search', 'aria-label': 'Search' }) as HTMLInputElement;
    root.prepend(field);
    await userEvent.click(field);
    await userEvent.keyboard('f');
    await settle(1100);
    await userEvent.hover(q('#settings'));
    await userEvent.keyboard('u');
    await settle(450);
    root.append(el('div', { role: 'listbox' }, el('a', { href: '#fuel-s', id: 'suggest' }, 'Fuel report')));
    await settle(50);
    await userEvent.click(q('#suggest'));
    await settle();
    expect(steps().map((s) => s.kind)).toEqual(['input', 'click']);
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
