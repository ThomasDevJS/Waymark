/**
 * D49: with hundreds of guides, full guides are tens of MB. The side panel, the badge, pack
 * import and the library work from the guide index; only export reads full guides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGuides, memArea } from '../perf/fixtures';

let local: ReturnType<typeof memArea>;
let reads: (string | string[] | null)[];

beforeEach(async () => {
  local = memArea();
  reads = [];
  const get = local.get.bind(local);
  local.get = async (k) => {
    reads.push(k);
    return get(k);
  };
  vi.stubGlobal('chrome', {
    storage: { local, session: memArea() },
    tabs: { query: async () => Array.from({ length: 30 }, (_, i) => ({ id: i + 1, url: `https://app${i % 5}.example.com/app/section-1` })), get: async () => undefined },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    permissions: { contains: async () => true },
    alarms: { create: async () => undefined, clear: async () => undefined },
  });
  const { writeGuides } = await import('../../src/core/storage/guides');
  await writeGuides(makeGuides(20, 5, 5), []);
  reads = [];
});
afterEach(() => vi.unstubAllGlobals());

const fullReads = () => reads.filter((k) => k === null || [k].flat().some((x) => x.startsWith('guide:')));

describe('guide index reads (D49)', () => {
  it('side panel list, pack check and import read no full guides', async () => {
    const { discoveryHandlers } = await import('../../src/background/discovery');
    const { makePack } = await import('../../src/core/sharing/pack');
    const { listGuides } = await import('../../src/core/storage/guides');
    const ctx = {} as never;
    const list = await listGuides();
    expect(list[0]).toMatchObject({ revisionId: expect.any(String), tags: expect.any(Array), startUrl: expect.stringMatching(/^https:/), stepTitles: expect.stringContaining('Save changes') });
    const text = JSON.stringify(makePack(makeGuides(3, 2, 1).map((g) => ({ ...g, revisionId: g.revisionId.replace('R', 'Q') }))));
    await discoveryHandlers['pack.check']!({ text }, ctx);
    await discoveryHandlers['pack.import']!({ text, choices: {} }, ctx);
    expect(fullReads()).toEqual([]);
  });
  it('export reads only the chosen guides', async () => {
    const { discoveryHandlers } = await import('../../src/background/discovery');
    const { listGuides } = await import('../../src/core/storage/guides');
    const ids = (await listGuides()).slice(0, 2).map((g) => g.id);
    reads = [];
    const r = (await discoveryHandlers['guide.many']!({ ids }, {} as never)) as { guides: { id: string }[] };
    expect(r.guides.map((g) => g.id)).toEqual(ids);
    expect(reads).toHaveLength(1);
  });
  it('a badge pass over 30 tabs reads the index once', async () => {
    const { updateAllBadges } = await import('../../src/background/discovery');
    await updateAllBadges();
    expect(reads.filter((k) => k === 'guides:index')).toHaveLength(1);
  });
  it('an index from an older version is rebuilt on first read', async () => {
    const { listGuides } = await import('../../src/core/storage/guides');
    const ids = (await listGuides()).map((e) => e.id).sort();
    await local.set({ 'guides:index': [{ id: ids[0], title: 'A', updatedAt: '', appOrigins: ['https://a.test'], matchUrls: [], source: 'local', steps: 1 }] });
    const healed = await listGuides();
    expect(healed.map((e) => e.id).sort()).toEqual(ids);
    expect(healed.every((e) => e.revisionId && e.stepTitles && e.startUrl)).toBe(true);
  });
  it('keeps every step of a long guide searchable, within the caps', async () => {
    const { indexEntry, MAX_STEP_TITLES, MAX_INDEX_DESCRIPTION } = await import('../../src/core/storage/guides');
    const [g] = makeGuides(1, 200, 1);
    const long = { ...g!, description: 'd'.repeat(5000), steps: g!.steps.map((s, i) => ({ ...s, title: `Open the panel for step${i} ${'x'.repeat(300)}` })) };
    const e = indexEntry(long);
    expect(e.stepTitles).toContain('step199');
    expect(e.stepTitles.length).toBeLessThanOrEqual(MAX_STEP_TITLES);
    expect(e.description!.length).toBeLessThanOrEqual(MAX_INDEX_DESCRIPTION);
  });
  it('badges: a count on guide pages, REC on recording tabs, nothing without a URL', async () => {
    const texts = new Map<number, string>();
    (chrome as unknown as { action: { setBadgeText: (o: { tabId: number; text: string }) => Promise<void> } }).action.setBadgeText = async ({ tabId, text }) => void texts.set(tabId, text);
    (chrome as unknown as { tabs: { query: () => Promise<unknown[]> } }).tabs.query = async () => [
      { id: 1, url: 'https://app0.example.com/app/section-0/x' },
      { id: 2, url: 'https://app0.example.com/app/section-0/x' },
      { id: 3 },
      { id: 4, url: 'https://elsewhere.test/' },
    ];
    await (chrome.storage.session as unknown as { set: (o: object) => Promise<void> }).set({ recording: { tabIds: [2] } });
    const { updateAllBadges } = await import('../../src/background/discovery');
    await updateAllBadges();
    expect(Number(texts.get(1))).toBeGreaterThan(0);
    expect(texts.get(2)).toBe('REC');
    expect(texts.get(3)).toBe('');
    expect(texts.get(4)).toBe('');
  });
});
