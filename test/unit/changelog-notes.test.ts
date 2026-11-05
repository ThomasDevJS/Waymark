import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations (scripts/changelog-notes.mjs, D56)
import { extractNotes } from '../../scripts/changelog-notes.mjs';

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Added
- Something new.

## [0.3.1] - 2026-11-05

### Security
- Entry limits.

## [0.3.0] - 2026-11-05

### Added
- HD voice.

## [0.2.4] - 2026-11-05

[Unreleased]: https://example.com/compare
[0.3.1]: https://example.com/pull/14
`;

describe('release notes from the changelog (D56)', () => {
  it('returns the body of one version, without the next version', () => {
    expect(extractNotes(CHANGELOG, '0.3.1')).toBe('### Security\n- Entry limits.');
    expect(extractNotes(CHANGELOG, '0.3.0')).toBe('### Added\n- HD voice.');
  });

  it('stops at the link definitions at the end of the file', () => {
    const last = CHANGELOG.replace('## [0.2.4] - 2026-11-05\n', '## [0.2.4] - 2026-11-05\n- Faster.\n');
    expect(extractNotes(last, '0.2.4')).toBe('- Faster.');
  });

  it('returns null for a missing or empty version, and does not match a prefix', () => {
    expect(extractNotes(CHANGELOG, '0.4.0')).toBeNull();
    expect(extractNotes(CHANGELOG, '0.2.4')).toBeNull();
    expect(extractNotes(CHANGELOG, '0.3')).toBeNull();
  });

  it('matches the usual heading styles, but never another version', () => {
    for (const h of ['## [0.4.0] - 2026-12-01', '## 0.4.0', '## v0.4.0', '## [v0.4.0]', '## [0.4.0](https://example.com/compare) (2026-12-01)', '##  [0.4.0]\t']) {
      expect(extractNotes(`# Changelog\n\n${h}\n- Notes.\n`, '0.4.0'), h).toBe('- Notes.');
    }
    const rc = '## [0.4.0-rc.1]\n- Candidate.\n\n## [10.4.0]\n- Ten.\n';
    expect(extractNotes(rc, '0.4.0')).toBeNull();
    expect(extractNotes(rc, '0.4.0-rc.1')).toBe('- Candidate.');
    expect(extractNotes('## [0.4.0]\n- Final.\n', '0.4.0-rc.1')).toBeNull();
  });

  it('keeps code blocks and inline link definitions, and stops at a top-level heading', () => {
    const md = '## [0.4.0]\n- Run:\n\n```sh\n## not a heading\n[x]: not-a-link\n```\n\n[docs]: https://example.com/docs\n- More, see [docs].\n\n# Appendix\n- Not notes.\n';
    expect(extractNotes(md, '0.4.0')).toBe('- Run:\n\n```sh\n## not a heading\n[x]: not-a-link\n```\n\n[docs]: https://example.com/docs\n- More, see [docs].');
  });

  it('handles Windows line endings', () => {
    expect(extractNotes(CHANGELOG.replace(/\n/g, '\r\n'), '0.3.1')).toBe('### Security\n- Entry limits.');
  });

  it('the release workflow has write access in its one job only', () => {
    const yml = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    expect(yml).toMatch(/^permissions: \{\}$/m);
    expect(yml.match(/contents: write/g)).toHaveLength(1);
    expect(yml).toMatch(/^ {4}permissions:\n {6}contents: write/m);
  });
});
