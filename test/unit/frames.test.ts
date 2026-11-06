import { describe, expect, it } from 'vitest';
import { claimNonce, framePathFor, framesAtPath, issueNonce, MAX_MAPPED_FRAMES, MAX_PENDING_NONCES, NONCE_TTL_MS, type KV } from '../../src/core/frames/registry';
import { pickWinnerFrame } from '../../src/core/matcher/frames';

function memKV(m = new Map<string, unknown>()): KV {
  return {
    get: async <T,>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    remove: async (k) => void m.delete(k),
  };
}

describe('frame nonce registry', () => {
  it('maps nested frames to their selector chain', async () => {
    const kv = memKV();
    const n1 = await issueNonce(kv, 7, 0, 'iframe.a');
    expect(await claimNonce(kv, n1, 7, 11)).toBe(true);
    const n2 = await issueNonce(kv, 7, 11, 'iframe.b');
    expect(await claimNonce(kv, n2, 7, 12)).toBe(true);
    const map = (await kv.get<Record<string, { parentFrameId: number; selector: string }>>('frames:7'))!;
    expect(framePathFor(map, 0)).toEqual([]);
    expect(framePathFor(map, 11)).toEqual(['iframe.a']);
    expect(framePathFor(map, 12)).toEqual(['iframe.a', 'iframe.b']);
    expect(framePathFor(map, 99)).toBeNull();
  });
  it('rejects reused, foreign-tab, expired and self claims', async () => {
    const kv = memKV();
    const n = await issueNonce(kv, 7, 0, 'iframe.a');
    expect(await claimNonce(kv, n, 8, 11)).toBe(false); // other tab: unknown there, and not burnt
    expect(await claimNonce(kv, n, 7, 11)).toBe(true);
    expect(await claimNonce(kv, n, 7, 12)).toBe(false); // reused
    const old = await issueNonce(kv, 7, 0, 'iframe.a', Date.now() - NONCE_TTL_MS - 1);
    expect(await claimNonce(kv, old, 7, 11)).toBe(false);
    const self = await issueNonce(kv, 7, 5, 'iframe.a');
    expect(await claimNonce(kv, self, 7, 5)).toBe(false);
    expect(await claimNonce(kv, 'made-up', 7, 11)).toBe(false);
  });
  // D48: a page can make its iframes post "hello" in a loop; every hello asks for a nonce.
  it('keeps pending nonces bounded per tab and drops expired ones', async () => {
    const m = new Map<string, unknown>();
    const kv = memKV(m);
    const first = await issueNonce(kv, 7, 0, 'iframe.a');
    let last = '';
    for (let i = 0; i < 2000; i++) last = await issueNonce(kv, 7, 0, 'iframe.' + 'x'.repeat(500));
    const size = JSON.stringify([...m.entries()]).length;
    expect(m.size).toBeLessThanOrEqual(2);
    expect(size).toBeLessThan(MAX_PENDING_NONCES * 700);
    expect(await claimNonce(kv, first, 7, 11)).toBe(false); // pushed out by newer ones
    expect(await claimNonce(kv, last, 7, 11)).toBe(true); // the newest still works
    // Expired nonces are swept on the next issue.
    await issueNonce(kv, 9, 0, 'iframe.a', Date.now() - NONCE_TTL_MS - 1);
    await issueNonce(kv, 9, 0, 'iframe.b');
    expect(Object.keys(m.get('nonces:9') as object)).toHaveLength(1);
  });
  it('keeps the frame map bounded when a page churns iframes (D48)', async () => {
    const m = new Map<string, unknown>();
    const kv = memKV(m);
    for (let f = 1; f <= 1000; f++) expect(await claimNonce(kv, await issueNonce(kv, 7, 0, 'iframe.' + 'y'.repeat(1000)), 7, f)).toBe(true);
    const map = m.get('frames:7') as Record<string, unknown>;
    expect(Object.keys(map)).toHaveLength(MAX_MAPPED_FRAMES);
    expect(framePathFor(map as never, 1000)).not.toBeNull(); // the newest frames stay mapped
  });
  it('detects cycles', () => {
    expect(framePathFor({ '1': { parentFrameId: 2, selector: 'a' }, '2': { parentFrameId: 1, selector: 'b' } }, 1)).toBeNull();
  });
});

describe('pickWinnerFrame', () => {
  const r = (frameId: number, score: number, extra: object = {}) => ({ frameId, found: true, score, margin: 20, instance: 'unique' as const, ...extra });
  it('picks the best frame, or none when two frames are too close', () => {
    expect(pickWinnerFrame([r(0, 70), r(3, 95)])).toBe(3);
    expect(pickWinnerFrame([r(0, 90), r(3, 85)])).toBeNull();
    expect(pickWinnerFrame([r(0, 90, { instance: 'any' }), r(3, 85, { instance: 'any' })])).toBe(0);
    expect(pickWinnerFrame([{ ...r(0, 90), found: false }])).toBeNull();
  });
  it('prefers the frame on the recorded framePath', () => {
    expect(pickWinnerFrame([r(0, 95), r(3, 90, { pathMatches: true })])).toBe(3);
  });
});

describe('framesAtPath (D152)', () => {
  it('lists every frame at a path, newest first; the top frame is 0', () => {
    // 324 → 353 was the screen's first frame pair; the app rebuilt it as 390 → 398.
    const map = {
      '324': { parentFrameId: 0, selector: '#action_frame' },
      '353': { parentFrameId: 324, selector: 'iframe.activity' },
      '390': { parentFrameId: 0, selector: '#action_frame' },
      '398': { parentFrameId: 390, selector: 'iframe.activity' },
      '400': { parentFrameId: 0, selector: '#other' },
    };
    expect(framesAtPath(map, ['#action_frame', 'iframe.activity'])).toEqual([398, 353]);
    expect(framesAtPath(map, ['#action_frame'])).toEqual([390, 324]);
    expect(framesAtPath(map, [])).toEqual([0]);
    expect(framesAtPath(map, ['#missing'])).toEqual([]);
  });
});

