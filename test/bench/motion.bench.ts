/**
 * Motion frame-time bench (D130): `pnpm motion:bench`. Not part of `pnpm check` or CI.
 *
 * Runs each animation with the CPU slowed 4× (CDP Emulation.setCPUThrottlingRate) and records
 * every frame's interval (requestAnimationFrame), plus long tasks and long animation frames
 * (PerformanceObserver) while it plays:
 *   - fold: opening and closing an editor step (side panel);
 *   - toast: deleting a step (the toast enters, the rows glide) and Undo (it leaves);
 *   - spotlight: Next and Back between highlighted elements (the Practice page, the real player).
 * Each scenario runs with motion on and again with reduced motion (nothing moves) as the control.
 * A table goes to stdout and to artifacts/motion/bench.md (JSON beside it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { canGrant, expect, test, type ExtensionHelper } from '../e2e/fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run): headless frames are not paced like a real screen');

const RATE = Number(process.env.MOTION_CPU ?? 4);
const ROUNDS = Number(process.env.MOTION_ROUNDS ?? 6);
const OUT = join(process.cwd(), 'artifacts', 'motion');
const FRAME = 1000 / 60;

interface Sample {
  frames: number[];
  longTasks: number[];
  loaf: { duration: number; blocking: number }[];
}

/** Starts recording frames in the page. */
async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __mb: Sample & { on: boolean; obs: PerformanceObserver[] } };
    const mb = { frames: [] as number[], longTasks: [] as number[], loaf: [] as { duration: number; blocking: number }[], on: true, obs: [] as PerformanceObserver[] };
    w.__mb = mb;
    let last = 0;
    const tick = (t: number) => {
      if (last) mb.frames.push(t - last);
      last = t;
      if (mb.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const long = new PerformanceObserver((l) => l.getEntries().forEach((e) => mb.longTasks.push(e.duration)));
    long.observe({ type: 'longtask' });
    mb.obs.push(long);
    try {
      const loaf = new PerformanceObserver((l) => l.getEntries().forEach((e) => mb.loaf.push({ duration: e.duration, blocking: (e as unknown as { blockingDuration: number }).blockingDuration ?? 0 })));
      loaf.observe({ type: 'long-animation-frame' });
      mb.obs.push(loaf);
    } catch {
      // older Chromium: long tasks only
    }
  });
}

async function stopRecording(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const w = window as unknown as { __mb: Sample & { on: boolean; obs: PerformanceObserver[] } };
    w.__mb.on = false;
    w.__mb.obs.forEach((o) => o.disconnect());
    return { frames: w.__mb.frames, longTasks: w.__mb.longTasks, loaf: w.__mb.loaf };
  });
}

/** Runs `act` (in the page) and records the frames for `ms` after it. */
async function sample(page: Page, act: () => Promise<unknown>, ms: number, into: Sample): Promise<void> {
  await startRecording(page);
  await act();
  await page.waitForTimeout(ms);
  const s = await stopRecording(page);
  // The first interval is the recorder's own start; the rest is the animation.
  into.frames.push(...s.frames.slice(1));
  into.longTasks.push(...s.longTasks);
  into.loaf.push(...s.loaf);
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

function stats(s: Sample) {
  const f = s.frames;
  const mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
  return {
    frames: f.length,
    mean: +mean.toFixed(1),
    p50: +pct(f, 50).toFixed(1),
    p95: +pct(f, 95).toFixed(1),
    max: +Math.max(0, ...f).toFixed(1),
    // A frame that took longer than about one and a half refreshes missed a vsync.
    missed: f.filter((x) => x > FRAME * 1.5).length,
    longTasks: s.longTasks.length,
    longFrames: s.loaf.length,
    maxBlocking: +Math.max(0, ...s.loaf.map((l) => l.blocking)).toFixed(1),
  };
}

const step = (title: string, extra: object = {}) => ({
  id: `S${Math.random().toString(36).slice(2, 10)}`,
  kind: 'click',
  title,
  note: 'A short note under the title, as most steps have.',
  url: { kind: 'prefix', value: '/' },
  advance: 'action',
  target: {
    instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: title, cssPath: 'main > button', xpath: '/html[1]/body[1]/main[1]/button[1]',
    ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 80, h: 30, vw: 1280, vh: 900 },
  },
  ...extra,
});

async function seedGuide(ext: ExtensionHelper): Promise<string> {
  const id = '01JBENCHMOTION00000000000A';
  const guide = {
    id, schemaVersion: 1, revisionId: '01JBENCHMOTION00000000000R', title: 'Motion bench', lang: 'en', tags: [], appOrigins: ['https://app.test'],
    startUrl: 'https://app.test/start', matchUrls: [], version: 1, source: 'local', updatedAt: new Date().toISOString(),
    steps: Array.from({ length: 12 }, (_, i) => step(`Click button ${i + 1}`)),
  };
  const text = JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: new Date().toISOString(), guides: [guide] });
  await ext.message('pack.import', { text, choices: {} });
  return id;
}

async function throttled(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  return cdp;
}

const click = (page: Page, selector: string) => page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.click(), selector);
const clickInOverlay = (page: Page, selector: string) =>
  page.evaluate((s) => (document.querySelector('waymark-overlay')?.shadowRoot?.querySelector(s) as HTMLElement | null)?.click(), selector);

type Mode = 'motion' | 'reduced';
const results: Record<string, Record<Mode, ReturnType<typeof stats>>> = {};

for (const mode of ['motion', 'reduced'] as const) {
  test(`fold and toast in the side panel (${mode})`, async ({ context, ext, extensionId }) => {
    const id = await seedGuide(ext);
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 860 });
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tab=1&edit=${id}`);
    await expect(page.getByTestId('step-3-toggle')).toBeVisible();
    await page.bringToFront();
    await throttled(page);
    await page.waitForTimeout(500);

    const fold: Sample = { frames: [], longTasks: [], loaf: [] };
    for (let r = 0; r < ROUNDS; r++) {
      const k = 2 + (r % 4);
      await sample(page, () => click(page, `[data-testid="step-${k}-toggle"]`), 400, fold); // unfold
      await sample(page, () => click(page, `[data-testid="step-${k}-toggle"]`), 300, fold); // fold
    }
    const toast: Sample = { frames: [], longTasks: [], loaf: [] };
    for (let r = 0; r < ROUNDS; r++) {
      await sample(page, () => click(page, '[data-testid="step-1-delete"]'), 500, toast); // toast in, rows glide up
      await sample(page, () => click(page, '[data-testid="toast-undo"]'), 400, toast); // toast out, the step comes back
    }
    (results.fold ??= {} as Record<Mode, ReturnType<typeof stats>>)[mode] = stats(fold);
    (results.toast ??= {} as Record<Mode, ReturnType<typeof stats>>)[mode] = stats(toast);
  });

  test(`spotlight glide on the Practice page (${mode})`, async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    await page.goto(`chrome-extension://${extensionId}/practice.html?tutorial=edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-waymark-test-practice'))).toBe('drawn:0');
    await page.bringToFront();
    await throttled(page);
    await page.waitForTimeout(500);
    const glide: Sample = { frames: [], longTasks: [], loaf: [] };
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < 3; i++) await sample(page, () => clickInOverlay(page, '[data-action="next"]'), 450, glide);
      for (let i = 0; i < 3; i++) await sample(page, () => clickInOverlay(page, '[data-action="back"]'), 450, glide);
    }
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-waymark-test-practice'))).toBe('drawn:0');
    (results.spotlight ??= {} as Record<Mode, ReturnType<typeof stats>>)[mode] = stats(glide);
  });
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  const rows = Object.entries(results).flatMap(([name, by]) =>
    (['motion', 'reduced'] as const)
      .filter((m) => by[m])
      .map((m) => {
        const s = by[m]!;
        return `| ${name} | ${m} | ${s.frames} | ${s.mean} | ${s.p50} | ${s.p95} | ${s.max} | ${s.missed} | ${s.longTasks} | ${s.longFrames} | ${s.maxBlocking} |`;
      }),
  );
  const md = [
    `CPU ${RATE}× slower (CDP), ${ROUNDS} rounds, ${process.env.CI ? 'CI' : 'local'} Chromium under Xvfb. Frame times in ms (one refresh = 16.7).`,
    '',
    '| scenario | mode | frames | mean | p50 | p95 | max | missed (>25 ms) | long tasks | long anim. frames | max blocking |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  writeFileSync(join(OUT, 'bench.md'), `${md}\n`);
  writeFileSync(join(OUT, 'bench.json'), JSON.stringify({ rate: RATE, rounds: ROUNDS, results }, null, 2));
  console.log(`\n${md}\n`);
});
