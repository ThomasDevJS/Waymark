/**
 * PR A conveniences (D100–D102): undo for deleted guides and steps, duplicate step, completed
 * guides, "Start from step N", and tag filter chips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGuides, memArea } from '../perf/fixtures';
import { addToTrash, liveTrash, MAX_TRASH, RESTORE_GRACE_MS, trashItems, UNDO_MS } from '../../src/core/storage/trash';
import { parseTags, stepChoices, tagChips, withTags } from '../../src/core/discovery/tags';
import { duplicateStepIn, restoreStepIn } from '../../src/entrypoints/sidepanel/Editor';
import { EXTENSION_ALLOWED, CONTENT_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';
import { startRun } from '../../src/core/player/run';
import type { Step } from '../../src/core/model/schema';

const [g1, g2] = makeGuides(2, 3, 1) as [ReturnType<typeof makeGuides>[number], ReturnType<typeof makeGuides>[number]];

describe('trash (D100)', () => {
  it('keeps a deleted guide for the undo window, then drops it', () => {
    const t = addToTrash([], [g1], 1000);
    expect(liveTrash(t, 1000 + UNDO_MS)).toHaveLength(1);
    expect(liveTrash(t, 1000 + UNDO_MS + RESTORE_GRACE_MS + 1)).toHaveLength(0);
    expect(trashItems(t)).toEqual([{ id: g1.id, title: g1.title, deletedAt: 1000, undoUntil: 1000 + UNDO_MS }]);
  });
  it('drops junk and invalid guides, and is bounded', () => {
    expect(liveTrash('nope', 0)).toEqual([]);
    expect(liveTrash([{ deletedAt: 5, guide: { id: '__proto__' } }, null, { guide: g1 }], 5)).toEqual([]);
    let t = addToTrash([], [g1], 0);
    for (let i = 0; i < MAX_TRASH + 5; i++) t = addToTrash(t, [{ ...g2, id: `G${i}` }], 0);
    expect(t).toHaveLength(MAX_TRASH);
    // Deleting the same guide again keeps one entry.
    expect(addToTrash(addToTrash([], [g1], 0), [g1], 1).filter((e) => e.guide.id === g1.id)).toHaveLength(1);
  });
});

describe('guide delete and Undo through the service worker (D100)', () => {
  let local: ReturnType<typeof memArea>;
  beforeEach(async () => {
    local = memArea();
    vi.stubGlobal('chrome', {
      storage: { local, session: memArea() },
      tabs: { query: async () => [] },
      action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
    });
    const { writeGuides } = await import('../../src/core/storage/guides');
    await writeGuides([g1, g2], []);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('deletes at once and restores the same guide, even from another panel', async () => {
    const { discoveryHandlers: h } = await import('../../src/background/discovery');
    const { listGuides, getGuides } = await import('../../src/core/storage/guides');
    const r = await h['guide.delete']!({ id: g1.id }, {} as never);
    expect(r.ok).toBe(true);
    expect(r.undoUntil).toBeGreaterThan(Date.now());
    expect((await listGuides()).map((g) => g.id)).toEqual([g2.id]);
    // A panel opened later still sees the undo window, with titles only.
    const items = (await h['trash.list']!({}, {} as never)).items;
    expect(items).toEqual([expect.objectContaining({ id: g1.id, title: g1.title })]);
    expect(JSON.stringify(items)).not.toContain('steps');
    expect(await h['guide.restore']!({ id: g1.id }, {} as never)).toEqual({ ok: true });
    expect((await getGuides([g1.id]))[0]).toEqual(g1);
    expect((await h['trash.list']!({}, {} as never)).items).toEqual([]);
    // A second Undo has nothing to restore.
    expect((await h['guide.restore']!({ id: g1.id }, {} as never)).ok).toBe(false);
  });

  it('refuses after the window, and never overwrites a guide that came back meanwhile', async () => {
    const { discoveryHandlers: h } = await import('../../src/background/discovery');
    const { writeGuides, getGuides } = await import('../../src/core/storage/guides');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000);
    await h['guide.delete']!({ id: g1.id }, {} as never);
    vi.setSystemTime(10_000 + UNDO_MS + RESTORE_GRACE_MS + 1);
    expect((await h['trash.list']!({}, {} as never)).items).toEqual([]);
    expect(await h['guide.restore']!({ id: g1.id }, {} as never)).toMatchObject({ ok: false, error: expect.stringMatching(/too late/) });

    vi.setSystemTime(50_000);
    await h['guide.delete']!({ id: g2.id }, {} as never);
    const back = { ...g2, title: 'Imported again', revisionId: 'NEWREV' };
    await writeGuides([back], []);
    expect((await h['guide.restore']!({ id: g2.id }, {} as never)).ok).toBe(false);
    expect((await getGuides([g2.id]))[0]?.title).toBe('Imported again');
  });

  it('a missing guide deletes nothing and offers no Undo', async () => {
    const { discoveryHandlers: h } = await import('../../src/background/discovery');
    expect(await h['guide.delete']!({ id: 'NOPE' }, {} as never)).toEqual({ ok: true, undoUntil: null });
  });

  it('lists the last completion per guide, skipping junk (D101)', async () => {
    const { discoveryHandlers: h } = await import('../../src/background/discovery');
    await local.set({ completions: { [g1.id]: ['2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'], bad: 'x', empty: [] } });
    expect(await h['completions.list']!({}, {} as never)).toEqual({ completed: { [g1.id]: '2026-11-02T00:00:00Z' } });
  });
});

describe('editor step helpers (D100)', () => {
  const steps: Step[] = g1.steps;
  it('duplicates a step right after it with a new id', () => {
    const out = duplicateStepIn(steps, 1);
    expect(out).toHaveLength(steps.length + 1);
    expect(out[2]).toMatchObject({ ...steps[1], id: expect.any(String) });
    expect(out[2]!.id).not.toBe(steps[1]!.id);
    expect(out[2]!.target).not.toBe(steps[1]!.target); // a deep copy
    expect(duplicateStepIn(steps, 99)).toBe(steps);
  });
  it('puts a deleted step back at its place, once', () => {
    const without = steps.filter((_, i) => i !== 1);
    expect(restoreStepIn(without, steps[1]!, 1).map((s) => s.id)).toEqual(steps.map((s) => s.id));
    expect(restoreStepIn(steps, steps[1]!, 1)).toBe(steps);
    expect(restoreStepIn([], steps[2]!, 2).map((s) => s.id)).toEqual([steps[2]!.id]);
  });
});

describe('tags (D102)', () => {
  const e = (tags: string[]) => ({ tags });
  it('chips by count, merging case, ignoring blanks', () => {
    expect(tagChips([e(['Billing', 'hr']), e(['billing', ' ']), e(['Onboarding', 'billing'])])).toEqual([
      { tag: 'Billing', count: 3 },
      { tag: 'hr', count: 1 },
      { tag: 'Onboarding', count: 1 },
    ]);
  });
  it('filters to guides with every selected tag', () => {
    const list = [e(['a', 'b']), e(['A']), e(['b'])];
    expect(withTags(list, [])).toBe(list);
    expect(withTags(list, ['a'])).toHaveLength(2);
    expect(withTags(list, ['a', 'B'])).toEqual([list[0]]);
  });
  it('parses typed tags within the schema limits', () => {
    expect(parseTags(' billing, Onboarding ,, billing,BILLING ')).toEqual(['billing', 'Onboarding']);
    expect(parseTags('x'.repeat(150))[0]).toHaveLength(100);
    expect(parseTags(Array.from({ length: 80 }, (_, i) => `t${i}`).join(','))).toHaveLength(50);
  });
  it('step choices come from the index, with numbers when titles are cut short', () => {
    expect(stepChoices({ steps: 3, stepTitles: 'Open\nClick **Save**' })).toEqual([
      { index: 0, label: '1. Open' },
      { index: 1, label: '2. Click **Save**' },
      { index: 2, label: '3. Step 3' },
    ]);
  });
});

describe('messages (D100, D101)', () => {
  const ext = { id: 'x', url: 'chrome-extension://x/sidepanel.html' };
  const content = { id: 'x', url: 'https://a.test/', tab: { id: 1 } };
  it('the new library messages are for extension pages only', () => {
    for (const t of ['guide.restore', 'trash.list', 'completions.list'] as const) {
      expect(EXTENSION_ALLOWED.has(t)).toBe(true);
      expect(CONTENT_ALLOWED.has(t)).toBe(false);
      expect(parseMessage({ type: t, payload: t === 'guide.restore' ? { id: 'a' } : {} }, content, 'x')).toMatchObject({ ok: false });
    }
  });
  it('run.start takes a bounded step index', () => {
    expect(parseMessage({ type: 'run.start', payload: { tabId: 1, guideId: 'g', stepIndex: 2 } }, ext, 'x').ok).toBe(true);
    expect(parseMessage({ type: 'run.start', payload: { tabId: 1, guideId: 'g', stepIndex: -1 } }, ext, 'x').ok).toBe(false);
    expect(parseMessage({ type: 'run.start', payload: { tabId: 1, guideId: 'g', stepIndex: 1.5 } }, ext, 'x').ok).toBe(false);
    expect(parseMessage({ type: 'run.start', payload: { tabId: 1, guideId: 'g', stepIndex: 500 } }, ext, 'x').ok).toBe(false);
  });
});

describe('Start from step N (D101)', () => {
  let session: ReturnType<typeof memArea>;
  beforeEach(async () => {
    session = memArea();
    const local = memArea();
    vi.stubGlobal('chrome', {
      storage: { local, session },
      tabs: { get: async () => ({ id: 7, url: tabUrl, active: false, windowId: 1 }), sendMessage: async () => undefined },
      permissions: { contains: async () => true },
      tts: undefined,
    });
    const { writeGuides } = await import('../../src/core/storage/guides');
    await writeGuides([g1], []);
  });
  afterEach(() => vi.unstubAllGlobals());
  let tabUrl = '';

  it('starts at the chosen step when the tab is on its page, else names that page', async () => {
    const { startRunInTab } = await import('../../src/background/runs');
    const step2 = g1.steps[2]!;
    tabUrl = `${g1.appOrigins[0]}/nowhere-near`;
    const miss = await startRunInTab(7, g1.id, false, 2);
    expect(miss).toEqual({ status: 'needs-start', startUrl: g1.startUrl, reachable: false, pattern: step2.url.value, stepIndex: 2 });
    tabUrl = `${g1.appOrigins[0]}${step2.url.value}`;
    expect(await startRunInTab(7, g1.id, false, 2)).toEqual({ status: 'started' });
    const run = (await session.get('run:7'))['run:7'] as ReturnType<typeof startRun>;
    expect(run.stepIndex).toBe(2);
    await expect(startRunInTab(7, g1.id, false, 9)).rejects.toThrow(/no step 10/);
  });
});
