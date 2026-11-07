/**
 * Issue #97 (D213): site profiles. Safe wildcards, caps and plain-word refusals, precedence by
 * guide source, URL options, packs (carried, dropped with a notice, keep / replace on import),
 * the library's profiles, and the service worker's handlers (own origin only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compilePattern, compileProfile, profileProblem, sameProfile, SiteProfileSchema, wildcardMatch, type SiteProfile } from '../../src/core/model/profile';
import { isGeneratedToken } from '../../src/core/fingerprint/filters';
import { profileFor, readProfileMap, urlOptionsFor, type Profiles } from '../../src/core/storage/profiles';
import { guideMatchesUrl } from '../../src/core/discovery/match';
import { makePack, packProfiles, parsePack } from '../../src/core/sharing/pack';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';
import { cleanCandidates } from '../../src/background/profiles';
import { exportJson, packedProfiles } from '../../src/entrypoints/sidepanel/ExportReview';
import type { ElementFingerprint, Guide } from '../../src/core/model/schema';

const prof = (origin: string, over: Partial<SiteProfile> = {}): SiteProfile => ({ origin, stableAttributes: [], ignorePatterns: [], hashRouting: false, keepQueryKeys: [], ...over });
const fp: ElementFingerprint = { instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', text: 'Save', cssPath: 'b', xpath: '/b', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };
const guide = (over: Partial<Guide> = {}): Guide => ({
  id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'Orders', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/', matchUrls: [{ kind: 'pattern', value: '/orders' }],
  steps: [{ id: 's1', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/orders' }, target: fp, advance: 'action' }],
  version: 1, source: 'local', updatedAt: '', ...over,
});

describe('ignore patterns are wildcards, never regular expressions (D213)', () => {
  it('matches whole tokens with * for any run of characters', () => {
    expect(wildcardMatch('gen-*', 'gen-123')).toBe(true);
    expect(wildcardMatch('gen-*', 'xgen-123')).toBe(false);
    expect(wildcardMatch('*-tmp', 'a-b-tmp')).toBe(true);
    expect(wildcardMatch('a*b*c', 'axxbyyc')).toBe(true);
    expect(wildcardMatch('a*b*c', 'axxbyy')).toBe(false);
    expect(wildcardMatch('a.b', 'axb')).toBe(false); // no regex meaning
    expect(wildcardMatch('(a+)+$', '(a+)+$')).toBe(true);
  });

  it('a pattern built to backtrack still finishes fast on a long token', () => {
    const token = 'a'.repeat(5000) + 'b';
    const t = performance.now();
    expect(wildcardMatch('*a*a*a*a*a*a*a*a*c', token)).toBe(false);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it('attr=glob applies to that attribute only; a bare glob to every token', () => {
    const idOnly = compilePattern('id=gen-*')!;
    expect(isGeneratedToken('gen-save', [idOnly], 'id')).toBe(true);
    expect(isGeneratedToken('gen-save', [idOnly], 'class')).toBe(false);
    expect(isGeneratedToken('gen-save', [compilePattern('gen-*')!], 'class')).toBe(true);
    expect(compilePattern('*')).toBeNull();
    expect(compilePattern('id=**')).toBeNull();
    expect(compilePattern('has space')).toBeNull();
    expect(compileProfile(prof('https://app.test', { ignorePatterns: ['id=gen-*', 'bad pattern'] })).ignorePatterns).toHaveLength(1);
  });

  it('refuses bad entries and too many with a plain message', () => {
    expect(profileProblem(prof('o', { stableAttributes: ['data-qa'] }))).toBeNull();
    expect(profileProblem(prof('o', { stableAttributes: ['Data QA'] }))).toMatch(/can’t be a stable attribute/);
    expect(profileProblem(prof('o', { ignorePatterns: ['*'] }))).toMatch(/not a pattern/);
    expect(profileProblem(prof('o', { stableAttributes: Array.from({ length: 11 }, (_, i) => `data-a${i}`) }))).toMatch(/At most 10/);
    expect(profileProblem(prof('o', { keepQueryKeys: ['a b'] }))).toMatch(/not a query key/);
    expect(SiteProfileSchema.safeParse(prof('o', { ignorePatterns: Array(21).fill('x*') })).success).toBe(false);
  });
});

describe('which profile applies (D213)', () => {
  const p: Profiles = { local: { 'https://app.test': prof('https://app.test', { hashRouting: false }) }, library: { 'https://app.test': prof('https://app.test', { hashRouting: true }), 'https://lib.test': prof('https://lib.test', { keepQueryKeys: ['tab'] }) } };
  it('team guides use the library’s, own guides their own; each falls back to the other', () => {
    expect(profileFor(p, 'https://app.test', 'library')!.hashRouting).toBe(true);
    expect(profileFor(p, 'https://app.test', 'local')!.hashRouting).toBe(false);
    expect(profileFor(p, 'https://lib.test', 'local')!.keepQueryKeys).toEqual(['tab']);
    expect(profileFor(p, 'https://none.test', 'local')).toBeNull();
  });

  it('URL options follow it: a hash-routed page matches the guide only with hash routing', () => {
    const url = 'https://app.test/index.html#/orders';
    expect(urlOptionsFor(p, url, 'library')).toEqual({ hashRouting: true });
    expect(guideMatchesUrl({ ...guide(), source: 'library' }, url, p)).toBe(true);
    expect(guideMatchesUrl({ ...guide(), source: 'local' }, url, p)).toBe(false);
  });

  it('stored maps are validated: a wrong origin key or a bad entry is dropped', () => {
    expect(readProfileMap({ 'https://a.test': prof('https://a.test'), 'https://b.test': prof('https://c.test'), 'https://d.test': { origin: 'https://d.test', stableAttributes: 'x' } })).toEqual({ 'https://a.test': prof('https://a.test') });
  });

  it('same profile ignores order', () => {
    expect(sameProfile(prof('o', { stableAttributes: ['a', 'b'] }), prof('o', { stableAttributes: ['b', 'a'] }))).toBe(true);
    expect(sameProfile(prof('o', { hashRouting: true }), prof('o'))).toBe(false);
  });
});

describe('packs carry profiles (D213)', () => {
  it('makePack carries the profiles of the guides’ sites only, and never an empty one', () => {
    const pack = makePack([guide()], new Date(0), [prof('https://app.test', { stableAttributes: ['data-x'] }), prof('https://other.test', { hashRouting: true }), prof('https://app.test')]);
    expect(pack.profiles).toEqual([prof('https://app.test', { stableAttributes: ['data-x'] })]);
    expect(makePack([guide()], new Date(0)).profiles).toBeUndefined();
  });

  it('parsePack keeps good profiles and drops bad ones with a count; the guides import anyway', () => {
    const pack = { ...makePack([guide()]), profiles: [prof('https://app.test', { stableAttributes: ['data-x'] }), prof('https://app.test', { hashRouting: true }), prof('https://other.test'), { origin: 'https://app.test', ignorePatterns: ['*'] }, 'junk'] };
    const r = parsePack(JSON.stringify(pack));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.guides).toHaveLength(1);
    expect(r.profiles).toEqual([prof('https://app.test', { stableAttributes: ['data-x'] })]);
    expect(r.droppedProfiles).toBe(4);
    expect(packProfiles({ guides: [guide()], profiles: undefined })).toEqual({ profiles: [], dropped: 0 });
  });

  it('the export review’s file carries them unless removed there', () => {
    const own = prof('https://app.test', { stableAttributes: ['data-x'] });
    const all: Profiles = { local: { 'https://app.test': own }, library: {} };
    expect(packedProfiles([guide()], all, new Set())).toEqual([own]);
    expect(packedProfiles([guide()], all, new Set(['profile:https://app.test']))).toEqual([]);
    expect(JSON.parse(exportJson([guide()], new Set(), all)).profiles).toEqual([own]);
  });
});

describe('messages and the page’s answers (D213)', () => {
  it('profile.get from content only; the panel messages from extension pages only; bounded', () => {
    expect(CONTENT_ALLOWED.has('profile.get')).toBe(true);
    for (const t of ['profile.site.get', 'profile.site.set', 'profile.candidates', 'profile.testAll'] as const) {
      expect(EXTENSION_ALLOWED.has(t)).toBe(true);
      expect(CONTENT_ALLOWED.has(t)).toBe(false);
    }
    const panel = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html', origin: 'chrome-extension://ext' };
    expect(parseMessage({ type: 'profile.site.set', payload: { origin: 'https://app.test', profile: prof('https://app.test', { stableAttributes: ['BAD NAME'] }) } }, panel, 'ext').ok).toBe(false);
  });

  it('candidates from the page are cleaned and capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ attr: `data-a${i}`, elements: 3, unique: true, samples: ['x'.repeat(200), 'b', 'c', 'd'] }));
    const out = cleanCandidates([{ attr: 'BAD', elements: 2 }, { attr: 'data-ok', elements: 'x' }, ...many]);
    expect(out).toHaveLength(28); // the first 30 entries, two of them bad
    expect(out[0]!.samples).toHaveLength(3);
    expect(out[0]!.samples[0]).toHaveLength(80);
    expect(cleanCandidates('nope')).toEqual([]);
  });
});

// ---------- service worker ----------

let local: Record<string, unknown>;
let session: Record<string, unknown>;
function area(store: () => Record<string, unknown>) {
  return {
    get: vi.fn(async (k?: string | string[] | null) => {
      const s = store();
      if (k == null) return structuredClone(s);
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in s).map((x) => [x, structuredClone(s[x])]));
    }),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store(), structuredClone(o))),
    remove: vi.fn(async (k: string | string[]) => {
      for (const x of Array.isArray(k) ? k : [k]) delete store()[x];
    }),
  };
}
beforeEach(() => {
  vi.resetModules();
  local = { 'guides:index': [] };
  session = {};
  vi.stubGlobal('chrome', {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener() {} } },
    tabs: { get: vi.fn(async (id: number) => ({ id, url: 'https://app.test/', active: true, windowId: 1 })), query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext/${p}` },
    permissions: { getAll: vi.fn(async () => ({ origins: [] })), contains: vi.fn(async () => true) },
    tts: { stop: vi.fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());

type H = (p: unknown, c: unknown) => Promise<unknown>;
const content = (origin: string) => ({ tabId: 7, frameId: 0, sender: { id: 'ext', tab: { id: 7, url: 'https://app.test/' }, url: `${origin}/`, origin } }) as never;
async function handlers() {
  const { profileHandlers } = await import('../../src/background/profiles');
  const { discoveryHandlers } = await import('../../src/background/discovery');
  return { ...profileHandlers, ...discoveryHandlers } as unknown as Record<string, H>;
}

describe('the service worker (D213)', () => {
  it('a frame gets its own origin’s profile only; a run of a team guide gets the library’s', async () => {
    local['siteProfiles'] = { 'https://app.test': prof('https://app.test', { stableAttributes: ['data-own'] }), 'https://partner.test': prof('https://partner.test', { stableAttributes: ['data-partner'] }) };
    local['libraryProfiles'] = { 'https://app.test': prof('https://app.test', { stableAttributes: ['data-team'] }) };
    const h = await handlers();
    expect(((await h['profile.get']!({ purpose: 'record' }, content('https://app.test'))) as { profile: SiteProfile }).profile.stableAttributes).toEqual(['data-own']);
    expect(((await h['profile.get']!({ purpose: 'record' }, content('https://partner.test'))) as { profile: SiteProfile }).profile.stableAttributes).toEqual(['data-partner']);
    expect(((await h['profile.get']!({ purpose: 'run' }, content('https://elsewhere.test'))) as { profile: unknown }).profile).toBeNull();
    session['run:7'] = { guideSnapshot: { source: 'library' } };
    expect(((await h['profile.get']!({ purpose: 'run' }, content('https://app.test'))) as { profile: SiteProfile }).profile.stableAttributes).toEqual(['data-team']);
  });

  it('saves the own profile with checks; an empty one removes it', async () => {
    const h = await handlers();
    expect(await h['profile.site.set']!({ origin: 'https://app.test', profile: prof('https://other.test') }, {})).toMatchObject({ ok: false });
    expect(await h['profile.site.set']!({ origin: 'chrome://settings', profile: null }, {})).toMatchObject({ ok: false });
    expect(await h['profile.site.set']!({ origin: 'https://app.test', profile: prof('https://app.test', { ignorePatterns: ['id=gen-*'] }) }, {})).toEqual({ ok: true });
    expect((local['siteProfiles'] as Record<string, SiteProfile>)['https://app.test']!.ignorePatterns).toEqual(['id=gen-*']);
    expect(await h['profile.site.get']!({ origin: 'https://app.test' }, {})).toMatchObject({ local: { ignorePatterns: ['id=gen-*'] }, library: null });
    await h['profile.site.set']!({ origin: 'https://app.test', profile: prof('https://app.test') }, {});
    expect(local['siteProfiles']).toEqual({});
  });

  it('import: a new site’s profile is added; one that differs is kept unless replaced; bad ones are counted', async () => {
    local['siteProfiles'] = { 'https://app.test': prof('https://app.test', { stableAttributes: ['data-own'] }) };
    const other = guide({ id: 'g2', appOrigins: ['https://new.test'], startUrl: 'https://new.test/' });
    const text = JSON.stringify({ ...makePack([guide(), other]), profiles: [prof('https://app.test', { stableAttributes: ['data-file'] }), prof('https://new.test', { hashRouting: true }), { origin: 'https://new.test', stableAttributes: ['BAD'] }] });
    const h = await handlers();
    const check = (await h['pack.check']!({ text }, {})) as { profiles: { origin: string; status: string }[]; droppedProfiles: number };
    expect(check.profiles).toEqual([
      { origin: 'https://app.test', status: 'differs' },
      { origin: 'https://new.test', status: 'new' },
    ]);
    expect(check.droppedProfiles).toBe(1);
    const r = (await h['pack.import']!({ text, choices: {} }, {})) as { profiles: number; droppedProfiles: number; imported: number };
    expect(r).toMatchObject({ imported: 2, profiles: 1, droppedProfiles: 1 });
    const map = local['siteProfiles'] as Record<string, SiteProfile>;
    expect(map['https://app.test']!.stableAttributes).toEqual(['data-own']);
    expect(map['https://new.test']!.hashRouting).toBe(true);
    await h['pack.import']!({ text, choices: {}, profileChoices: { 'https://app.test': 'replace' } }, {});
    expect((local['siteProfiles'] as Record<string, SiteProfile>)['https://app.test']!.stableAttributes).toEqual(['data-file']);
  });
});

// Fixes from the independent review (D213). Each test fails on the first version.
describe('review fixes (D213)', () => {
  it('a stable attribute must be a data- attribute (type, role or class would let the fast path take any shared value)', () => {
    for (const bad of ['type', 'role', 'class', 'href', 'aria-label', 'data-waymark-x', 'data-guide-id']) expect(profileProblem(prof('o', { stableAttributes: [bad] })), bad).toMatch(/can’t be a stable attribute/);
    expect(profileProblem(prof('o', { stableAttributes: ['data-automation-id'] }))).toBeNull();
    expect(SiteProfileSchema.safeParse(prof('o', { stableAttributes: ['type'] })).success).toBe(false);
  });

  it('ignore patterns take printable characters only', () => {
    expect(compilePattern('gen-\u0001*')).toBeNull();
    expect(compilePattern('gen-é*')).toBeNull();
    expect(compilePattern('id=gen-*')).not.toBeNull();
  });

  it('a note step recorded on a hash-routed page gets the page rule the player reads', async () => {
    const { noteStep, startRecording } = await import('../../src/core/recorder/session');
    const st = startRecording('T', 1, 'https://app.test/', Date.now(), { hashRouting: true });
    expect(noteStep(st, 'Note', undefined, 'https://app.test/#/orders/5', { hashRouting: true })!.url).toEqual({ kind: 'pattern', value: '/orders/:id' });
  });

  it('a change of a kept query key is a navigation; other query changes are not', async () => {
    const { navigationStep, startRecording, urlKey } = await import('../../src/core/recorder/session');
    const { routedPath } = await import('../../src/core/url/url');
    const st = startRecording('T', 1, 'https://app.test/report?tab=a', 0, { keepQueryKeys: ['tab'] });
    st.lastActionAt = 0;
    // As stored: the previous URL with its query hashed, and the previous page as its rule reads it.
    const nav = (prev: string, url: string) => navigationStep(st, { url, prevUrl: urlKey(prev), prevRoute: routedPath(new URL(prev), { keepQueryKeys: ['tab'] }), now: 100_000 }, { keepQueryKeys: ['tab'] });
    expect(nav('https://app.test/report?tab=a', 'https://app.test/report?tab=b')?.url).toEqual({ kind: 'pattern', value: '/report?tab=b' });
    expect(nav('https://app.test/report?tab=a&x=1', 'https://app.test/report?tab=a&x=2')).toBeNull();
  });

  it('a pack with more than 50 profiles still imports: the first 50 are kept, the rest counted as dropped', () => {
    const sites = Array.from({ length: 60 }, (_, i) => `https://s${i}.test`);
    const gs = sites.map((o, i) => guide({ id: `g${i}`, appOrigins: [o], startUrl: `${o}/` }));
    const pack = { ...makePack(gs), profiles: sites.map((o) => prof(o, { hashRouting: true })) };
    const r = parsePack(JSON.stringify(pack));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profiles).toHaveLength(50);
    expect(r.droppedProfiles).toBe(10);
    expect(makePack(gs, new Date(0), sites.map((o) => prof(o, { hashRouting: true }))).profiles).toHaveLength(50);
  });

  it('an empty profile in a pack is not stored (it would hide another store’s)', () => {
    expect(packProfiles({ guides: [guide()], profiles: [prof('https://app.test')] })).toEqual({ profiles: [], dropped: 0 });
  });

  it('the export carries the profile a team guide plays with (the library’s), and own guides’ own', () => {
    const lib = prof('https://app.test', { hashRouting: true });
    const own = prof('https://app.test', { stableAttributes: ['data-own'] });
    expect(packedProfiles([guide({ source: 'library' })], { local: {}, library: { 'https://app.test': lib } }, new Set())).toEqual([lib]);
    expect(packedProfiles([guide({ source: 'library' })], { local: { 'https://app.test': own }, library: { 'https://app.test': lib } }, new Set())).toEqual([lib]);
    expect(packedProfiles([guide()], { local: { 'https://app.test': own }, library: { 'https://app.test': lib } }, new Set())).toEqual([own]);
  });
});

describe('review fixes in the service worker (D213)', () => {
  it('import: a new site’s profile can be skipped; profiles over the 200-site cap are counted as dropped', async () => {
    const h = await handlers();
    const text = JSON.stringify({ ...makePack([guide()]), profiles: [prof('https://app.test', { hashRouting: true })] });
    const r = (await h['pack.import']!({ text, choices: {}, profileChoices: { 'https://app.test': 'keep' } }, {})) as { profiles: number };
    expect(r.profiles).toBe(0);
    expect(local['siteProfiles']).toBeUndefined();
    local['siteProfiles'] = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`https://s${i}.test`, prof(`https://s${i}.test`, { hashRouting: true })]));
    const capped = (await h['pack.import']!({ text, choices: {} }, {})) as { profiles: number; droppedProfiles: number };
    expect(capped).toMatchObject({ profiles: 0, droppedProfiles: 1 });
  });

  it('Test all steps: the same steps before and after (either profile’s URL options); off the page under this one; refused on another site', async () => {
    const hashGuide = guide({ id: 'gh', matchUrls: [{ kind: 'pattern', value: '/orders' }] });
    local['guide:gh'] = hashGuide;
    local['guides:index'] = [{ id: 'gh', revisionId: 'r1', title: 'Orders', tags: [], startUrl: '', updatedAt: '', appOrigins: ['https://app.test'], matchUrls: [], source: 'local', steps: 1, stepTitles: '' }];
    (chrome.tabs.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => ({ id, url: 'https://app.test/index.html#/orders' }));
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ found: true, score: 90, margin: 50, matched: ['testId'], fragile: false }));
    session['frames:7'] = {};
    const h = await handlers();
    // Before saving hash routing: with today's options the step is not on this page; with the new one it is.
    const before = (await h['profile.testAll']!({ tabId: 7, origin: 'https://app.test', compare: prof('https://app.test', { hashRouting: true }) }, {})) as { results: { result: string }[] };
    expect(before.results.map((x) => x.result)).toEqual(['off-page']);
    local['siteProfiles'] = { 'https://app.test': prof('https://app.test', { hashRouting: true }) };
    const after = (await h['profile.testAll']!({ tabId: 7, origin: 'https://app.test', compare: null }, {})) as { results: { result: string }[] };
    expect(after.results.map((x) => x.result)).toEqual(['found']);
    await expect(h['profile.testAll']!({ tabId: 7, origin: 'https://other.test', compare: null }, {})).rejects.toThrow(/no longer shows that site/);
  });
});
