#!/usr/bin/env node
// Release notes for one version, taken from CHANGELOG.md (Keep a Changelog format; D56).
//
// CLI: node scripts/changelog-notes.mjs <version> [CHANGELOG.md]
// Prints the body of the `## [<version>]` section. Exits 1 when the section is missing or empty,
// so a release is never published without notes.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of the `## [version]` section, trimmed, or null when it is missing or empty. */
export function extractNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[?v?${escape(version)}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    // The next version, or the link definitions at the end of the file.
    if (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text === '' ? null : text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!version) {
    console.error('usage: changelog-notes.mjs <version> [CHANGELOG.md]');
    process.exit(2);
  }
  const notes = extractNotes(readFileSync(file, 'utf8'), version.replace(/^v/, ''));
  if (notes === null) {
    console.error(`${file} has no notes for ${version}. Add a "## [${version.replace(/^v/, '')}]" section first.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
