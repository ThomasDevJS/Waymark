#!/usr/bin/env node
// Renders the Waymark mark (assets/brand/*.svg) to the extension icons in public/icon/ (D94).
// Run after changing the SVGs: `node scripts/icons.mjs`. Uses the Playwright Chromium already
// installed for the tests; the PNGs are committed, so builds don't need a browser.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const big = readFileSync('assets/brand/mark.svg', 'utf8');
const small = readFileSync('assets/brand/mark-16.svg', 'utf8');
const executablePath = process.env.WAYMARK_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath }).catch(() => chromium.launch());
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  // 16 px has its own drawing: the dotted path and the pole's foot would blur at that size.
  const svg = (size <= 16 ? small : big).replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
  console.log(`public/icon/${size}.png`);
}
await browser.close();
