/** D156: the recording outline's check stays cheap on a large page (Thomas: hover hit performance). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { previewClick } from '../../src/core/recorder/preview';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  const table = document.createElement('table');
  for (let i = 0; i < 1500; i++) {
    const tr = document.createElement('tr');
    for (const text of [`Driver ${i}`, `${(i * 7) % 100} points`]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.textContent = 'Edit';
    td.append(b);
    tr.append(td);
    table.append(tr);
  }
  root.append(table);
  document.body.append(root);
});
afterEach(() => root.remove());

const pathOf = (el: Element): EventTarget[] => {
  const p: EventTarget[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) p.push(n);
  return [...p, document, window];
};

describe('hover check cost on a 1,500-row table (D156)', () => {
  it('a check takes a few milliseconds, not hundreds (it scanned the whole page each time)', () => {
    const fpOf = (el: Element) => buildFingerprint(el, { framePath: [] });
    const lightFpOf = (el: Element) => buildFingerprint(el, { light: true });
    const cells = [...root.querySelectorAll('td')].filter((_, i) => i % 97 === 0).slice(0, 30);
    const t0 = performance.now();
    for (const c of cells) previewClick(pathOf(c.querySelector('button') ?? c), fpOf, lightFpOf);
    const per = (performance.now() - t0) / cells.length;
    // Before D156: about 320 ms per check here, blocking the page each time the pointer settled.
    expect(per).toBeLessThan(20);
  });
});
