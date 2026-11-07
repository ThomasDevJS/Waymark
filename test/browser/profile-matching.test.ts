/**
 * Site profiles and the matcher (D213), in a real browser: a stable attribute from the profile is
 * recorded and finds elements whose labels changed; without it, or when the attribute is renamed
 * or duplicated, the matcher falls back and never returns a wrong element; an ignore pattern keeps
 * generated ids out of fingerprints.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';
import { compileProfile, type SiteProfile } from '../../src/core/model/profile';
import type { ElementFingerprint } from '../../src/core/model/schema';

const ACTIONS = ['save-order', 'cancel-order', 'print-order', 'email-customer', 'archive-order', 'refund-order', 'split-order', 'merge-orders'];
const LABELS: Record<string, string> = { 'save-order': 'Save', 'cancel-order': 'Cancel', 'print-order': 'Print', 'email-customer': 'Email', 'archive-order': 'Archive', 'refund-order': 'Refund', 'split-order': 'Split', 'merge-orders': 'Merge' };

const profile = (over: Partial<SiteProfile> = {}) => compileProfile({ origin: location.origin, stableAttributes: ['data-automation-id'], ignorePatterns: [], hashRouting: false, keepQueryKeys: [], ...over });

let root: HTMLElement | null = null;

/** A toolbar of buttons; `v` changes the page the way an app update would. */
function render(v: { labels?: (a: string) => string; order?: (a: string[]) => string[]; attr?: string | null; dup?: string; ids?: (a: string) => string; cls?: string } = {}): Map<string, Element> {
  root?.remove();
  root = document.createElement('div');
  const bar = document.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Order actions');
  const keys = new Map<string, Element>();
  for (const a of (v.order ?? ((x) => x))(ACTIONS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = (v.labels ?? ((x) => LABELS[x]!))(a);
    b.className = v.cls ?? 'tb-btn x9f3k';
    if (v.attr !== null) b.setAttribute(v.attr ?? 'data-automation-id', v.dup && a !== v.dup && a === 'cancel-order' ? v.dup : a);
    if (v.ids) b.id = v.ids(a);
    bar.append(b);
    keys.set(a, b);
  }
  root.append(bar);
  document.body.append(root);
  return keys;
}

afterEach(() => {
  root?.remove();
  root = null;
});

function record(p: ReturnType<typeof profile> | undefined, v: Parameters<typeof render>[0] = {}): Map<string, ElementFingerprint> {
  const keys = render(v);
  return new Map([...keys].map(([k, el]) => [k, buildFingerprint(el, p ? { profile: p } : {})]));
}

function replay(fps: Map<string, ElementFingerprint>, v: Parameters<typeof render>[0], p?: ReturnType<typeof profile>) {
  const keys = render(v);
  let found = 0;
  const wrong: string[] = [];
  for (const [k, fp] of fps) {
    const r = matchOnce(document, fp, p ? { profile: p } : {});
    if (r.status === 'found') {
      if (r.element === keys.get(k)) found++;
      else wrong.push(k);
    }
  }
  return { found, total: fps.size, wrong };
}

const renamed = { labels: (a: string) => `${LABELS[a]} now`, order: (a: string[]) => [...a].reverse(), cls: 'tb-button q81zz' };

describe('a stable attribute from the profile (D213)', () => {
  it('is recorded as the test id, and finds every step after labels, order and classes changed', () => {
    const fps = record(profile());
    expect(fps.get('save-order')!.testId).toEqual({ attr: 'data-automation-id', value: 'save-order' });
    const r = replay(fps, renamed, profile());
    console.log(`[profile stable attr] found ${r.found}/${r.total} wrong=${r.wrong.length}`);
    expect(r.wrong).toEqual([]);
    expect(r.found).toBe(ACTIONS.length);
  });

  it('without the profile the same change is not found, and never wrong', () => {
    const fps = record(undefined);
    expect(fps.get('save-order')!.testId).toBeUndefined();
    const r = replay(fps, renamed);
    console.log(`[no profile] found ${r.found}/${r.total} wrong=${r.wrong.length}`);
    expect(r.wrong).toEqual([]);
    expect(r.found).toBeLessThan(ACTIONS.length);
  });

  it('missing on the learner’s page (renamed attribute): falls back to the other signals, never a weaker lead', () => {
    const fps = record(profile());
    // The matcher's rules decide (unchanged, D213): a recorded test id gone from the page is a lead
    // it no longer has, so it may say not found; it never picks another element.
    const same = replay(fps, { attr: 'data-auto' }, profile());
    console.log(`[profile attr renamed] found ${same.found}/${same.total} wrong=${same.wrong.length}`);
    expect(same.wrong).toEqual([]);
    const changed = replay(fps, { ...renamed, attr: 'data-auto' }, profile());
    console.log(`[profile attr renamed + labels changed] found ${changed.found}/${changed.total} wrong=${changed.wrong.length}`);
    expect(changed.wrong).toEqual([]);
  });

  it('duplicated on several elements: treated like any tie, never a wrong pick', () => {
    const fps = record(profile());
    const r = replay(fps, { ...renamed, dup: 'save-order' }, profile());
    console.log(`[profile attr duplicated] found ${r.found}/${r.total} wrong=${r.wrong.length}`);
    expect(r.wrong).toEqual([]);
  });
});

describe('an ignore pattern (D213)', () => {
  it('id=gen-* keeps generated ids out of fingerprints; regenerated ids then change nothing', () => {
    const ids = (seed: string) => (a: string) => `gen-${a}-${seed}`;
    const without = record(undefined, { ids: ids('a1') });
    expect(without.get('save-order')!.id).toBe('gen-save-order-a1');
    const fps = record(profile({ stableAttributes: [], ignorePatterns: ['id=gen-*'] }), { ids: ids('a1'), attr: null });
    expect(fps.get('save-order')!.id).toBeUndefined();
    expect(fps.get('save-order')!.cssPath).not.toContain('gen-');
    const r = replay(fps, { ids: ids('b7'), attr: null, order: (a) => [...a].reverse() });
    console.log(`[ignore id=gen-*] found ${r.found}/${r.total} wrong=${r.wrong.length}`);
    expect(r.wrong).toEqual([]);
    expect(r.found).toBe(ACTIONS.length);
    // Without the pattern the old id is a strong lead that no longer exists: still never wrong.
    const w = replay(without, { ids: ids('b7'), order: (a) => [...a].reverse() });
    expect(w.wrong).toEqual([]);
  });
});
