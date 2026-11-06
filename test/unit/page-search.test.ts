/**
 * Issue #69 (D170–D172): search among the guides for one page. The matcher the ? menu runs in the
 * content script, the threshold, the chips, the caps on `guide.forPage`, and that a content
 * script only ever gets its own origin's guides.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fold,
  forPageEntry,
  matchPageGuides,
  MAX_FOR_PAGE,
  MAX_FOR_PAGE_TAG,
  MAX_FOR_PAGE_TAGS,
  PAGE_SEARCH_FROM,
  pageTagChips,
  showsPageSearch,
  words,
} from '../../src/core/discovery/page-search';
import { buildSearch, searchGuides, searchPage } from '../../src/core/discovery/search';
import { ForPageResponseSchema } from '../../src/core/messaging/protocol';
import { memArea } from '../perf/fixtures';

const g = (id: string, title: string, tags: string[] = []) => ({ id, title, tags });
const GUIDES = [
  g('a', 'Send an invoice', ['Billing', 'ACME']),
  g('b', 'Crème brûlée order', ['Kitchen']),
  g('c', 'Ändern Sie die Straße', ['Adresse']),
  g('d', 'Refund a payment', ['billing']),
  g('e', 'Invite a teammate', ['Team']),
  g('f', 'Export the month-end report', ['Reports', 'Month end']),
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe('page search matching (D170)', () => {
  it('starts from 6 guides', () => {
    expect(PAGE_SEARCH_FROM).toBe(6);
    expect(showsPageSearch(5)).toBe(false);
    expect(showsPageSearch(6)).toBe(true);
  });
  it('folds case and accents', () => {
    expect(fold('Crème BRÛLÉE')).toBe('creme brulee');
    expect(fold('Straße Øre Łódź')).toBe('strasse ore lodz');
    expect(words('Month-end: REPORT!')).toEqual(['month', 'end', 'report']);
  });
  it('matches title word prefixes, case- and accent-insensitively', () => {
    expect(ids(matchPageGuides(GUIDES, 'inv'))).toEqual(['a', 'e']);
    expect(ids(matchPageGuides(GUIDES, 'CREME brul'))).toEqual(['b']);
    expect(ids(matchPageGuides(GUIDES, 'strasse'))).toEqual(['c']);
    expect(ids(matchPageGuides(GUIDES, 'andern'))).toEqual(['c']);
    expect(ids(matchPageGuides(GUIDES, 'ändern'))).toEqual(['c']);
  });
  it('matches tags, and every typed word must match (title or tag)', () => {
    expect(ids(matchPageGuides(GUIDES, 'billing'))).toEqual(['a', 'd']);
    expect(ids(matchPageGuides(GUIDES, 'invoice acme'))).toEqual(['a']);
    expect(ids(matchPageGuides(GUIDES, 'month end'))).toEqual(['f']);
    expect(ids(matchPageGuides(GUIDES, 'invoice kitchen'))).toEqual([]);
    // Inside a word is not a match: "voice" is not the start of a word.
    expect(ids(matchPageGuides(GUIDES, 'voice'))).toEqual([]);
  });
  it('an empty or blank query keeps every guide, in order', () => {
    expect(ids(matchPageGuides(GUIDES, ''))).toEqual(ids(GUIDES));
    expect(ids(matchPageGuides(GUIDES, '  - '))).toEqual(ids(GUIDES));
  });
  it('selected tags: a guide must carry all of them, compared without case or accents', () => {
    expect(ids(matchPageGuides(GUIDES, '', ['BILLING']))).toEqual(['a', 'd']);
    expect(ids(matchPageGuides(GUIDES, '', ['billing', 'acme']))).toEqual(['a']);
    expect(ids(matchPageGuides(GUIDES, 'refund', ['billing']))).toEqual(['d']);
    expect(ids(matchPageGuides(GUIDES, '', ['adresse', 'billing']))).toEqual([]);
    expect(ids(matchPageGuides([g('x', 'X', ['Café'])], '', ['cafe']))).toEqual(['x']);
  });
  it('tag chips: at most 3, the most common for this page, merged without case or accents', () => {
    const many = [...GUIDES, g('g', 'Close the books', ['Billing', 'Reports']), g('h', 'Chase a reminder', ['Rémind']), g('i', 'Remind', ['remind'])];
    expect(pageTagChips(many)).toEqual(['Billing', 'Rémind', 'Reports']);
    expect(pageTagChips(many).length).toBeLessThanOrEqual(3);
    // A tag every guide carries would filter nothing.
    expect(pageTagChips([g('1', 'A', ['all', 'x']), g('2', 'B', ['All'])])).toEqual(['x']);
    expect(pageTagChips([g('1', 'A'), g('2', 'B')])).toEqual([]);
  });
});

describe('guide.forPage entries and caps (D171)', () => {
  it('caps tags per guide and their length, drops blanks and duplicates', () => {
    const e = forPageEntry(g('a', 'T'.repeat(900), ['  ', 'One', 'one', 'ÖNE', 'x'.repeat(200), ...Array.from({ length: 30 }, (_, i) => `t${i}`)]));
    expect(e.title.length).toBe(500);
    expect(e.tags.length).toBe(MAX_FOR_PAGE_TAGS);
    expect(e.tags[0]).toBe('One');
    expect(e.tags[1]).toBe('x'.repeat(MAX_FOR_PAGE_TAG));
    expect(ForPageResponseSchema.safeParse({ guides: [e], launcher: true }).success).toBe(true);
  });
  it('the schema refuses more guides, tags or longer tags than the caps', () => {
    const ok = { id: 'a', title: 'A', tags: ['x'] };
    expect(ForPageResponseSchema.safeParse({ guides: Array(MAX_FOR_PAGE).fill(ok), launcher: false }).success).toBe(true);
    expect(ForPageResponseSchema.safeParse({ guides: Array(MAX_FOR_PAGE + 1).fill(ok), launcher: false }).success).toBe(false);
    expect(ForPageResponseSchema.safeParse({ guides: [{ ...ok, tags: Array(MAX_FOR_PAGE_TAGS + 1).fill('x') }], launcher: false }).success).toBe(false);
    expect(ForPageResponseSchema.safeParse({ guides: [{ ...ok, tags: ['x'.repeat(MAX_FOR_PAGE_TAG + 1)] }], launcher: false }).success).toBe(false);
    expect(ForPageResponseSchema.safeParse({ guides: [{ ...ok, tags: [''] }], launcher: false }).success).toBe(false);
  });
});

describe('guide.forPage sends only the sender origin’s guides, with tags (D171)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const entry = (id: string, origin: string, tags: string[]) => ({
    id,
    revisionId: 'R',
    title: `Guide ${id}`,
    description: 'secret description',
    tags,
    startUrl: `${origin}/app`,
    updatedAt: '2026-01-01T00:00:00Z',
    appOrigins: [origin],
    matchUrls: [{ kind: 'prefix', value: '/app' }],
    source: 'local',
    steps: 2,
    stepTitles: 'Secret step one\nSecret step two',
  });
  const setup = async (index: unknown[]) => {
    const local = memArea();
    await local.set({ 'guides:index': index });
    vi.stubGlobal('chrome', { storage: { local, session: memArea() } });
    return (await import('../../src/background/discovery')).discoveryHandlers['guide.forPage']!;
  };
  const ctx = (url: string, frameId = 0) => ({ kind: 'content', sender: { origin: new URL(url).origin, tab: { id: 1, url } }, tabId: 1, frameId }) as never;

  // The URL rules already check the origin; the handler's own origin filter is defence in depth.
  it('lists its own origin’s guides with id, title and tags only', async () => {
    const handler = await setup([
      entry('mine', 'https://app.example.com', ['Billing']),
      entry('other', 'https://evil.example.com', ['Secret']),
      // Same path on another origin, and a guide whose rule matches but whose origin differs.
      { ...entry('spoof', 'https://evil.example.com', []), matchUrls: [{ kind: 'prefix', value: '/app' }] },
    ]);
    const r = (await handler({ url: '' }, ctx('https://app.example.com/app/orders'))) as { guides: unknown[] };
    expect(r.guides).toEqual([{ id: 'mine', title: 'Guide mine', tags: ['Billing'] }]);
  });
  it('subframes get nothing', async () => {
    const handler = await setup([entry('mine', 'https://app.example.com', ['Billing'])]);
    const r = (await handler({ url: '' }, ctx('https://app.example.com/app/orders', 3))) as { guides: unknown[] };
    expect(r.guides).toEqual([]);
  });
  it('caps the number of guides and tags it sends', async () => {
    const handler = await setup(Array.from({ length: MAX_FOR_PAGE + 20 }, (_, i) => entry(`g${i}`, 'https://app.example.com', Array.from({ length: 20 }, (_, j) => `tag${j}`))));
    const r = (await handler({ url: '' }, ctx('https://app.example.com/app'))) as { guides: { tags: string[] }[] };
    expect(r.guides.length).toBe(MAX_FOR_PAGE);
    expect(r.guides.every((x) => x.tags.length === MAX_FOR_PAGE_TAGS)).toBe(true);
  });
});

describe('panel search is accent-insensitive too (D172)', () => {
  // Words fuzzy matching (0.2) can't reach: short ones, several accents, ß.
  it('finds accented titles and tags without accents, and the other way round', () => {
    const lib = [
      { id: '1', title: 'Café menu', tags: ['Résumé'], stepTitles: '' },
      { id: '2', title: 'Straße wechseln', tags: [], stepTitles: '' },
      { id: '3', title: 'Plain order', tags: [], stepTitles: '' },
    ];
    const ms = buildSearch(lib);
    expect(searchGuides(ms, lib, 'cafe')).toEqual(['1']);
    expect(searchGuides(ms, lib, 'resume')).toEqual(['1']);
    expect(searchGuides(ms, lib, 'strasse')).toEqual(['2']);
    expect(searchGuides(ms, lib, 'CAFÉ')).toEqual(['1']);
  });
});

describe('the panel’s "For this page" filter agrees with the ? menu (D170 review)', () => {
  const page = [
    { id: 'a', title: 'Send an invoice', tags: ['Café'], stepTitles: '' },
    { id: 'b', title: 'Refund a payment', tags: ['Cafe'], stepTitles: '' },
    { id: 'c', title: 'Invite a teammate', tags: ['Team'], stepTitles: '' },
  ];
  const ms = buildSearch(page);
  it('every typed word must match, as in the menu', () => {
    expect(ids(searchPage(ms, page, 'invoice refund', []))).toEqual([]);
    expect(ids(searchPage(ms, page, 'invoice refund', []))).toEqual(ids(matchPageGuides(page, 'invoice refund')));
    expect(ids(searchPage(ms, page, 'send invoice', []))).toEqual(['a']);
  });
  it('a chip matches tags without case or accents, as the chips merge them', () => {
    expect(pageTagChips(page)).toContain('Café');
    expect(ids(searchPage(ms, page, '', ['Café']))).toEqual(['a', 'b']);
    expect(ids(searchPage(ms, page, '', ['Café']))).toEqual(ids(matchPageGuides(page, '', ['Café'])));
  });
  it('keeps the page’s guides only', () => {
    expect(ids(searchPage(ms, page.slice(0, 1), 'refund', []))).toEqual([]);
  });
});
