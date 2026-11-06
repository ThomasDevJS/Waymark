/** D204 (#94): hover steps bump the pack format; reveals are judged from the old attribute value. */
import { describe, expect, it } from 'vitest';
import { makePack, packFormatFor, parsePack } from '../../src/core/sharing/pack';
import { createHoverTracker, isReveal } from '../../src/core/recorder/hover';
import { stepTitle } from '../../src/core/text/templates';
import type { Guide, Step } from '../../src/core/model/schema';

const target = { instance: 'unique' as const, matchCount: 1, tag: 'button', text: 'Reports', cssPath: 'button', xpath: '/html[1]/body[1]/button[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const step = (kind: Step['kind'], id: string): Step => ({ id, kind, title: 't', url: { kind: 'pattern', value: '/' }, advance: 'action', target });
const guide = (steps: Step[]): Guide => ({
  id: 'g',
  schemaVersion: 1,
  revisionId: 'g-r1',
  title: 'Guide',
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.test'],
  startUrl: 'https://app.test/',
  matchUrls: [{ kind: 'prefix', value: '/' }],
  steps,
  version: 1,
  source: 'local',
  updatedAt: '2026-11-06T00:00:00.000Z',
});

describe('pack format (D204)', () => {
  it('stays 1 without hover steps, so older Waymark keeps reading those packs', () => {
    const g = guide([step('click', 's1')]);
    expect(packFormatFor([g])).toBe(1);
    expect(makePack([g]).formatVersion).toBe(1);
  });

  it('is 2 with a hover step, round-trips, and an older reader would say "newer version"', () => {
    const g = guide([step('hover', 's1'), step('click', 's2')]);
    const pack = makePack([{ ...guide([step('click', 'x')]), id: 'g0', revisionId: 'g0-r1' }, g]);
    expect(pack.formatVersion).toBe(2);
    const r = parsePack(JSON.stringify(pack));
    expect(r.ok && r.pack.guides[1]!.steps[0]!.kind).toBe('hover');
    // what 0.7.0 checks: formatVersion above its own (1)
    expect(pack.formatVersion > 1).toBe(true);
  });

  it('has a title template for hover steps', () => {
    expect(stepTitle('hover', { name: 'Reports' }, 'en')).toBe('Point at **Reports**');
  });
});

describe('isReveal (D204)', () => {
  const el = (attrs: Record<string, string>) => {
    const e = document.createElement('div');
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const rec = (attributeName: string, oldValue: string | null) => ({ attributeName, oldValue });

  it('hidden, aria-hidden, open and data-state', () => {
    expect(isReveal(rec('hidden', ''), el({}))).toBe(true);
    expect(isReveal(rec('hidden', null), el({ hidden: '' }))).toBe(false);
    expect(isReveal(rec('aria-hidden', 'true'), el({ 'aria-hidden': 'false' }))).toBe(true);
    expect(isReveal(rec('aria-hidden', 'false'), el({ 'aria-hidden': 'true' }))).toBe(false);
    expect(isReveal(rec('open', null), el({ open: '' }))).toBe(true);
    expect(isReveal(rec('data-state', 'closed'), el({ 'data-state': 'open' }))).toBe(true);
    expect(isReveal(rec('data-state', 'open'), el({ 'data-state': 'closed' }))).toBe(false);
  });

  it('inline style: shown only when it was display:none, visibility:hidden or opacity:0', () => {
    expect(isReveal(rec('style', 'display: none'), el({ style: 'display: block' }))).toBe(true);
    expect(isReveal(rec('style', 'top: 4px; visibility:hidden'), el({ style: 'top: 4px' }))).toBe(true);
    expect(isReveal(rec('style', 'opacity: 0;'), el({ style: 'opacity: 1;' }))).toBe(true);
    expect(isReveal(rec('style', 'opacity: 0.5'), el({ style: 'opacity: 1' }))).toBe(false);
    expect(isReveal(rec('style', 'width: 100px'), el({ style: 'width: 120px' }))).toBe(false);
    expect(isReveal(rec('style', 'display: block'), el({ style: 'display: none' }))).toBe(false);
  });

  it('class: a "show" token added or a "hidden" token removed', () => {
    expect(isReveal(rec('class', 'menu'), el({ class: 'menu is-open' }))).toBe(true);
    expect(isReveal(rec('class', 'menu d-none'), el({ class: 'menu' }))).toBe(true);
    expect(isReveal(rec('class', 'tick-1'), el({ class: 'tick-2' }))).toBe(false);
    expect(isReveal(rec('class', 'menu is-open'), el({ class: 'menu' }))).toBe(false);
    expect(isReveal(rec('class', 'menu'), el({ class: 'menu menu--open' }))).toBe(true);
    expect(isReveal(rec('class', 'menu d-none'), el({ class: 'menu' }))).toBe(true);
  });

  it('review fix: class words match whole, not inside other words', () => {
    expect(isReveal(rec('class', 'a'), el({ class: 'a invisible' }))).toBe(false);
    expect(isReveal(rec('class', 'a'), el({ class: 'a focus-visible' }))).toBe(false);
    expect(isReveal(rec('class', 'a'), el({ class: 'a text-center' }))).toBe(false);
    expect(isReveal(rec('class', 'a'), el({ class: 'a inactive' }))).toBe(false);
    expect(isReveal(rec('class', 'a shadow-none'), el({ class: 'a' }))).toBe(false);
    // a carousel moving "active" along every few seconds restyles itself; it reveals nothing
    expect(isReveal(rec('class', 'slide'), el({ class: 'slide active' }))).toBe(false);
  });
});

describe('createHoverTracker (D204)', () => {
  const pathOf = (e: Element): EventTarget[] => {
    const p: EventTarget[] = [];
    for (let n: Element | null = e; n; n = n.parentElement) p.push(n);
    return [...p, document];
  };
  const added = (n: Element) => [{ type: 'childList', addedNodes: [n] as unknown as NodeList, removedNodes: [] as unknown as NodeList, target: n.parentNode! } as unknown as MutationRecord];
  const setup = () => {
    const beta = Object.assign(document.createElement('button'), { textContent: 'Beta' });
    const menu = document.createElement('div');
    const item = Object.assign(document.createElement('button'), { textContent: 'Item' });
    menu.append(item);
    document.body.replaceChildren(beta, menu);
    return { beta, menu, item };
  };

  it('the pointer on the trigger before the reveal: the trigger', () => {
    const { beta, menu, item } = setup();
    const t = createHoverTracker();
    t.over(pathOf(beta), 10_000);
    t.mutated(added(menu), 10_000);
    t.over(pathOf(item), 10_300);
    expect(t.triggerFor(item, 10_400, 0)).toBe(beta);
  });

  it('review fix: a pointerover just AFTER the reveal is the page moving under a still pointer, not a trigger', () => {
    const { beta, menu, item } = setup();
    const t = createHoverTracker();
    t.mutated(added(menu), 10_000);
    t.over(pathOf(beta), 10_012); // Chrome's boundary event once the inserted content moved Beta under the pointer
    t.over(pathOf(item), 10_300);
    expect(t.triggerFor(item, 10_400, 0)).toBeNull();
  });

  it('review fix: a pointerover right after a scroll is the page moving, not a trigger', () => {
    const { beta, menu, item } = setup();
    const t = createHoverTracker();
    t.scrolled(9_900);
    t.over(pathOf(beta), 9_950);
    t.mutated(added(menu), 10_000);
    t.over(pathOf(item), 10_300);
    expect(t.triggerFor(item, 10_400, 0)).toBeNull();
  });

  it('review fix: a record that also removes elements is a re-render, not a reveal', () => {
    const { beta, menu, item } = setup();
    const t = createHoverTracker();
    t.over(pathOf(beta), 10_000);
    const old = document.createElement('div');
    t.mutated([{ type: 'childList', addedNodes: [menu] as unknown as NodeList, removedNodes: [old] as unknown as NodeList, target: document.body } as unknown as MutationRecord], 10_000);
    t.over(pathOf(item), 10_300);
    expect(t.triggerFor(item, 10_400, 0)).toBeNull();
  });
});
