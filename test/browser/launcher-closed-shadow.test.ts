/**
 * #42: in production the overlay's shadow root is closed (open only in test builds). A document
 * listener then sees the press on a menu item only as a press on the overlay host, so the old
 * "outside the menu" check closed the menu on pointerdown and the click never landed.
 */
import { describe, expect, it } from 'vitest';
import { pressInsideLauncher } from '../../src/content/launcher';

describe('launcher menu in a closed shadow root (#42)', () => {
  it('a press on a menu item counts as inside, although the document cannot see into the root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const menu = document.createElement('div');
    const item = document.createElement('button');
    item.textContent = 'Start guide';
    menu.append(item);
    const button = document.createElement('button');
    root.append(button, menu);

    let seen: EventTarget[] = [];
    const listen = (e: Event) => (seen = e.composedPath());
    document.addEventListener('pointerdown', listen, true);
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    document.removeEventListener('pointerdown', listen, true);

    // What production sees: the host, not the menu.
    expect(seen.includes(menu)).toBe(false);
    expect(seen.includes(host)).toBe(true);
    expect(pressInsideLauncher(seen, menu, button, host)).toBe(true);
    // A press on the page is outside.
    const page = document.createElement('p');
    document.body.append(page);
    expect(pressInsideLauncher([page, document.body, document.documentElement, document, window], menu, button, host)).toBe(false);
    host.remove();
    page.remove();
  });
});
