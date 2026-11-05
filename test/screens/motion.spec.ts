/**
 * Motion frame sequences (D130), part of `pnpm screens`: each animation is paused right after it
 * starts and scrubbed to fixed times (Web Animations `currentTime`), so the frames are the same
 * on every machine. Frames go to artifacts/screens/<SHOTS>/motion-<name>-<ms>.png;
 * `python3 scripts/frames.py <set> <dest> <name>…` turns them into a strip and a GIF.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type ExtensionHelper } from '../e2e/fixtures';

const OUT = join(process.cwd(), 'artifacts', 'screens', process.env.SHOTS ?? 'current');
const TIMES = [0, 40, 80, 120, 180, 240];

/** Every animation in the page and in the overlay's shadow root (document.getAnimations() leaves shadow trees out). */
const ALL = `[...document.getAnimations(), ...(document.querySelector('waymark-overlay')?.shadowRoot?.getAnimations() ?? [])]`;

/** Pauses every running animation (shadow roots included) and shoots it at each time. */
export async function frames(page: Page, name: string, area: Locator | (() => Promise<{ x: number; y: number; width: number; height: number }>), times = TIMES): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(`${ALL}.forEach((a) => a.pause())`);
  const box = typeof area === 'function' ? await area() : await area.boundingBox();
  if (!box) throw new Error(`nothing to shoot for ${name}`);
  const pad = 12;
  const vp = page.viewportSize()!;
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(vp.width, box.width + 2 * pad), height: Math.min(vp.height, box.height + 2 * pad) };
  for (const t of times) {
    // Endless ones (spinners, the REC halo) keep their own time.
    await page.evaluate(`${ALL}.forEach((a) => { if (a.effect?.getComputedTiming().endTime !== Infinity) a.currentTime = ${t}; })`);
    await page.screenshot({ path: join(OUT, `motion-${name}-${String(t).padStart(3, '0')}.png`), clip, animations: 'allow' });
  }
  // finish() throws on endless ones (a spinner, the REC halo).
  await page.evaluate(`${ALL}.forEach((a) => a.effect?.getComputedTiming().endTime !== Infinity && a.finish())`);
}

async function seedGuide(ext: ExtensionHelper): Promise<string> {
  const id = '01JSCREENSMOTION0000000000';
  const step = (i: number) => ({
    id: `S${i}`, kind: 'click', title: `Click **Button ${i + 1}**`, note: 'A short note under the title.', url: { kind: 'prefix', value: '/' }, advance: 'action',
    target: { instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: `Button ${i + 1}`, cssPath: 'main > button', xpath: '/html[1]/body[1]/main[1]/button[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 80, h: 30, vw: 1280, vh: 900 } },
  });
  const guide = {
    id, schemaVersion: 1, revisionId: '01JSCREENSMOTION000000000R', title: 'Send an invoice', lang: 'en', tags: [], appOrigins: ['https://app.test'],
    startUrl: 'https://app.test/start', matchUrls: [], version: 1, source: 'local', updatedAt: new Date().toISOString(), steps: Array.from({ length: 4 }, (_, i) => step(i)),
  };
  await ext.message('pack.import', { text: JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: new Date().toISOString(), guides: [guide] }), choices: {} });
  return id;
}

test('panel motion frames: fold, reorder, toast, Saved tick', async ({ context, ext, extensionId }) => {
  const id = await seedGuide(ext);
  const page = await context.newPage();
  await page.setViewportSize({ width: 400, height: 860 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=1&edit=${id}`);
  await expect(page.getByTestId('step-3-toggle')).toBeVisible();
  const list = page.locator('.edit-steps');

  await page.getByTestId('step-1-toggle').click();
  await frames(page, 'fold', list);
  await page.getByTestId('step-1-toggle').click();
  await page.waitForTimeout(300);

  await page.getByTestId('step-0-down').click();
  await frames(page, 'reorder', list);

  await page.getByTestId('step-2-delete').click();
  await frames(page, 'toast', page.locator('.editor-bar'));
  await page.getByTestId('toast-undo').click();
  await page.waitForTimeout(300);

  await page.getByTestId('step-0-toggle').click();
  await page.getByTestId('step-0-title').fill('Click **Send**');
  await page.waitForTimeout(300);
  await page.getByTestId('save-guide').click();
  await expect(page.getByTestId('editor-status')).toBeVisible();
  await frames(page, 'saved', page.getByTestId('editor-status'));
});

test('player motion frames: click registered, glide, tooltip in and out (Practice page)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto(`chrome-extension://${extensionId}/practice.html?tutorial=tour`);
  const mark = () => page.evaluate(() => document.documentElement.getAttribute('data-waymark-test-practice'));
  await expect.poll(mark).toBe('drawn:0');
  await page.locator('waymark-overlay [data-action="next"]').click();
  await expect.poll(mark).toBe('drawn:1');
  await page.waitForTimeout(400);
  // Step 2 is "click New invoice": the press ripples, the step moves on to the customer field.
  const from = (await page.locator('[data-guide-id="practice-new-invoice"]').boundingBox())!;
  await page.locator('[data-guide-id="practice-new-invoice"]').click();
  await expect.poll(mark).toBe('drawn:2');
  const to = (await page.locator('[data-guide-id="practice-customer"]').boundingBox())!;
  const tip = (await page.locator('waymark-overlay .tip').boundingBox())!;
  const x = Math.min(from.x, to.x, tip.x);
  const y = Math.min(from.y, to.y, tip.y);
  const r = Math.max(from.x + from.width, to.x + to.width, tip.x + tip.width);
  const b = Math.max(from.y + from.height, to.y + to.height, tip.y + tip.height);
  await frames(page, 'advance', async () => ({ x: x - 20, y: y - 20, width: r - x + 40, height: b - y + 40 }));
});
