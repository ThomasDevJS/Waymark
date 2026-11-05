/**
 * Motion tokens and rules (D130): the JS constants match the CSS tokens, reduced motion removes
 * every distance and scale, and no stylesheet animates a property that triggers layout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR, EASE } from '../../src/ui/motion';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const tokens = read('src/ui/tokens.css');

function token(name: string, css = tokens): string {
  const m = new RegExp(`--wm-${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`no token --wm-${name}`);
  return m[1]!.trim();
}

/** Properties a transition or keyframe may change. Paint-only colour and outline fades are kept from D90/D93. */
const ALLOWED = new Set(['transform', 'opacity', 'translate', 'scale', 'rotate', 'background-color', 'border-color', 'color', 'outline-offset', 'outline-color', 'box-shadow']);
/** box-shadow is allowed only where it already pulsed before D130 (the spotlight ring, D93). */
const BOX_SHADOW_OK = ['wm-ring-pulse'];

export const STYLESHEETS = [
  'src/ui/tokens.css',
  'src/ui/components.css',
  'src/entrypoints/sidepanel/style.css',
  'src/entrypoints/options/style.css',
  'src/entrypoints/practice/style.css',
  'src/content/player/ui.ts',
  'src/content/overlay/pill.ts',
];

function transitionProps(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/(?<![-\w])transition(?:-property)?\s*:\s*([^;}]+)[;}]/g)) {
    for (const part of m[1]!.split(',')) {
      const prop = part.trim().split(/\s+/)[0]!;
      if (/^\d|^var\(|^none$/.test(prop)) continue;
      out.push(prop);
    }
  }
  return out;
}

function keyframes(css: string): { name: string; props: string[] }[] {
  const out: { name: string; props: string[] }[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    // Read the balanced block.
    let depth = 1;
    let i = re.lastIndex;
    while (depth && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(re.lastIndex, i - 1);
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]!);
    out.push({ name: m[1]!, props });
  }
  return out;
}

describe('motion tokens (D130)', () => {
  it('JS durations and easings mirror the CSS tokens', () => {
    expect(token('dur-press')).toBe(`${DUR.press}ms`);
    expect(token('dur-fast')).toBe(`${DUR.fast}ms`);
    expect(token('dur-base')).toBe(`${DUR.base}ms`);
    expect(token('dur-slow')).toBe(`${DUR.slow}ms`);
    expect(token('ease-standard')).toBe(EASE.standard);
    expect(token('ease-enter')).toBe(EASE.enter);
    expect(token('ease-exit')).toBe(EASE.exit);
    expect(token('ease-spring')).toBe(EASE.spring);
  });

  it('durations stay between 80 and 240 ms', () => {
    for (const d of Object.values(DUR)) {
      expect(d).toBeGreaterThanOrEqual(80);
      expect(d).toBeLessThanOrEqual(240);
    }
  });

  it('reduced motion zeroes every distance and scale', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '';
    for (const name of ['move-sm', 'move-md', 'move-lg', 'lift']) expect(token(name, block)).toBe('0px');
    for (const name of ['press', 'press-lg']) expect(token(name, block)).toBe('1');
  });
});

describe('only compositor-friendly properties animate (D130)', () => {
  for (const file of STYLESHEETS) {
    it(file, () => {
      const css = read(file);
      for (const prop of transitionProps(css)) expect(ALLOWED, `transition of ${prop}`).toContain(prop);
      for (const k of keyframes(css)) {
        for (const prop of k.props) {
          expect(ALLOWED, `@keyframes ${k.name} animates ${prop}`).toContain(prop);
          if (prop === 'box-shadow') expect(BOX_SHADOW_OK, `@keyframes ${k.name} animates box-shadow`).toContain(k.name);
        }
      }
      // `transition: all` would animate whatever changes, layout included.
      expect(css).not.toMatch(/transition\s*:\s*all\b/);
    });
  }
});
