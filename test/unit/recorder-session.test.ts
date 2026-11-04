import { describe, expect, it } from 'vitest';
import { addOrigin, applyOp, navigationStep, NAV_BELONGS_TO_CLICK_MS, startRecording, toGuide, urlKey, viewOf } from '../../src/core/recorder/session';
import { GuideSchema, type Step } from '../../src/core/model/schema';

const click = (id: string): Step => ({ id, kind: 'click', title: 'Click **X**', url: { kind: 'pattern', value: '/' }, advance: 'action' });

describe('recording session', () => {
  it('adds steps, replaces only the last one by id, refuses while paused', () => {
    const s = startRecording('Demo', 1, 'https://app.test/orders/12', 1000);
    expect(applyOp(s, { op: 'add', step: click('a') }, 2000)).toBe(true);
    expect(applyOp(s, { op: 'add', step: click('b') }, 2000)).toBe(true);
    expect(applyOp(s, { op: 'replace', stepId: 'a', step: { ...click('a'), kind: 'submit' } })).toBe(false);
    expect(applyOp(s, { op: 'replace', stepId: 'b', step: { ...click('x'), kind: 'submit', title: 'Submit the form' } })).toBe(true);
    expect(s.steps.map((x) => `${x.id}:${x.kind}`)).toEqual(['a:click', 'b:submit']);
    s.status = 'paused';
    expect(applyOp(s, { op: 'add', step: click('c') })).toBe(false);
    expect(viewOf(s)).toEqual({ active: true, paused: true, count: 2, lastStepTitle: 'Submit the form' });
    expect(viewOf(null).active).toBe(false);
  });

  it('navigation within 1.5 s of an action belongs to it; replace and query-only changes are ignored', () => {
    const s = startRecording('Demo', 1, 'https://app.test/a', 0);
    applyOp(s, { op: 'add', step: click('a') }, 10_000);
    const nav = (url: string, prevUrl: string, now: number, navigationType?: string) =>
      navigationStep(s, { url, prevUrl: urlKey(prevUrl), now, ...(navigationType ? { navigationType } : {}), title: 'Orders' });
    expect(nav('https://app.test/b', 'https://app.test/a', 10_000 + NAV_BELONGS_TO_CLICK_MS)).toBeNull();
    expect(nav('https://app.test/a?page=2', 'https://app.test/a', 20_000)).toBeNull();
    expect(nav('https://app.test/b', 'https://app.test/a', 20_000, 'replace')).toBeNull();
    expect(nav('https://app.test/a', 'https://app.test/a', 20_000)).toBeNull();
    const step = nav('https://app.test/orders/42', 'https://app.test/a', 20_000, 'push')!;
    expect(step).toMatchObject({ kind: 'navigate', title: 'Go to Orders', url: { kind: 'pattern', value: '/orders/:id' }, advance: 'action' });
    expect(navigationStep(s, { url: 'https://app.test/x', prevUrl: 'https://app.test/a', now: 20_000, title: 'Invoice 2026-11-04' })!.title).toBe('Go to /x');
  });

  it('turns a recording into a valid guide', () => {
    const s = startRecording('  ', 1, 'https://app.test/orders/12', 0);
    applyOp(s, { op: 'add', step: click('a') });
    const g = toGuide(s);
    expect(GuideSchema.safeParse(g).success).toBe(true);
    expect(g).toMatchObject({ title: 'Untitled guide', appOrigins: ['https://app.test'], matchUrls: [{ kind: 'pattern', value: '/orders/:id' }], version: 1, source: 'local' });
  });
});

describe('slow full page loads', () => {
  it('a page load belongs to the action when the old page started leaving within 1.5 s of it', () => {
    const s = startRecording('Demo', 1, 'https://app.test/a', 0);
    applyOp(s, { op: 'add', step: click('a') }, 10_000);
    const base = { url: 'https://app.test/b', prevUrl: 'https://app.test/a', navigationType: 'push' };
    // left 200 ms after the click, new page arrived 4 s later: no navigate step
    expect(navigationStep(s, { ...base, now: 14_000, leavingAt: 10_200 })).toBeNull();
    // left 3 s after the click: the app navigated on its own
    expect(navigationStep(s, { ...base, now: 14_000, leavingAt: 13_000 })).not.toBeNull();
    // navigation start a little before the action was logged (time origin of the new page)
    expect(navigationStep(s, { ...base, now: 14_000, leavingAt: 9_980 })).toBeNull();
    // no leaving mark (e.g. typed URL): navigate step
    expect(navigationStep(s, { ...base, now: 14_000 })).not.toBeNull();
    // a stale mark is ignored
    expect(navigationStep(s, { ...base, now: 10_200 + 61_000, leavingAt: 10_200 })).not.toBeNull();
  });
});

describe('review fixes', () => {
  it('stores only origin and a param-free path as the start URL', () => {
    const s = startRecording('x', 1, 'https://app.test/orders/123/edit?email=jane@example.com#access_token=abc', 0);
    expect(s.startUrl).toBe('https://app.test/orders');
    expect(JSON.stringify(s)).not.toContain('jane');
    expect(JSON.stringify(s)).not.toContain('access_token');
    expect(JSON.stringify(s)).not.toContain('abc');
    expect(startRecording('x', 1, 'https://kb.test/app/' + 'a'.repeat(3000), 0).startUrl.length).toBeLessThanOrEqual(1000);
    const g = toGuide(s);
    expect(GuideSchema.safeParse(g).success).toBe(true);
    expect(g.matchUrls).toEqual([{ kind: 'pattern', value: '/orders/:id/edit' }]);
  });

  it('caps a recording at 500 steps and refuses duplicate step ids', () => {
    const s = startRecording('x', 1, 'https://app.test/', 0);
    for (let i = 0; i < 500; i++) expect(applyOp(s, { op: 'add', step: click(`s${i}`) })).toBe(true);
    expect(applyOp(s, { op: 'add', step: click('extra') })).toBe(false);
    expect(GuideSchema.safeParse(toGuide(s)).success).toBe(true);
    const t = startRecording('x', 1, 'https://app.test/', 0);
    applyOp(t, { op: 'add', step: click('a') });
    expect(applyOp(t, { op: 'add', step: click('a') })).toBe(false);
  });

  it('page titles cannot inject markdown links into navigate steps', () => {
    const s = startRecording('x', 1, 'https://app.test/a', 0);
    const step = navigationStep(s, { url: 'https://app.test/b', prevUrl: 'https://app.test/a', now: 99_999, title: '[Pay](https://x.test)' })!;
    expect(step.title).toBe('Go to \\[Pay\\](https://x.test)');
  });
});

describe('D47: a page cannot make a recording unsaveable', () => {
  it('stops adding navigate steps and sites at the guide limits', () => {
    const s = startRecording('t', 1, 'https://app.test/a', 0);
    for (let i = 0; i < 600; i++) {
      const step = navigationStep(s, { url: `https://app.test/p${i % 2}`, prevUrl: urlKey(`https://app.test/p${(i + 1) % 2}`), now: 100_000 + i * 2000, title: 'Page' });
      if (step) s.steps.push(step);
    }
    for (let i = 0; i < 80; i++) addOrigin(s, `https://s${i}.test`);
    expect(GuideSchema.safeParse(toGuide(s)).success).toBe(true);
  });
});
