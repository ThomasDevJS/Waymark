#!/usr/bin/env node
// Does a change need the full CI run? (D54)
//
// Docs-only changes (any `*.md` file, or anything under `docs/`) skip the check and e2e jobs.
// THIRD_PARTY_NOTICES.md is the exception: it is copied into the extension build (wxt.config.ts).
// Keep this in sync with the `push.paths` filter in .github/workflows/ci.yml.
//
// CLI: reads changed paths (one per line) on stdin and prints `code=true` or `code=false`,
// ready to append to $GITHUB_OUTPUT. When in doubt it answers `code=true`.
import { pathToFileURL } from 'node:url';

/** Files that end in .md but still change the built extension. */
export const BUILD_INPUT_DOCS = ['THIRD_PARTY_NOTICES.md'];

/** The PR files API lists at most this many files; a longer list may be cut short. */
export const API_FILE_LIMIT = 3000;

/** True when `path` is documentation that the build and the tests never read. */
export function isDocPath(path) {
  if (BUILD_INPUT_DOCS.includes(path)) return false;
  return path.startsWith('docs/') || path.endsWith('.md');
}

/** True unless every changed path is documentation. An empty or truncated list needs CI. */
export function needsCi(paths) {
  const list = paths.map((p) => p.trim()).filter(Boolean);
  if (list.length === 0 || list.length >= API_FILE_LIMIT) return true;
  return list.some((p) => !isDocPath(p));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(`code=${needsCi(input.split('\n'))}\n`);
}
