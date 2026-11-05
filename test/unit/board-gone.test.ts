/** D84: a frame replaced by a new iframe element leaves a report that would tie with its successor. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropGone, recordReport, tiedDocs } from '../../src/core/player/board';
import { frameAlive, FRAME_ALIVE_MS } from '../../src/background/runs';

const rep = (frameId: number, doc: string, found = true) => ({ frameToken: `t${frameId}`, frameId, stepToken: 's', found, score: 100, margin: 60, instance: 'unique' as const, pathMatches: true, doc });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('frame board: frames that are gone (D84)', () => {
  it('two found reports on the path tie; dropping the gone document makes the live one win', () => {
    let b = recordReport(undefined, rep(261, 'old-doc'));
    expect(b.winner).toBe('t261');
    b = recordReport(b, rep(288, 'new-doc'));
    expect(b.winner).toBeNull();
    expect(tiedDocs(b).map((t) => t.doc).sort()).toEqual(['new-doc', 'old-doc']);
    expect(dropGone(b, [{ key: '261', doc: 'old-doc' }])).toBe(true);
    expect(b.winner).toBe('t288');
  });

  it('never drops a report that a newer document of the same frame replaced', () => {
    const b = recordReport(recordReport(undefined, rep(5, 'a')), rep(6, 'b'));
    recordReport(b, rep(5, 'a2')); // frame 5 reloaded: same frameId, new document
    expect(dropGone(b, [{ key: '5', doc: 'a' }])).toBe(false);
    expect(b.reports['5']!.doc).toBe('a2');
  });

  it('no tie, nothing to ask', () => {
    expect(tiedDocs(recordReport(undefined, rep(1, 'x')))).toEqual([]);
  });
});

describe('frameAlive', () => {
  it('false when the document is gone, true when it answers or is slow', async () => {
    vi.useFakeTimers();
    const send = vi.fn((_tab: number, _msg: unknown, o: { documentId: string }) =>
      o.documentId === 'gone' ? Promise.reject(new Error('No frame')) : o.documentId === 'slow' ? new Promise(() => undefined) : Promise.resolve(true),
    );
    vi.stubGlobal('chrome', { tabs: { sendMessage: send } });
    expect(await frameAlive(1, 'gone')).toBe(false);
    expect(await frameAlive(1, 'live')).toBe(true);
    const slow = frameAlive(1, 'slow');
    await vi.advanceTimersByTimeAsync(FRAME_ALIVE_MS + 1);
    expect(await slow).toBe(true);
  });
});
