/**
 * Issue #69 (D170): the ? menu's search with many guides, in the production closed shadow root.
 * Everything is done with real key presses: focus lands in the box, typing filters, arrows move,
 * Enter starts, Esc clears and then closes. The page's own key listeners never see the typing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { startLauncher } from '../../src/content/launcher';
import { destroyOverlay } from '../../src/content/overlay/host';

const mark = (name: string) => document.documentElement.getAttribute(`data-waymark-test-${name}`);
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(fn()).toBe(true);
};

const MANY = [
  { id: 'inv', title: 'Send an invoice', tags: ['Billing'] },
  { id: 'ref', title: 'Refund a payment', tags: ['Billing'] },
  { id: 'cre', title: 'Crème brûlée order', tags: ['Kitchen'] },
  { id: 'tea', title: 'Invite a teammate', tags: ['Team'] },
  { id: 'rep', title: 'Export the report', tags: ['Reports'] },
  { id: 'adr', title: 'Change the address', tags: ['Account'] },
  { id: 'pwd', title: 'Reset a password', tags: ['Account'] },
];

let started: string[] = [];
let launcher: ReturnType<typeof startLauncher> | null = null;
let pageKeys: string[] = [];
const onPageKey = (e: KeyboardEvent) => pageKeys.push(`${e.type}:${e.key}`);
const search0 = location.search;

async function open(guides: typeof MANY) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (m: { type: string; payload: { guideId?: string } }) => {
        if (m.type === 'guide.forPage') return { ok: true, data: { guides, launcher: true } };
        if (m.type === 'launcher.start') {
          started.push(m.payload.guideId!);
          return { ok: true, data: { status: 'started' } };
        }
        return { ok: true, data: {} };
      },
    },
  });
  launcher = startLauncher(true);
  launcher.refresh();
  await until(() => mark('launcher') === String(guides.length));
  // The closed root: from the document, only the host can be seen.
  const host = document.querySelector('waymark-overlay') as HTMLElement;
  expect(host.shadowRoot).toBeNull();
  // Keyboard only: Tab reaches the ? button, Enter opens the menu.
  (document.activeElement as HTMLElement | null)?.blur();
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(host);
  await userEvent.keyboard('{Enter}');
  return host;
}

beforeEach(() => {
  // The production closed root (D85): test builds read this from the page's query.
  history.replaceState(null, '', `${location.pathname}?waymark-test-closed`);
  started = [];
  pageKeys = [];
  document.addEventListener('keydown', onPageKey);
  window.addEventListener('keyup', onPageKey);
});
afterEach(() => {
  launcher?.dispose();
  launcher = null;
  destroyOverlay();
  document.removeEventListener('keydown', onPageKey);
  window.removeEventListener('keyup', onPageKey);
  for (const a of [...document.documentElement.attributes]) if (a.name.startsWith('data-waymark-test-')) document.documentElement.removeAttribute(a.name);
  history.replaceState(null, '', `${location.pathname}${search0}`);
  vi.unstubAllGlobals();
});

describe('? menu search with many guides, closed shadow root (D170)', () => {
  it('opens with focus in the box; typing filters; arrows move; Enter starts the selected guide', async () => {
    const host = await open(MANY);
    expect(mark('launcher-menu')).toBe('search');
    expect(mark('launcher-results')).toBe(MANY.map((g) => g.id).join(','));
    expect(document.activeElement).toBe(host); // focus is inside the overlay (in the box)

    await userEvent.keyboard('inv');
    expect(mark('launcher-results')).toBe('inv,tea');
    expect(mark('launcher-active')).toBe('inv'); // the best match is selected
    await userEvent.keyboard('{ArrowDown}');
    expect(mark('launcher-active')).toBe('tea');
    await userEvent.keyboard('{ArrowDown}'); // stays on the last one
    expect(mark('launcher-active')).toBe('tea');
    await userEvent.keyboard('{ArrowUp}');
    expect(mark('launcher-active')).toBe('inv');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await until(() => started.length === 1);
    expect(started).toEqual(['tea']);
    await until(() => mark('launcher-menu') === 'closed');
    // Typing never reached the page's own shortcuts.
    expect(pageKeys.filter((k) => /:(i|n|v|ArrowDown|ArrowUp)$/.test(k))).toEqual([]);
  });

  it('is case- and accent-insensitive and says when nothing matches', async () => {
    await open(MANY);
    await userEvent.keyboard('CREME');
    expect(mark('launcher-results')).toBe('cre');
    await userEvent.keyboard(' zzz');
    expect(mark('launcher-results')).toBe('');
    expect(mark('launcher-active')).toBe('');
    await userEvent.keyboard('{Enter}');
    expect(started).toEqual([]);
    expect(mark('launcher-menu')).toBe('search');
  });

  it('Esc clears the search first, and a second Esc closes and gives focus back to the ? button', async () => {
    const host = await open(MANY);
    await userEvent.keyboard('refund');
    expect(mark('launcher-results')).toBe('ref');
    await userEvent.keyboard('{Escape}');
    expect(mark('launcher-menu')).toBe('search');
    expect(mark('launcher-results')).toBe(MANY.map((g) => g.id).join(','));
    expect(mark('launcher-active')).toBe('');
    // Still typing into the box after the clear.
    await userEvent.keyboard('acc');
    expect(mark('launcher-results')).toBe('adr,pwd');
    await userEvent.keyboard('{Escape}{Escape}');
    expect(mark('launcher-menu')).toBe('closed');
    expect(document.activeElement).toBe(host); // the ? button, inside the closed root
    // Neither Esc pressed inside the menu reached the page (the last key-up lands on the ? button, outside it).
    expect(pageKeys.filter((k) => k === 'keydown:Escape')).toEqual([]);
  });

  it('tag chips filter (Tab reaches them); a press inside the overlay keeps the menu open, a press on the page closes it', async () => {
    const host = await open(MANY);
    await userEvent.keyboard('{Tab}'); // first chip: Account and Billing have 2 guides each, by name
    await userEvent.keyboard('{Enter}');
    expect(mark('launcher-results')).toBe('adr,pwd');
    await userEvent.keyboard('{Tab}{Enter}'); // and Billing: no guide carries both
    expect(mark('launcher-results')).toBe('');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Enter}'); // Account off: Billing alone
    expect(mark('launcher-results')).toBe('inv,ref');
    await userEvent.keyboard('{Escape}'); // clears the chips too, focus back in the box
    expect(mark('launcher-results')).toBe(MANY.map((g) => g.id).join(','));
    await userEvent.keyboard('rep');
    expect(mark('launcher-results')).toBe('rep');
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(mark('launcher-menu')).toBe('search');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(mark('launcher-menu')).toBe('closed');
  });

  it('with fewer than 6 guides nothing changes: a plain list of buttons, focus on the first', async () => {
    const host = await open(MANY.slice(0, 5));
    expect(mark('launcher-menu')).toBe('list');
    expect(mark('launcher-results')).toBeNull();
    await userEvent.keyboard('{Enter}');
    await until(() => started.length === 1);
    expect(started).toEqual(['inv']);
    void host;
  });
});
