/**
 * Performance harness (pnpm bench; not part of pnpm check, because timings on shared CI
 * runners are noisy). 500 guides of 50 steps through the service worker paths.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeGuides, memArea } from './fixtures';

const rows: [string, number, string][] = [];
async function time<T>(label: string, fn: () => Promise<T> | T, runs = 5): Promise<T> {
  let out!: T;
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  rows.push([label, ms[Math.floor(ms.length / 2)]!, `min ${ms[0]!.toFixed(1)} max ${ms[ms.length - 1]!.toFixed(1)}`]);
  return out;
}

const guides = makeGuides(500, 50);
let local: ReturnType<typeof memArea>;
const badge = vi.fn(async () => undefined);

beforeAll(async () => {
  local = memArea();
  vi.stubGlobal('chrome', {
    storage: { local, session: memArea() },
    tabs: { query: async () => Array.from({ length: 30 }, (_, i) => ({ id: i + 1, url: `https://app${i % 20}.example.com/app/section-${i % 9}/12345/edit` })), get: async (id: number) => ({ id, url: 'https://app3.example.com/app/section-3' }) },
    action: { setBadgeText: badge, setBadgeBackgroundColor: badge },
    permissions: { contains: async () => true },
  });
  const { writeGuides } = await import('../../src/core/storage/guides');
  await writeGuides(guides, []);
});
afterAll(() => vi.unstubAllGlobals());

function report(): void {
  const bytes = JSON.stringify(guides).length;
  process.stdout.write(`\n500 guides x 50 steps = ${(bytes / 1e6).toFixed(1)} MB JSON (${(bytes / 25000).toFixed(0)} B/step)\n`);
  process.stdout.write(rows.map(([l, m, r]) => `${l.padEnd(52)} ${m.toFixed(1).padStart(8)} ms  (${r})`).join('\n') + '\n\n');
}

describe('service worker paths with 500 guides x 50 steps', () => {
  it('measures', async () => {
    const { listGuides, allGuides, getGuides } = await import('../../src/core/storage/guides');
    const { guidesForUrl } = await import('../../src/core/discovery/match');
    const { updateBadge, updateAllBadges, discoveryHandlers } = await import('../../src/background/discovery');
    const { buildSearch, searchGuides } = await import('../../src/core/discovery/search');
    const { makePack, parsePack, planImport } = await import('../../src/core/sharing/pack');

    const index = await time('guide.list (index read)', () => listGuides());
    await time('For this page: match one URL over the index', () => guidesForUrl(index, 'https://app3.example.com/app/section-3/12345/edit'));
    await time('badge: updateBadge (one tab)', () => updateBadge(1, 'https://app3.example.com/app/section-3/12345/edit'));
    await time('badge: updateAllBadges (30 tabs)', () => updateAllBadges(), 3);
    await time('guide.forPage (content script)', () => discoveryHandlers['guide.forPage']!({ url: '' }, { kind: 'content', sender: { origin: 'https://app3.example.com', tab: { id: 1, url: 'https://app3.example.com/app/section-3/1/edit' } }, tabId: 1, frameId: 0 } as never), 5);
    const all = await time('index rebuild: read + validate every guide', () => allGuides(), 3);
    const ms = await time('side panel: build MiniSearch over the index', () => buildSearch(index), 3);
    await time('side panel: search "billing sett"', () => searchGuides(ms, index, 'billing sett'));
    await time('guide.many: 10 full guides for export', () => getGuides(index.slice(0, 10).map((g) => g.id)));
    process.stdout.write(`index ${(JSON.stringify(index).length / 1e6).toFixed(2)} MB\n`);
    const pack = makePack(guides.slice(0, 90)); // about 5 MB: the pack cap
    const text = JSON.stringify(pack);
    await time(`pack.check parse (${(text.length / 1e6).toFixed(1)} MB, ${pack.guides.length} guides)`, () => parsePack(text), 3);
    await time('planImport against the index', () => planImport(index, pack, {}, 'local'), 3);
    expect(all).toHaveLength(500);
    const { writeGuide } = await import('../../src/core/storage/guides');
    await time('editor save: writeGuide (one guide + the index)', () => writeGuide({ ...all[3]!, title: 'Renamed' }), 5);

    // Play results (D211), worst case: every step of every guide played 20 times.
    const { recordResult, statsKey, withCount, STATS_INDEX_KEY } = await import('../../src/core/stats/plays');
    let statBytes = 0;
    let counts: Record<string, number> = {};
    for (const g of all) {
      let st = {};
      for (const step of g.steps) for (let i = 0; i < 20; i++) st = recordResult(st, step, `t${i}`, [29900000 + i, i % 7 ? 1 : 0, 88, 40, i % 3]);
      statBytes += JSON.stringify(st).length;
      counts = withCount(counts, g.id, st);
      await local.set({ [statsKey(g.id)]: st, [STATS_INDEX_KEY]: counts });
    }
    process.stdout.write(`play results, every step played 20 times: ${(statBytes / 1e6).toFixed(1)} MB\n`);
    const { statsHandlers } = await import('../../src/background/stats');
    const ids = index.map((g) => g.id);
    await time('library: stats.summary (500 guides)', () => statsHandlers['stats.summary']!({ ids }, {} as never), 3);
    await time('editor: stats.guide (one guide)', () => statsHandlers['stats.guide']!({ guideId: ids[3]! }, {} as never), 5);
    await time('editor save with results: writeGuide', () => writeGuide({ ...all[3]!, title: 'Renamed again' }), 5);
    report();
    expect(index).toHaveLength(500);
  }, 300_000);
});
