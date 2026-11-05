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
  // `## [1.2.3] - date`, `## 1.2.3`, `## v1.2.3`, `## [1.2.3](compare-link) (date)`.
  const heading = new RegExp(`^##\\s+\\[?v?${escape(version)}(\\]\\([^)]*\\)|\\])?(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const body = [];
  let fence = null;
  for (const line of lines.slice(start + 1)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f?.[1]) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (fence === null) {
      // The next version, or a top-level heading. Fenced code blocks may contain either.
      if (/^#{1,2}\s/.test(line)) break;
    }
    body.push(line);
  }
  // Link definitions at the end of the last section belong to the whole file. Ones inside a
  // section, followed by more notes, are kept.
  const isTrailing = (l) => l.trim() === '' || /^\[[^\]]+\]:\s/.test(l);
  while (fence === null && body.length > 0 && isTrailing(body[body.length - 1])) body.pop();
  const text = body.join('\n').trim();
  return text === '' ? null : text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!version) {
    console.error('usage: changelog-notes.mjs <version> [CHANGELOG.md]');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`${file} not found. Release notes come from it.`);
    process.exit(1);
  }
  const notes = extractNotes(text, version.replace(/^v/, ''));
  if (notes === null) {
    console.error(`${file} has no notes for ${version}. Add a "## [${version.replace(/^v/, '')}]" section first.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
