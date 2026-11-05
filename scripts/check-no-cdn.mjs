#!/usr/bin/env node
// CI guard (D47): no script in the built extension may name a code CDN. MV3 forbids remote
// code, and 'wasm-unsafe-eval' would let a fetched remote .wasm compile.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CDN = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev|ga\.jspm\.io)\b/;
const dir = process.argv[2] ?? '.output/chrome-mv3';
const hits = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|html)$/.test(name)) {
      const m = CDN.exec(readFileSync(p, 'utf8'));
      if (m) hits.push(`${p}: ${m[0]}`);
    }
  }
};
walk(dir);
if (hits.length) {
  console.error(`CDN guard FAILED for ${dir}:\n - ` + hits.join('\n - '));
  process.exit(1);
}
console.log(`CDN guard passed: ${dir}`);
