/** Signal rules that need no layout (review H1: group-level signals). */
import { describe, expect, it } from 'vitest';
import type { ElementFingerprint } from '../../src/core/model/schema';
import { IDENTIFYING, isStrongSignal, presentSignals, scoreCandidate } from '../../src/core/matcher/signals';

const base = (over: Partial<ElementFingerprint>): ElementFingerprint => ({
  instance: 'unique',
  matchCount: 1,
  tag: 'input',
  cssPath: 'input',
  xpath: '/html[1]/body[1]/input[1]',
  ancestors: [],
  shadowPath: [],
  framePath: [],
  rect: { x: 0, y: 0, w: 0, h: 0, vw: 0, vh: 0 },
  ...over,
});

function el(markup: string): Element {
  const t = document.createElement('template');
  t.innerHTML = markup; // eslint-disable-line no-restricted-properties
  return t.content.firstElementChild!;
}

describe('name is not strong where a group shares it', () => {
  it('text fields keep a strong name', () => {
    expect(isStrongSignal('name', base({ inputType: 'text', name: 'email' }))).toBe(true);
    expect(isStrongSignal('name', base({ tag: 'select', name: 'country' }))).toBe(true);
  });
  it.each(['radio', 'checkbox', 'submit', 'button', 'reset', 'image'])('%s inputs: name alone is weak', (type) => {
    expect(isStrongSignal('name', base({ inputType: type, name: 'g' }))).toBe(false);
  });
  it('<button name> is weak', () => {
    expect(isStrongSignal('name', base({ tag: 'button', name: 'commit' }))).toBe(false);
  });
  it('a radio or checkbox with its value: the name/value pair is strong', () => {
    const fp = base({ inputType: 'radio', name: 'plan', value: 'yearly' });
    expect(isStrongSignal('name', fp)).toBe(true);
    expect(presentSignals(fp)).toContain('name');
    const ctx = { base: 'https://a.test/' };
    expect(scoreCandidate(el('<input type="radio" name="plan" value="yearly">'), fp, ctx).strongMatched).toBe(true);
    const other = scoreCandidate(el('<input type="radio" name="plan" value="monthly">'), fp, ctx);
    expect(other.matched).not.toContain('name');
    expect(other.strongMatched).toBe(false);
  });
  it('a candidate matching only a weak name has no strong signal', () => {
    const fp = base({ inputType: 'submit', name: 'commit', role: 'button', accessibleName: 'Publish' });
    const s = scoreCandidate(el('<input type="submit" name="commit" value="Delete draft">'), fp, { base: 'https://a.test/' });
    expect(s.matched).toContain('name');
    expect(s.strongMatched).toBe(false);
  });
});

describe('link paths of same-page links', () => {
  it('a "#" link never matches a recorded link path', () => {
    const fp = base({ tag: 'a', hrefPath: '/orders' });
    const s = scoreCandidate(el('<a href="#">x</a>'), fp, { base: 'https://a.test/orders' });
    expect(s.matched).not.toContain('href');
  });
});

describe('identifying signals', () => {
  it('are test id, id, role + name and text; name and link path are group-level', () => {
    expect([...IDENTIFYING].sort()).toEqual(['id', 'roleName', 'testId', 'text']);
  });
});
