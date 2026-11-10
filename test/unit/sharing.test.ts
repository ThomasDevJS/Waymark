import { describe, expect, it } from 'vitest';
import { duplicateGuide, findConflicts, makePack, packOrigins, parsePack, planImport } from '../../src/core/sharing/pack';
import { applyRemovals, packStrings } from '../../src/core/sharing/review';
import { badgeText, guideMatchesUrl, guidesForUrl } from '../../src/core/discovery/match';
import { buildSearch, searchGuides } from '../../src/core/discovery/search';
import { setupPanelFallback } from '../../src/background/panel-fallback';
import { takeDeepLink } from '../../src/content/launcher';
import type { Guide } from '../../src/core/model/schema';
import { indexEntry } from '../../src/core/storage/guides';

const target = { instance: 'unique' as const, matchCount: 1, tag: 'button', text: 'Pay Ada Lovelace', accessibleName: 'Pay', cssPath: 'button', xpath: '/html[1]/body[1]/button[1]', ancestors: [{ tag: 'form', role: 'form', label: 'Billing' }], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const guide = (id: string, extra: Partial<Guide> = {}): Guide => ({
  id,
  schemaVersion: 1,
  revisionId: `${id}-r1`,
  title: `Guide ${id}`,
  lang: 'en',
  tags: ['billing'],
  appOrigins: ['https://app.test'],
  startUrl: 'https://app.test/orders',
  matchUrls: [{ kind: 'prefix', value: '/orders' }],
  steps: [{ id: `${id}-s1`, kind: 'click', title: 'Click **Pay**', note: 'Customer ACME', url: { kind: 'pattern', value: '/orders/:id' }, advance: 'action', target }],
  version: 1,
  source: 'local',
  updatedAt: '2026-11-04T00:00:00.000Z',
  ...extra,
});

describe('packs', () => {
  it('round-trips and rejects non-packs, newer versions, duplicates and oversize files with a message', () => {
    const text = JSON.stringify(makePack([guide('a')]));
    expect(parsePack(text)).toMatchObject({ ok: true });
    expect(parsePack('{nope')).toEqual({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(parsePack('{"format":"other"}')).toMatchObject({ ok: false });
    expect(parsePack(JSON.stringify({ ...makePack([guide('a')]), formatVersion: 5 }))).toEqual({ ok: false, error: expect.stringContaining('newer version') });
    expect(parsePack(JSON.stringify(makePack([{ ...guide('a'), schemaVersion: 2 as 1 }])))).toEqual({ ok: false, error: expect.stringContaining('newer version') });
    expect(parsePack(JSON.stringify(makePack([guide('a'), guide('a')])))).toMatchObject({ ok: false, error: expect.stringContaining('twice') });
    expect(parsePack('x'.repeat(5 * 1024 * 1024 + 1))).toEqual({ ok: false, error: expect.stringContaining('5 MB') });
    const tooMany = guide('a');
    tooMany.steps = Array.from({ length: 501 }, (_, i) => ({ ...tooMany.steps[0]!, id: `s${i}` }));
    expect(parsePack(JSON.stringify(makePack([tooMany])))).toMatchObject({ ok: false });
  });

  it('applies the import rules: same revision skipped; local conflicts keep, replace or keep both', () => {
    const mine = [guide('a'), guide('b'), guide('c'), guide('d')];
    const pack = makePack([guide('a'), guide('b', { revisionId: 'b-r2', title: 'B new' }), guide('c', { revisionId: 'c-r2' }), guide('d', { revisionId: 'd-r2' }), guide('e')]);
    expect(findConflicts(mine, pack).map((c) => c.id)).toEqual(['b', 'c', 'd']);
    const plan = planImport(mine, pack, { b: 'keep', c: 'replace', d: 'both' });
    expect(plan.skipped).toBe(2); // a (same revision) and b (kept)
    const ids = plan.write.map((g) => g.id);
    expect(ids).toContain('c');
    expect(ids).toContain('e');
    const fork = plan.write.find((g) => g.forkedFrom?.guideId === 'd')!;
    expect(fork.id).not.toBe('d');
    expect(fork.forkedFrom).toEqual({ guideId: 'd', revisionId: 'd-r2' });
    expect(plan.write.every((g) => g.source === 'local')).toBe(true);
  });

  it('library refreshes take the library copy, remove dropped guides, and never overwrite a local guide', () => {
    const existing = [guide('lib1', { source: 'library' }), guide('lib2', { source: 'library' }), guide('mine')];
    const pack = makePack([guide('lib1', { revisionId: 'lib1-r2' }), guide('mine', { revisionId: 'x' }), guide('new')]);
    const plan = planImport(existing, pack, {}, 'library');
    expect(plan.write.map((g) => `${g.id}:${g.source}`).sort()).toEqual(['lib1:library', 'new:library']);
    expect(plan.remove).toEqual(['lib2']);
  });

  it('duplicating a library guide gives a local copy with forkedFrom', () => {
    const d = duplicateGuide(guide('lib', { source: 'library' }));
    expect(d).toMatchObject({ source: 'local', forkedFrom: { guideId: 'lib', revisionId: 'lib-r1' }, version: 1 });
    expect(d.id).not.toBe('lib');
    expect(packOrigins([guide('a'), guide('b', { appOrigins: ['https://x.test', 'https://app.test'] })])).toEqual(['https://app.test', 'https://x.test']);
  });
});

describe('export review', () => {
  it('lists titles, notes, labels and URLs, and removes the chosen ones from the exported copy only', () => {
    const g = guide('a');
    const strings = packStrings([g]);
    const kinds = strings.map((s) => `${s.kind}:${s.value}`);
    expect(kinds).toEqual(expect.arrayContaining(['guide-title:Guide a', 'url:https://app.test/orders', 'step-title:Click **Pay**', 'note:Customer ACME', 'label:Pay Ada Lovelace', 'label:Billing']));
    expect(strings.find((s) => s.kind === 'step-title')!.removable).toBe(false);
    const drop = new Set(strings.filter((s) => s.value === 'Pay Ada Lovelace' || s.value === 'Customer ACME').map((s) => s.key));
    const [out] = applyRemovals([g], drop);
    expect(JSON.stringify(out)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(out)).not.toContain('ACME');
    expect(out!.steps[0]!.target!.accessibleName).toBe('Pay');
    expect(g.steps[0]!.note).toBe('Customer ACME'); // the local guide is unchanged
    expect(parsePack(JSON.stringify(makePack([out!])))).toMatchObject({ ok: true });
  });
});

describe('discovery', () => {
  it('offers a guide on its matchUrls pages of its origins; badge shows REC first', () => {
    const g = guide('a');
    expect(guideMatchesUrl(g, 'https://app.test/orders/12')).toBe(true);
    expect(guideMatchesUrl(g, 'https://app.test/settings')).toBe(false);
    expect(guideMatchesUrl(g, 'https://evil.test/orders')).toBe(false);
    expect(guidesForUrl([g, guide('b', { matchUrls: [{ kind: 'pattern', value: '/settings' }] })], 'https://app.test/settings').map((x) => x.id)).toEqual(['b']);
    expect(badgeText(true, 3)).toBe('REC');
    expect(badgeText(false, 0)).toBe('');
    expect(badgeText(false, 2)).toBe('2');
    expect(badgeText(false, 120)).toBe('99+');
  });

  it('searches titles, tags and step titles', () => {
    const gs = [guide('a', { title: 'Create an invoice', tags: ['finance'] }), guide('b', { title: 'Invite a teammate', steps: [{ ...guide('x').steps[0]!, title: 'Click **Send invite**' }] })];
    const ms = buildSearch(gs.map(indexEntry));
    expect(searchGuides(ms, gs, 'invoice')).toEqual(['a']);
    expect(searchGuides(ms, gs, 'finance')).toEqual(['a']);
    expect(searchGuides(ms, gs, 'send')).toEqual(['b']);
    expect(searchGuides(ms, gs, '')).toEqual(['a', 'b']);
  });
});

describe('deep links', () => {
  const run = (href: string) => {
    let replaced: string | null = null;
    const loc = { href } as Location;
    const hist = { state: null, replaceState: (_s: unknown, _t: string, u: string) => void (replaced = u) } as unknown as History;
    return { id: takeDeepLink(loc, hist), replaced };
  };
  it('reads waymark= from the query or the hash and removes it with replaceState', () => {
    expect(run('https://app.test/orders?waymark=01ABC&x=1')).toEqual({ id: '01ABC', replaced: 'https://app.test/orders?x=1' });
    expect(run('https://app.test/#waymark=01ABC')).toEqual({ id: '01ABC', replaced: 'https://app.test/' });
    expect(run('https://app.test/#/orders/5?waymark=01ABC')).toEqual({ id: '01ABC', replaced: 'https://app.test/#/orders/5' });
    expect(run('https://app.test/#/orders/5?tab=2&waymark=01ABC')).toEqual({ id: '01ABC', replaced: 'https://app.test/#/orders/5?tab=2' });
    expect(run('https://app.test/orders')).toEqual({ id: null, replaced: null });
    expect(run('https://app.test/?waymark=%3Cscript%3E').id).toBeNull();
  });
});

describe('popup fallback', () => {
  it('sets a popup at runtime only when chrome.sidePanel is missing', () => {
    const calls: string[] = [];
    const action = { setPopup: (d: { popup: string }) => void calls.push(d.popup) };
    expect(setupPanelFallback({ sidePanel: {}, action })).toBe(false);
    expect(setupPanelFallback({ action })).toBe(true);
    expect(calls).toEqual(['sidepanel.html']);
  });
});

describe('deep links keep the rest of the query exactly', () => {
  it('does not re-encode other parameters', () => {
    let replaced = '';
    const hist = { state: null, replaceState: (_s: unknown, _t: string, u: string) => void (replaced = u) } as unknown as History;
    expect(takeDeepLink({ href: 'https://app.test/o?static&waymark=01ABC#/keep' } as Location, hist)).toBe('01ABC');
    expect(replaced).toBe('https://app.test/o?static#/keep');
    expect(takeDeepLink({ href: 'https://app.test/o?waymark=01ABC&a=b%20c' } as Location, hist)).toBe('01ABC');
    expect(replaced).toBe('https://app.test/o?a=b%20c');
  });
});

describe('M5 review: origins and the export review', () => {
  it('rejects packs whose guides claim wildcard or malformed origins', () => {
    for (const bad of ['https://*', 'https://*.com', 'foo', 'https://app.test/', 'chrome://settings', 'file:///etc']) {
      expect(parsePack(JSON.stringify(makePack([guide('a', { appOrigins: [bad] })]))).ok, bad).toBe(false);
    }
    expect(parsePack(JSON.stringify(makePack([guide('a', { appOrigins: [] })]))).ok).toBe(false);
    expect(parsePack(JSON.stringify(makePack([guide('a', { appOrigins: ['http://127.0.0.1:4173'], startUrl: 'http://127.0.0.1:4173/orders' })]))).ok).toBe(true);
  });

  it('shows every identifying string, and removing them all leaves none in the pack', () => {
    const g = guide('a', { matchUrls: [{ kind: 'prefix', value: '/clients/acme' }] });
    g.steps[0]!.target = {
      ...target,
      id: 'acme-corp-renewal',
      testId: { attr: 'data-testid', value: 'customer-JohnSmith' },
      guideId: 'acme-pay',
      cssPath: 'form[aria-label="Acme Payroll"] button#acme-corp-renewal',
    };
    const strings = packStrings([g]);
    const shown = strings.map((s) => s.value).join('\n');
    for (const secret of ['acme-corp-renewal', 'customer-JohnSmith', 'Acme Payroll', '/clients/acme', 'acme-pay']) expect(shown).toContain(secret);
    const [out] = applyRemovals([g], new Set(strings.filter((s) => s.removable).map((s) => s.key)));
    const json = JSON.stringify(out);
    for (const secret of ['acme-corp-renewal', 'JohnSmith', 'Acme Payroll', 'acme-pay', 'Ada Lovelace', 'ACME']) expect(json, secret).not.toContain(secret);
    // what remains is only what the review showed as not removable (pages and sites)
    expect(json).toContain('/clients/acme');
    expect(parsePack(JSON.stringify(makePack([out!])))).toMatchObject({ ok: true });
  });
});

describe('D48: pack ids and start URLs', () => {
  const ok = (g: Guide) => parsePack(JSON.stringify(makePack([g]))).ok;
  it('accepts only id-like guide, revision and step ids', () => {
    for (const bad of ['__proto__', 'a b', 'a|note', '../x', 'x:y', '', 'é']) {
      expect(ok(guide('a', { id: bad })), `guide ${bad}`).toBe(false);
      expect(ok(guide('a', { revisionId: bad })), `revision ${bad}`).toBe(false);
      expect(ok(guide('a', { forkedFrom: { guideId: bad, revisionId: 'r' } })), `forkedFrom ${bad}`).toBe(false);
      const g = guide('a');
      expect(ok({ ...g, steps: [{ ...g.steps[0]!, id: bad }] }), `step ${bad}`).toBe(false);
    }
    expect(ok(guide('01JABCDEF_x-1'))).toBe(true);
  });
  it('accepts only an http(s) start URL on one of the guide sites', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'https://evil.example/orders', 'chrome://settings', 'not a url', 'file:///etc/passwd']) {
      expect(ok(guide('a', { startUrl: bad })), bad).toBe(false);
    }
    expect(ok(guide('a', { startUrl: 'https://app.test/' }))).toBe(true);
  });
});
