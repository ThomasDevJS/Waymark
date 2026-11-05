import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations (scripts/ci-changes.mjs, D54)
import { isDocPath, needsCi, API_FILE_LIMIT, BUILD_INPUT_DOCS } from '../../scripts/ci-changes.mjs';

/** The `on.push.paths` list of the CI workflow, read as text (no YAML parser in the deps). */
function pushPaths(): string[] {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  const block = /^ {2}push:\n(?: {4}.*\n)*? {4}paths:\n((?: {6}- .*\n)+)/m.exec(yml);
  if (!block?.[1]) throw new Error('on.push.paths not found in ci.yml');
  return block[1].split('\n').filter(Boolean).map((l) => l.replace(/^ {6}- /, '').replace(/\s+#.*$/, '').replace(/^'(.*)'$/, '$1'));
}

describe('CI docs-only gate (D54)', () => {
  it('treats Markdown anywhere and everything under docs/ as documentation', () => {
    for (const p of ['README.md', 'CHANGELOG.md', 'demo/README.md', 'docs/SPEC.md', 'docs/img/shot.png']) {
      expect(isDocPath(p), p).toBe(true);
    }
  });

  it('treats code, config, workflows and THIRD_PARTY_NOTICES.md as build inputs', () => {
    for (const p of ['src/core/matcher/match.ts', 'package.json', '.github/workflows/ci.yml', 'scripts/ci-changes.mjs', 'THIRD_PARTY_NOTICES.md', 'docsite/x.ts', 'README.mdx']) {
      expect(isDocPath(p), p).toBe(false);
    }
  });

  it('skips CI only when every changed path is documentation', () => {
    expect(needsCi(['README.md', 'docs/STATUS.md'])).toBe(false);
    expect(needsCi(['README.md', 'src/entrypoints/background.ts'])).toBe(true);
    expect(needsCi(['docs/PRIVACY.md', 'THIRD_PARTY_NOTICES.md'])).toBe(true);
  });

  it('runs CI when the list is empty or may have been cut short', () => {
    expect(needsCi([])).toBe(true);
    expect(needsCi(['', '  '])).toBe(true);
    expect(needsCi(Array.from({ length: API_FILE_LIMIT }, (_, i) => `docs/${i}.md`))).toBe(true);
  });

  it('matches the push paths filter in ci.yml', () => {
    expect(pushPaths()).toEqual(['**', '!**/*.md', '!docs/**', ...BUILD_INPUT_DOCS]);
  });
});
