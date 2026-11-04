import { describe, expect, it } from 'vitest';
import { applyRunOp, currentStep, onStartPage, runView, shouldCatchUp, startRun, stepForUrl } from '../../src/core/player/run';
import { emptyBoard, recordReport } from '../../src/core/player/board';
import { spotlightPanels } from '../../src/core/player/spotlight';
import type { Guide, Step } from '../../src/core/model/schema';

const step = (id: string, path: string, kind: Step['kind'] = 'click'): Step => ({ id, kind, title: id, url: { kind: 'pattern', value: path }, advance: kind === 'note' ? 'next' : 'action' });
const guide: Guide = {
  id: 'g1',
  schemaVersion: 1,
  revisionId: 'r1',
  title: 'Demo',
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.test'],
  startUrl: 'https://app.test/',
  matchUrls: [{ kind: 'pattern', value: '/' }],
  steps: [step('a', '/'), step('b', '/orders/:id'), step('c', '/orders/:id', 'note')],
  version: 1,
  source: 'local',
  updatedAt: '',
};

describe('run state', () => {
  it('advances, goes back, finishes, and ignores stale step ids', () => {
    const r = startRun(guide, 0);
    const t0 = r.stepToken;
    expect(currentStep(r)?.id).toBe('a');
    expect(applyRunOp(r, 'done', 'b')).toBe(false); // stale: not the current step
    expect(applyRunOp(r, 'back', 'a')).toBe(false); // nothing before the first step
    expect(applyRunOp(r, 'done', 'a')).toBe(true);
    expect(r.stepToken).not.toBe(t0);
    expect(r.cause).toBe('action');
    expect(applyRunOp(r, 'done', 'a')).toBe(false); // a second frame reporting the same action
    expect(applyRunOp(r, 'back', 'b')).toBe(true);
    expect(r.stepIndex).toBe(0);
    applyRunOp(r, 'next', 'a');
    applyRunOp(r, 'skip', 'b');
    expect(applyRunOp(r, 'next', 'c')).toBe(true);
    expect(r.status).toBe('finished');
    expect(currentStep(r)).toBeUndefined();
    expect(applyRunOp(r, 'next', 'c')).toBe(false);
  });

  it('a run continues on its snapshot', () => {
    const g = structuredClone(guide);
    const r = startRun(g);
    g.steps.splice(0, 3);
    expect(r.guideSnapshot.steps).toHaveLength(3);
  });

  it('knows the start page and the step for a URL', () => {
    expect(onStartPage(guide, 'https://app.test/?x=1')).toBe(true);
    expect(onStartPage(guide, 'https://app.test/orders/5')).toBe(false);
    expect(onStartPage(guide, 'https://evil.test/')).toBe(false);
    expect(stepForUrl(guide, 'https://app.test/orders/5')).toBe(1);
  });

  it('views carry only the current step and the frame winner for that step', () => {
    const r = startRun(guide);
    const board = recordReport(undefined, { frameToken: 'top', frameId: 0, stepToken: r.stepToken, found: true, score: 90, margin: 30, instance: 'unique', pathMatches: true });
    const v = runView(r, board);
    expect(v).toMatchObject({ active: true, status: 'running', stepIndex: 0, total: 3, winner: 'top', phase: 'found' });
    expect(v.step?.id).toBe('a');
    expect(JSON.stringify(v)).not.toContain('"b"');
    applyRunOp(r, 'done', 'a');
    expect(runView(r, board).winner).toBeNull(); // board belongs to the previous step
  });
});

describe('frame board', () => {
  const rep = (frameToken: string, frameId: number, found: boolean, score: number, extra = {}) => ({ frameToken, frameId, stepToken: 's', found, score, margin: 20, instance: 'unique' as const, pathMatches: false, ...extra });
  it('picks one winner; top-frame not-found marks the step not found until a frame finds it', () => {
    let b = recordReport(emptyBoard('s'), rep('top', 0, false, 30));
    expect(b).toMatchObject({ winner: null, topGaveUp: true });
    b = recordReport(b, rep('child', 7, true, 95, { pathMatches: true }));
    expect(b.winner).toBe('child');
    b = recordReport(b, rep('other', 9, true, 90));
    expect(b.winner).toBe('child'); // on the recorded frame path
  });
  it('two frames that both claim a unique target with close scores draw nothing', () => {
    let b = recordReport(undefined, rep('a', 0, true, 90));
    b = recordReport(b, rep('b', 4, true, 88));
    expect(b.winner).toBeNull();
  });
});

describe('spotlight', () => {
  it('builds four panels around the target plus 6 px, clamped to the viewport', () => {
    const { hole, panels } = spotlightPanels({ x: 100, y: 50, w: 80, h: 20 }, 1000, 800);
    expect(hole).toEqual({ x: 94, y: 44, w: 92, h: 32 });
    expect(panels).toEqual([
      { x: 0, y: 0, w: 1000, h: 44 },
      { x: 0, y: 76, w: 1000, h: 724 },
      { x: 0, y: 44, w: 94, h: 32 },
      { x: 186, y: 44, w: 814, h: 32 },
    ]);
    const edge = spotlightPanels({ x: -20, y: -10, w: 50, h: 30 }, 1000, 800);
    expect(edge.hole).toEqual({ x: 0, y: 0, w: 36, h: 26 });
    expect(edge.panels.every((p) => p.w >= 0 && p.h >= 0)).toBe(true);
  });
});

describe('catching up a lost link-click report', () => {
  it('advances a click step when the new page is the next step page and not this one', () => {
    const r = startRun(guide);
    expect(shouldCatchUp(r, 'https://app.test/orders/12')).toBe(true);
    expect(shouldCatchUp(r, 'https://app.test/')).toBe(false); // still on the step page
    expect(shouldCatchUp(r, 'https://app.test/other')).toBe(false); // somewhere else: off track
    expect(shouldCatchUp(r, 'https://evil.test/orders/12')).toBe(false);
    applyRunOp(r, 'done', 'a');
    expect(shouldCatchUp(r, 'https://app.test/orders/12')).toBe(false); // step b: same page as c
  });
});
