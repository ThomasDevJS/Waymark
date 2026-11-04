/** Fingerprint details that need a real layout engine. */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFingerprint, resolveTargetFromPath, buildXPath, resolveXPath } from '../../src/core/fingerprint';
import { matchOnce, waitForMatch } from '../../src/core/matcher';

const host = () => document.getElementById('fp-root')!;
beforeEach(() => {
  document.getElementById('fp-root')?.remove();
  const el = document.createElement('div');
  el.id = 'fp-root';
  document.body.replaceChildren(el);
});

function html(markup: string) {
  // test-only markup from constants
  const t = document.createElement('template');
  t.innerHTML = markup; // eslint-disable-line no-restricted-properties
  host().replaceChildren(t.content);
}

describe('record-time target resolution', () => {
  it('takes the nearest interactive element within 5 levels; a label resolves to its control', () => {
    html(`<button id="b"><span><i id="icon">x</i></span></button><label id="l" for="f">Name</label><input id="f">`);
    const icon = document.getElementById('icon')!;
    const path = [icon, icon.parentElement!, document.getElementById('b')!, host(), document.body];
    expect(resolveTargetFromPath(path)?.element.id).toBe('b');
    const label = document.getElementById('l')!;
    expect(resolveTargetFromPath([label, host()])?.element.id).toBe('f');
    expect(resolveTargetFromPath([host(), document.body])).toMatchObject({ lowConfidence: true });
  });

  it('sees inside open shadow roots via composedPath', () => {
    const el = document.createElement('div');
    host().append(el);
    const sr = el.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.textContent = 'Inner';
    sr.append(btn);
    let path: EventTarget[] = [];
    document.addEventListener('click', (e) => (path = e.composedPath()), { once: true, capture: true });
    btn.click();
    const t = resolveTargetFromPath(path)!;
    expect(t.element).toBe(btn);
    const fp = buildFingerprint(btn);
    expect(fp.shadowPath).toHaveLength(1);
    expect(fp.text).toBe('Inner');
    expect(matchOnce(document, fp)).toMatchObject({ status: 'found', element: btn });
  });
});

describe('fingerprint privacy and stability filters', () => {
  it('drops generated ids, data-like text and never stores field values', () => {
    html(`<label for=":r1:">Email</label><input id=":r1:" name="email" value="ada@example.com">
          <button id="css-1x9f2k" class="sc-bdVaJa btn">Pay $12.50</button>`);
    const input = host().querySelector('input')!;
    const fp = buildFingerprint(input);
    expect(fp.id).toBeUndefined();
    expect(fp.accessibleName).toBe('Email');
    expect(JSON.stringify(fp)).not.toContain('ada@example.com');
    const btn = host().querySelector('button')!;
    const fb = buildFingerprint(btn);
    expect(fb.id).toBeUndefined();
    expect(fb.text).toBeUndefined();
    expect(fb.cssPath).toBe('div#fp-root button.btn');
  });

  it('keeps camelCase ids, test ids and names (review L1)', () => {
    html(`<button id="addToCart">Add</button><input name="firstNameInput" aria-label="First"><button data-testid="deleteRowButton">Delete</button>`);
    expect(buildFingerprint(document.getElementById('addToCart')!).id).toBe('addToCart');
    expect(buildFingerprint(host().querySelector('input')!).name).toBe('firstNameInput');
    expect(buildFingerprint(host().querySelector('[data-testid]')!).testId).toEqual({ attr: 'data-testid', value: 'deleteRowButton' });
  });

  it('prefers data-guide-id and test ids (fast path)', () => {
    html(`<button data-guide-id="save" class="a">Save</button><button data-testid="other">Save</button>`);
    const fp = buildFingerprint(host().querySelector('[data-guide-id]')!);
    expect(fp.guideId).toBe('save');
    const r = matchOnce(document, fp);
    expect(r).toMatchObject({ status: 'found', via: 'fast-path' });
  });

  it('resolves positional XPath inside a root', () => {
    html(`<div><p></p><p><span id="s"></span></p></div>`);
    const s = document.getElementById('s')!;
    expect(resolveXPath(document, buildXPath(s))).toBe(s);
  });
});

describe('wait loop', () => {
  it('finds content that appears later', async () => {
    html(`<button>Load more</button>`);
    const fp = buildFingerprint(host().querySelector('button')!);
    host().replaceChildren();
    setTimeout(() => html(`<button>Load more</button>`), 300);
    const t0 = performance.now();
    const r = await waitForMatch(document, fp, { timeoutMs: 3000 });
    expect(r.status).toBe('found');
    expect(performance.now() - t0).toBeGreaterThan(250);
  });

  it('observes the open shadow root on the shadowPath', async () => {
    const el = document.createElement('fx-late');
    host().append(el);
    const sr = el.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.textContent = 'Inner action';
    sr.append(btn);
    const fp = buildFingerprint(btn);
    btn.remove();
    setTimeout(() => sr.append(btn), 200);
    const r = await waitForMatch(document, fp, { timeoutMs: 3000 });
    expect(r).toMatchObject({ status: 'found', element: btn });
  });

  it('gives up with not-found after the timeout, never a guess', async () => {
    html(`<button>Delete</button>`);
    const fp = buildFingerprint(host().querySelector('button')!);
    html(`<button>Archive</button>`);
    const t0 = performance.now();
    const r = await waitForMatch(document, fp, { timeoutMs: 400 });
    expect(r.status).toBe('not-found');
    expect(performance.now() - t0).toBeGreaterThanOrEqual(390);
  });

  it('can be aborted', async () => {
    html(`<button>Delete</button>`);
    const fp = buildFingerprint(host().querySelector('button')!);
    host().replaceChildren();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const r = await waitForMatch(document, fp, { timeoutMs: 5000, signal: ac.signal });
    expect(r.status).toBe('not-found');
  });
});
