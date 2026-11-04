/**
 * Review H2 (docs/DECISIONS.md, "Review fixes (PR #1)"): inside shadow DOM, a twin widget is as
 * ambiguous as a twin in the light DOM. Every root a shadow path step matches is searched, and
 * the fast path counts matches across all of them.
 */
import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce, waitForMatch } from '../../src/core/matcher';
import { $, host, html, useRoot } from './markup';

useRoot();

function widget(cls: string, inner: string): HTMLElement {
  const el = document.createElement('x-search');
  el.className = cls;
  html(inner, el.attachShadow({ mode: 'open' }));
  return el;
}
const INNER = `<div class="panel"><input placeholder="Find"><button class="go">Go</button></div>`;

describe('H2: shadow DOM twins are as ambiguous as light DOM twins', () => {
  it('an identical widget inserted before the recorded one makes the match ambiguous', () => {
    const original = widget('search', INNER);
    host().append(original);
    const btn = $('button', original.shadowRoot!);
    const fp = buildFingerprint(btn);
    expect(matchOnce(document, fp)).toMatchObject({ status: 'found', element: btn });
    original.before(widget('search', INNER));
    expect(matchOnce(document, fp)).toMatchObject({ status: 'not-found', reason: 'ambiguous' });

    // The light DOM equivalent, for comparison.
    html(`<div class="search"><div class="panel"><input placeholder="Find"><button class="go">Go</button></div></div>`);
    const light = buildFingerprint($('button.go'));
    $('div.search').before($('div.search').cloneNode(true));
    expect(matchOnce(document, light)).toMatchObject({ status: 'not-found', reason: 'ambiguous' });
  });

  it('twin widgets present at record time behave like repeated light DOM elements', () => {
    host().append(widget('search', INNER), widget('search', INNER));
    const second = $('button', host().children[1]!.shadowRoot!);
    const fp = buildFingerprint(second);
    expect(fp.instance).toBe('any');
    expect(fp.matchCount).toBe(2);
    // A third twin inserted first: one of the group, never a confident pick of the wrong one.
    host().prepend(widget('search', INNER));
    const r = matchOnce(document, fp);
    expect(r.status === 'found' && r.tied.length).toBe(3);
    // The spotlight goes to the first tied candidate in (composed) document order.
    expect(r.status === 'found' && r.element).toBe($('button', host().children[0]!.shadowRoot!));
  });

  it('broken shadow path with a test id in two widgets: the fast path does not take the first', () => {
    const a = widget('panel-a', `<button data-testid="save">Save</button>`);
    const b = widget('panel-b', `<button data-testid="save">Save</button>`);
    host().append(a, b);
    const btn = $('button', b.shadowRoot!);
    const fp = buildFingerprint(btn);
    expect(matchOnce(document, fp)).toMatchObject({ status: 'found', element: btn });
    b.className = 'panel-c'; // the host's class changes: the recorded shadow path no longer resolves
    expect(matchOnce(document, fp).status).toBe('not-found');
  });

  it('a test id unique across every searched root still takes the fast path', () => {
    const a = widget('panel-a', `<button data-testid="save">Save</button>`);
    const b = widget('panel-b', `<button data-testid="publish">Publish</button>`);
    host().append(a, b);
    const btn = $('button', b.shadowRoot!);
    const fp = buildFingerprint(btn);
    b.className = 'panel-c';
    expect(matchOnce(document, fp)).toMatchObject({ status: 'found', element: btn, via: 'fast-path' });
  });

  it('the wait loop searches and observes every widget root the path matches', async () => {
    const a = widget('search', `<div class="panel"></div>`);
    const b = widget('search', INNER);
    host().append(a, b);
    const btn = $('button', b.shadowRoot!);
    const fp = buildFingerprint(btn);
    btn.remove();
    setTimeout(() => $('.panel', b.shadowRoot!).append(btn), 150);
    const t0 = performance.now();
    const r = await waitForMatch(document, fp, { timeoutMs: 3000 });
    expect(r).toMatchObject({ status: 'found', element: btn });
    // Seen by the observer on the second widget's root, not by the 500 ms safety poll.
    expect(performance.now() - t0).toBeLessThan(450);
  });
});
