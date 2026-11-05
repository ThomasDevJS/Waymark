#!/usr/bin/env node
// Prepare a release in one commit (D56): `pnpm release <version>`.
//
// Bumps `version` in package.json, turns the CHANGELOG's `## [Unreleased]` section into
// `## [<version>] - <today>` (with a new empty Unreleased section above it and updated links),
// and updates the version in docs/STATUS.md and README.md. It changes files only: commit them,
// open a PR, and after it merges tag the merge commit `v<version>` to publish the release.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPO_URL = 'https://github.com/ThomasDevJS/Waymark';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative, zero or positive, like a sort comparator. A pre-release sorts before its release. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  if (pa[4] === pb[4]) return 0;
  if (pa[4] === undefined) return 1;
  if (pb[4] === undefined) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

/**
 * Returns the new file contents. Throws when the version is not newer, or when the changelog
 * has no Unreleased section or nothing in it.
 */
export function prepareRelease(files, version, date) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 0.3.3`);
  const current = JSON.parse(files.pkg).version;
  if (compareVersions(version, current) <= 0) throw new Error(`${version} is not newer than the current version ${current}`);

  const pkg = files.pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);

  const lines = files.changelog.split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]\s*$/.test(l));
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^\[[^\]]+\]:\s/.test(l)));
  if (end < 0) end = lines.length;
  if (lines.slice(start + 1, end).join('').trim() === '') throw new Error('The Unreleased section of CHANGELOG.md is empty: list the changes first');
  lines.splice(start, 1, '## [Unreleased]', '', `## [${version}] - ${date}`);
  let changelog = lines.join('\n');
  const unreleasedLink = `[Unreleased]: ${REPO_URL}/compare/v${version}...HEAD`;
  const versionLink = `[${version}]: ${REPO_URL}/releases/tag/v${version}`;
  if (/^\[Unreleased\]:.*$/m.test(changelog)) {
    changelog = changelog.replace(/^\[Unreleased\]:.*$/m, `${unreleasedLink}\n${versionLink}`);
  } else {
    changelog = `${changelog.replace(/\n*$/, '')}\n\n${unreleasedLink}\n${versionLink}\n`;
  }

  const status = files.status
    .replace(/the version is \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, `the version is ${version}`)
    .replace(/\(now \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, `(now ${version}`);
  const readme = files.readme.replace(/\*\*Status:\*\* v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, `**Status:** v${version}`);
  return { pkg, changelog, status, readme };
}

const PATHS = { pkg: 'package.json', changelog: 'CHANGELOG.md', status: 'docs/STATUS.md', readme: 'README.md' };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  if (!version) {
    console.error('usage: pnpm release <version>   (for example: pnpm release 0.3.3)');
    process.exit(2);
  }
  const files = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
  let next;
  try {
    next = prepareRelease(files, version, new Date().toISOString().slice(0, 10));
  } catch (e) {
    console.error(`release: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  for (const [k, p] of Object.entries(PATHS)) {
    if (next[k] !== files[k]) {
      writeFileSync(p, next[k]);
      console.log(`updated ${p}`);
    }
  }
  console.log(`\nNext: review the diff, run pnpm check, commit "Release ${version}" and open a PR.`);
  console.log(`After it merges: git fetch origin main && git tag -a v${version} -m "Waymark ${version}" origin/main && git push origin v${version}`);
}
