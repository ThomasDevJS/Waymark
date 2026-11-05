import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations (scripts/release.mjs, D56)
import { compareVersions, prepareRelease, REPO_URL } from '../../scripts/release.mjs';
// @ts-expect-error: plain ESM script without type declarations (scripts/changelog-notes.mjs, D56)
import { extractNotes } from '../../scripts/changelog-notes.mjs';

const files = {
  pkg: '{\n  "name": "waymark",\n  "version": "0.3.2",\n  "type": "module"\n}\n',
  changelog: `# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A thing.\n\n## [0.3.2] - 2026-11-05\n\n- Older.\n\n[Unreleased]: ${REPO_URL}/commits/main\n[0.3.2]: ${REPO_URL}/pull/13\n`,
  status: 'As of 5 Nov 2026 the version is 0.3.2, on branch x.\n| M6 | version 0.2.0 (now 0.3.2: D46) |\n',
  readme: '**Status:** v0.3.2. M0–M5 are done.\n',
};

describe('pnpm release (D56)', () => {
  it('bumps package.json, STATUS and README, and keeps the rest of package.json as it was', () => {
    const out = prepareRelease(files, '0.3.3', '2026-11-06');
    expect(out.pkg).toBe(files.pkg.replace('0.3.2', '0.3.3'));
    expect(out.status).toBe('As of 5 Nov 2026 the version is 0.3.3, on branch x.\n| M6 | version 0.2.0 (now 0.3.3: D46) |\n');
    expect(out.readme).toBe('**Status:** v0.3.3. M0–M5 are done.\n');
  });

  it('turns Unreleased into the new version, adds an empty Unreleased and the links', () => {
    const out = prepareRelease(files, '0.3.3', '2026-11-06');
    expect(out.changelog).toContain('## [Unreleased]\n\n## [0.3.3] - 2026-11-06\n\n### Fixed\n- A thing.\n\n## [0.3.2]');
    expect(out.changelog).toContain(`[Unreleased]: ${REPO_URL}/compare/v0.3.3...HEAD\n[0.3.3]: ${REPO_URL}/releases/tag/v0.3.3\n[0.3.2]:`);
    // The release workflow then finds exactly these notes.
    expect(extractNotes(out.changelog, '0.3.3')).toBe('### Fixed\n- A thing.');
    expect(extractNotes(out.changelog, 'Unreleased')).toBeNull();
  });

  it('refuses an older or equal version, a malformed one, and an empty Unreleased section', () => {
    expect(() => prepareRelease(files, '0.3.2', 'd')).toThrow(/not newer/);
    expect(() => prepareRelease(files, '0.3.1', 'd')).toThrow(/not newer/);
    expect(() => prepareRelease(files, '0.4', 'd')).toThrow(/not a version/);
    const empty = { ...files, changelog: files.changelog.replace('### Fixed\n- A thing.\n', '') };
    expect(() => prepareRelease(empty, '0.3.3', 'd')).toThrow(/empty/);
    expect(() => prepareRelease({ ...files, changelog: '# Changelog\n' }, '0.3.3', 'd')).toThrow(/no "## \[Unreleased\]"/);
  });

  it('orders versions, with a pre-release before its release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0-rc.1', '0.4.0')).toBeLessThan(0);
    expect(compareVersions('0.4.0-rc.1', '0.3.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
});
