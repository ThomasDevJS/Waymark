import { describe, expect, it } from 'vitest';
import { recorderStep } from '../../src/background/recording';
import type { Step } from '../../src/core/model/schema';
import { parseInline, toPlainText } from '../../src/core/text/markdown';

const target = { instance: 'unique' as const, matchCount: 1, tag: 'button', cssPath: 'button', xpath: '/html[1]/body[1]/button[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } };

describe('rec.step sanitization', () => {
  it('keeps only what the recorder produces', () => {
    const fromPage: Step = { id: 'a', kind: 'click', title: 'Click **X**', url: { kind: 'pattern', value: '/' }, target, advance: 'next', note: 'injected', voiceText: 'say this', optional: true, placement: 'top', flags: ['low-confidence'] };
    expect(recorderStep(fromPage)).toEqual({ id: 'a', kind: 'click', title: 'Click **X**', url: { kind: 'pattern', value: '/' }, target, advance: 'action', flags: ['low-confidence'] });
  });
  it('refuses kinds the recorder never sends and steps without a target', () => {
    expect(recorderStep({ id: 'n', kind: 'note', title: 'x', url: { kind: 'pattern', value: '/' }, advance: 'next' })).toBeNull();
    expect(recorderStep({ id: 'v', kind: 'navigate', title: 'x', url: { kind: 'pattern', value: '/' }, advance: 'action', target })).toBeNull();
    expect(recorderStep({ id: 'c', kind: 'click', title: 'x', url: { kind: 'pattern', value: '/' }, advance: 'action' })).toBeNull();
  });
});

describe('D48: titles from content scripts', () => {
  it('never keep a live link', () => {
    const forged: Step = { id: 'a', kind: 'click', title: 'Click [Open admin](https://phish.example)', url: { kind: 'pattern', value: '/' }, target, advance: 'action' };
    const out = recorderStep(forged)!;
    expect(parseInline(out.title).some((t) => t.type === 'link')).toBe(false);
    expect(toPlainText(out.title)).toBe('Click Open admin');
    // Ordinary recorder titles are unchanged.
    expect(recorderStep({ ...forged, title: 'Click **Save \\[draft\\]**' })!.title).toBe('Click **Save \\[draft\\]**');
  });
});
