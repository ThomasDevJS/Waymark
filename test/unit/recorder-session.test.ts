import { describe, expect, it } from 'vitest';
import { applyOp, navigationStep, NAV_BELONGS_TO_CLICK_MS, startRecording, toGuide, viewOf } from '../../src/core/recorder/session';
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
      navigationStep(s, { url, prevUrl, now, ...(navigationType ? { navigationType } : {}), title: 'Orders' });
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
