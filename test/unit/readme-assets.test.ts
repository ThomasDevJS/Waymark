/**
 * The README's graphics (issue #109, D230): every file in docs/assets/ stays under 300 KB, the
 * listing images have the sizes GitHub and the Chrome Web Store ask for, and the README points at
 * them with relative links that exist (so they work on forks).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'docs', 'assets');
const LIMIT = 300_000;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('README assets', () => {
  const all = files(ASSETS);

  it('has the graphics, each under 300 KB', () => {
    expect(all.length).toBeGreaterThanOrEqual(19);
    for (const f of all) expect(statSync(f).size, f).toBeLessThanOrEqual(LIMIT);
  });

  it('holds only images', () => {
    for (const f of all) expect(f, f).toMatch(/\.(png|gif|svg)$/);
  });

  it('has the social preview and store tiles at their required sizes', () => {
    expect(pngSize(join(ASSETS, 'social-preview.png'))).toEqual([1280, 640]);
    expect(pngSize(join(ASSETS, 'store', 'store-small-440x280.png'))).toEqual([440, 280]);
    expect(pngSize(join(ASSETS, 'store', 'store-marquee-1400x560.png'))).toEqual([1400, 560]);
  });

  it('has a light and a dark version of the hero and of each poster', () => {
    for (const n of ['hero', 'poster-record', 'poster-play', 'poster-share', 'poster-private'])
      for (const s of ['light', 'dark']) expect(existsSync(join(ASSETS, `${n}-${s}.png`)), `${n}-${s}`).toBe(true);
  });

  it('README links to them with relative paths that exist', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const refs = [...readme.matchAll(/(?:src|srcset|href)="([^"]+)"|\]\(([^)\s]+)\)/g)].map((m) => (m[1] ?? m[2])!).filter((r) => r.includes('docs/assets'));
    expect(refs.length).toBeGreaterThanOrEqual(10);
    for (const r of refs) {
      expect(r, r).not.toMatch(/^(https?:|\/)/);
      expect(existsSync(join(ROOT, r)), r).toBe(true);
    }
  });
});
