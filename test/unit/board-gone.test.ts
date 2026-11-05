/** D84: a frame replaced by a new iframe element leaves a report that would tie with its successor. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECK_GAP_MS, docsToCheck, dropDoc, dropGone, markChecked, recordReport } from '../../src/core/player/board';
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
    expect(docsToCheck(b, 0).map((t) => t.doc).sort()).toEqual(['new-doc', 'old-doc']);
    expect(dropGone(b, [{ key: '261', doc: 'old-doc' }])).toBe(true);
    expect(b.winner).toBe('t288');
  });

  it('never drops a report that a newer document of the same frame replaced', () => {
    const b = recordReport(recordReport(undefined, rep(5, 'a')), rep(6, 'b'));
    recordReport(b, rep(5, 'a2')); // frame 5 reloaded: same frameId, new document
    expect(dropGone(b, [{ key: '5', doc: 'a' }])).toBe(false);
    expect(b.reports['5']!.doc).toBe('a2');
  });

  it('one found frame: nothing to ask', () => {
    expect(docsToCheck(recordReport(undefined, rep(1, 'x')), 0)).toEqual([]);
  });

  it('asks even when a frame already won (instance any: the old, lower frameId wins the tie)', () => {
    const any = (frameId: number, doc: string) => ({ ...rep(frameId, doc), instance: 'any' as const });
    const b = recordReport(recordReport(undefined, any(261, 'old')), any(288, 'new'));
    expect(b.winner).toBe('t261');
    expect(docsToCheck(b, 0).map((t) => t.doc).sort()).toEqual(['new', 'old']);
    expect(dropGone(b, [{ key: '261', doc: 'old' }])).toBe(true);
    expect(b.winner).toBe('t288');
  });

  it('asks each document once per burst', () => {
    const b = recordReport(recordReport(undefined, rep(1, 'a')), rep(2, 'b'));
    markChecked(b, docsToCheck(b, 1000), 1000);
    expect(docsToCheck(b, 1000 + CHECK_GAP_MS - 1)).toEqual([]);
    expect(docsToCheck(b, 1000 + CHECK_GAP_MS).length).toBe(2);
  });

  it('a document that leaves drops its own reports only; a real tie of three stays a tie', () => {
    const b = recordReport(recordReport(recordReport(undefined, rep(1, 'a')), rep(2, 'b')), rep(3, 'c'));
    expect(dropDoc(b, 'a')).toBe(true);
    expect(Object.keys(b.reports).sort()).toEqual(['2', '3']);
    expect(b.winner).toBeNull();
    expect(dropDoc(b, 'nope')).toBe(false);
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
    send.mockImplementationOnce(() => Promise.resolve(undefined)); // no player answered: not ours, gone
    expect(await frameAlive(1, 'other')).toBe(false);
    const slow = frameAlive(1, 'slow');
    await vi.advanceTimersByTimeAsync(FRAME_ALIVE_MS + 1);
    expect(await slow).toBe(true);
  });
});
