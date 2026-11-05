/**
 * D86 (#46): test builds use an open overlay root, the store build a closed one. eventPath() makes a
 * listener outside the overlay see what it sees in production, so tests can't hide bugs like #42.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { destroyOverlay, eventPath, overlayHost, overlayLayer } from '../../src/content/overlay/host';
import { pressInsideLauncher } from '../../src/content/launcher';

afterEach(() => destroyOverlay());

describe('eventPath (D86)', () => {
  it('a document listener sees a press inside the overlay only as the host, as with a closed root', () => {
    const layer = overlayLayer();
    const item = document.createElement('button');
    layer.append(item);
    let outside: EventTarget[] = [];
    let inside: EventTarget[] = [];
    const doc = (e: Event) => (outside = eventPath(e));
    const own = (e: Event) => (inside = eventPath(e));
    document.addEventListener('pointerdown', doc, true);
    layer.addEventListener('pointerdown', own);
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    document.removeEventListener('pointerdown', doc, true);
    expect(outside.includes(item)).toBe(false);
    expect(outside.includes(layer)).toBe(false);
    expect(outside[0]).toBe(overlayHost());
    expect(inside.includes(item)).toBe(true); // listeners inside the overlay keep the full path
    // The #42 check, run as a test build now runs it: without the host it would call this "outside".
    expect(pressInsideLauncher(outside, layer, null, null)).toBe(false);
    expect(pressInsideLauncher(outside, layer, null, overlayHost())).toBe(true);
  });

  it('events outside the overlay are untouched', () => {
    overlayLayer();
    const p = document.createElement('p');
    document.body.append(p);
    let seen: EventTarget[] = [];
    const doc = (e: Event) => (seen = eventPath(e));
    document.addEventListener('click', doc, true);
    p.click();
    document.removeEventListener('click', doc, true);
    expect(seen[0]).toBe(p);
    p.remove();
  });
});
