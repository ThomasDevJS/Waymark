import { describe, expect, it } from 'vitest';
import { claimNonce, framePathFor, issueNonce, NONCE_TTL_MS, type KV } from '../../src/core/frames/registry';
import { pickWinnerFrame } from '../../src/core/matcher/frames';

function memKV(): KV {
  const m = new Map<string, unknown>();
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
    expect(await claimNonce(kv, n, 8, 11)).toBe(false); // other tab (and consumed)
    expect(await claimNonce(kv, n, 7, 11)).toBe(false); // reused
    const old = await issueNonce(kv, 7, 0, 'iframe.a', Date.now() - NONCE_TTL_MS - 1);
    expect(await claimNonce(kv, old, 7, 11)).toBe(false);
    const self = await issueNonce(kv, 7, 5, 'iframe.a');
    expect(await claimNonce(kv, self, 7, 5)).toBe(false);
    expect(await claimNonce(kv, 'made-up', 7, 11)).toBe(false);
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
