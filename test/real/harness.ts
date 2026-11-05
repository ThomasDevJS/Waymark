/**
 * Real-site reliability harness (`pnpm test:real`, opt-in, needs network).
 *
 * Each task records a guide by scripted interaction on a public demo app, reloads, then replays
 * it under a few cheap mutations. A replayed step counts as:
 * - found: drawn on one of the elements the task says the step is about;
 * - wrong: drawn on any other element (the matcher rule says this must never happen);
 * - not-found: the not-found card (an honest miss);
 * - stuck: drawn on the right element, but the learner's action did not advance the run.
 *
 * The test build marks the spotlighted element with `data-waymark-test-spot` (see
 * `src/content/test-hooks.ts`), so "right element" is an identity check, not a geometry guess.
 */
import type { BrowserContext, Frame, Locator, Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, marker, test as base, type ExtensionHelper } from '../e2e/fixtures';

export interface StepSpec {
  /** What the learner does; used both to record and to replay. */
  act: (p: Page) => Promise<void>;
  /** The element(s) the step may be drawn on. Omit for note and navigate steps. */
  target?: (p: Page) => Locator;
  /** Expected recorded step title (a regex or exact string, with `**` kept). */
  title?: RegExp | string;
  /** Extra wait after the action while recording (e.g. a page load). */
  settle?: (p: Page) => Promise<void>;
}

export interface Variant {
  name: string;
  viewport?: { width: number; height: number };
  /** Runs after the page loads and before the run starts. */
  prepare?: (p: Page) => Promise<void>;
  /** Replaces the task's steps' act/target for this variant (same length). */
  steps?: Partial<StepSpec>[];
  /** Step indexes where not-found is the correct answer (the element is really gone). */
  expectNotFound?: number[];
}

export interface Task {
  site: string;
  task: string;
  /** Match patterns to grant, e.g. `https://todomvc.com/*`. */
  origins: string[];
  url: string;
  /** Runs after the page loads, before recording and before every replay. */
  prepare?: (p: Page) => Promise<void>;
  steps: StepSpec[];
  /** Replay variants; `reload` is always run first. */
  variants?: Variant[];
  notes?: string;
}

export type Outcome = 'found' | 'wrong' | 'not-found' | 'stuck' | 'aborted' | 'timeout' | 'harness-error';

export interface VariantResult {
  site: string;
  task: string;
  variant: string;
  recorded: string[];
  expectedSteps: number;
  outcomes: Outcome[];
  details: string[];
  done: boolean;
}

/** Runs a learner action with a time limit, so one stuck click cannot eat the whole test. */
async function act(fn: () => Promise<void>, ms = 20_000): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([fn(), new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`action timed out after ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

const RESULTS_DIR = join(process.cwd(), 'test-results', 'real');

export async function msg<T>(ext: ExtensionHelper, type: string, payload: object): Promise<T> {
  const page = await ext.extensionPage();
  try {
    const r = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
    if (!r?.ok) throw new Error(`${type}: ${r?.error ?? 'no reply'}`);
    return r.data as T;
  } finally {
    await page.close();
  }
}

async function tabIdOf(ext: ExtensionHelper, page: Page): Promise<number> {
  const url = page.url();
  const sw = await ext.sw();
  return sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url === u) ?? tabs.find((x) => x.url?.split('#')[0] === u.split('#')[0]);
    if (!t?.id) throw new Error(`no tab for ${u}`);
    return t.id;
  }, url);
}

async function openApp(context: BrowserContext, task: Task, v?: Variant): Promise<Page> {
  const page = await context.newPage();
  if (v?.viewport) await page.setViewportSize(v.viewport);
  await page.goto(task.url, { waitUntil: 'load', timeout: 60_000 });
  await expect.poll(() => marker(page, 'loaded'), { timeout: 20_000, message: 'content script loaded' }).toBe('yes');
  await task.prepare?.(page);
  await v?.prepare?.(page);
  await expect.poll(() => marker(page, 'loaded'), { timeout: 20_000, message: 'content script loaded after prepare' }).toBe('yes');
  return page;
}

/** Records the task; returns the guide id and recorded step summaries ("kind: title"). */
export async function recordTask(context: BrowserContext, ext: ExtensionHelper, task: Task): Promise<{ guideId: string; recorded: string[]; titles: string[] }> {
  const app = await openApp(context, task);
  await app.bringToFront();
  await msg(ext, 'rec.start', { tabId: await tabIdOf(ext, app), title: `${task.site}: ${task.task}` });
  await expect.poll(() => marker(app, 'recording')).toBe('on');
  for (const [i, s] of task.steps.entries()) {
    await act(() => s.act(app)).catch(async (e: unknown) => {
      mkdirSync(RESULTS_DIR, { recursive: true });
      await app.screenshot({ path: join(RESULTS_DIR, `${slug(task.site)}--${slug(task.task)}--record-${i + 1}.png`) }).catch(() => undefined);
      throw new Error(`recording step ${i + 1}: ${String(e)}`);
    });
    await act(async () => s.settle?.(app)).catch(() => undefined);
    await app.waitForTimeout(400);
    await expect.poll(() => marker(app, 'recording'), { message: `recording after step ${i}`, timeout: 20_000 }).toBe('on');
  }
  await app.waitForTimeout(800);
  const res = await msg<{ guideId: string; steps: { kind: string; title: string }[] } | null>(ext, 'rec.stop', {});
  if (!res) throw new Error('rec.stop returned nothing');
  await app.close();
  // Keep the recorded targets next to the results for triage.
  const guide = await msg<{ steps: { kind: string; title: string; target?: unknown }[] }>(ext, 'guide.get', { id: res.guideId }).catch(() => null);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${slug(task.site)}--${slug(task.task)}--guide.json`), JSON.stringify(guide, null, 2));
  return { guideId: res.guideId, recorded: res.steps.map((s) => `${s.kind}: ${s.title}`), titles: res.steps.map((s) => s.title) };
}

/** The player marker in every frame of the page. */
async function playerStates(page: Page): Promise<{ frame: Frame; state: string | null }[]> {
  return Promise.all(page.frames().map(async (frame) => ({ frame, state: await marker(frame, 'player') })));
}

/** Waits until some frame shows step `i` drawn, as a note, not found, or the run is done. */
async function waitStep(page: Page, i: number, timeoutMs = 20_000): Promise<{ state: string; frame: Frame } | null> {
  const want = [`drawn:${i}`, `note:${i}`, `not-found:${i}`];
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const states = await playerStates(page);
    const hit = states.find((s) => s.state && want.includes(s.state));
    if (hit) return { state: hit.state!, frame: hit.frame };
    const done = states.find((s) => s.state === 'done');
    if (done) return { state: 'done', frame: done.frame };
    await page.waitForTimeout(150);
  }
  return null;
}

async function tooltipButton(frame: Frame, action: string) {
  return frame.locator(`waymark-overlay .tip [data-action="${action}"]`).first();
}

/** Replays a recorded guide on a fresh page under one variant. */
export async function replayTask(context: BrowserContext, ext: ExtensionHelper, task: Task, guideId: string, v: Variant, recorded: string[]): Promise<VariantResult> {
  const app = await openApp(context, task, v);
  await app.bringToFront();
  await msg(ext, 'run.start', { tabId: await tabIdOf(ext, app), guideId });
  const outcomes: Outcome[] = [];
  const details: string[] = [];
  const steps = task.steps.map((s, i) => ({ ...s, ...(v.steps?.[i] ?? {}) }));
  let aborted = false;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (aborted) {
      outcomes.push('aborted');
      continue;
    }
    const st = await waitStep(app, i);
    if (!st || st.state === 'done') {
      outcomes.push('timeout');
      details.push(`step ${i + 1}: ${st ? 'run ended early' : 'no player state'} (${JSON.stringify((await playerStates(app)).map((x) => x.state))})`);
      aborted = true;
      continue;
    }
    if (st.state.startsWith('not-found')) {
      outcomes.push('not-found');
      details.push(`step ${i + 1}: not found`);
      await (await tooltipButton(st.frame, 'skip')).click();
      await expect.poll(async () => (await playerStates(app)).some((x) => x.state === `not-found:${i}`)).toBe(false);
      await act(() => s.act(app)).catch((e) => details.push(`step ${i + 1}: act failed: ${String(e).slice(0, 200)}`));
      await act(async () => s.settle?.(app)).catch(() => undefined);
      continue;
    }
    if (st.state.startsWith('note')) {
      outcomes.push('found');
      await (await tooltipButton(st.frame, 'next')).click();
      continue;
    }
    // drawn: the spotlighted element must be one of the step's targets
    const target = s.target?.(app);
    let ok = false;
    let harnessError = target ? null : 'the task gives no target for a drawn step';
    if (target) {
      ok = await target
        .evaluateAll((els) => els.some((e) => e.hasAttribute('data-waymark-test-spot')))
        .catch((e: unknown) => {
          harnessError = String(e).slice(0, 300);
          return false;
        });
    }
    // A broken task locator is the harness's fault: never count it as a wrong match.
    if (harnessError) {
      outcomes.push('harness-error');
      details.push(`step ${i + 1}: harness error: ${harnessError}`);
      aborted = true;
      continue;
    }
    if (!ok) {
      const spot = await describeSpot(app);
      mkdirSync(RESULTS_DIR, { recursive: true });
      await app.screenshot({ path: join(RESULTS_DIR, `${slug(task.site)}--${slug(task.task)}--${slug(v.name)}--wrong-${i + 1}.png`) }).catch(() => undefined);
      outcomes.push('wrong');
      details.push(`step ${i + 1}: WRONG element: ${spot}`);
      aborted = true;
      continue;
    }
    const failed = await act(() => s.act(app)).then(() => null, (e: unknown) => String(e).slice(0, 300));
    if (failed) {
      outcomes.push('stuck');
      details.push(`step ${i + 1}: the learner's action failed with the spotlight drawn: ${failed}`);
      aborted = true;
      continue;
    }
    await act(async () => s.settle?.(app)).catch(() => undefined);
    // the run must move on (or finish)
    const moved = await expect
      .poll(async () => (await playerStates(app)).some((x) => x.state === 'done' || Number(/:(\d+)$/.exec(x.state ?? '')?.[1] ?? -1) > i), { timeout: 10_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (!moved) {
      await app.screenshot({ path: join(RESULTS_DIR, `${slug(task.site)}--${slug(task.task)}--${slug(v.name)}--stuck-${i + 1}.png`) }).catch(() => undefined);
      outcomes.push('stuck');
      details.push(`step ${i + 1}: drawn on the right element but did not advance (${app.url()} ${JSON.stringify((await playerStates(app)).map((x) => x.state))})`);
      aborted = true;
      continue;
    }
    outcomes.push('found');
  }
  let done = false;
  if (!aborted) {
    done = await expect
      .poll(async () => (await playerStates(app)).some((x) => x.state === 'done'), { timeout: 10_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
  }
  await msg(ext, 'run.stop', { tabId: await tabIdOf(ext, app) }).catch(() => undefined);
  await app.close();
  const r: VariantResult = { site: task.site, task: task.task, variant: v.name, recorded, expectedSteps: task.steps.length, outcomes, details, done };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${slug(task.site)}--${slug(task.task)}--${slug(v.name)}.json`), JSON.stringify(r, null, 2));
  return r;
}

async function describeSpot(page: Page): Promise<string> {
  for (const f of page.frames()) {
    const d = await f
      .evaluate(() => {
        const e = document.querySelector('[data-waymark-test-spot]');
        if (!e) return null;
        const text = (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const r = e.getBoundingClientRect();
        const path: string[] = [];
        for (let a: Element | null = e; a && path.length < 8; a = a.parentElement) path.push(a.localName + (a.id ? '#' + a.id : '') + (a.getAttribute('class') ? '.' + a.getAttribute('class')!.split(/\s+/).slice(0, 2).join('.') : ''));
        return `at ${Math.round(r.x)},${Math.round(r.y)} in ${path.reverse().join(' > ')}; <${e.localName}${e.id ? ' #' + e.id : ''}${e.getAttribute('class') ? ' .' + e.getAttribute('class')!.split(/\s+/).slice(0, 3).join('.') : ''}> "${text}"`;
      })
      .catch(() => null);
    if (d) return d;
  }
  return '(no spotted element)';
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Checks recorded titles against the spec; returns mismatches as strings. */
export function checkRecorded(task: Task, titles: string[]): string[] {
  const out: string[] = [];
  if (titles.length !== task.steps.length) out.push(`recorded ${titles.length} steps, expected ${task.steps.length}`);
  task.steps.forEach((s, i) => {
    const t = titles[i];
    if (!s.title || t === undefined) return;
    const ok = typeof s.title === 'string' ? t === s.title : s.title.test(t);
    if (!ok) out.push(`step ${i + 1}: title ${JSON.stringify(t)} does not match ${String(s.title)}`);
  });
  return out;
}

/** Records then replays a task under `reload` plus its variants, and asserts the outcome. */
export async function runTask(context: BrowserContext, ext: ExtensionHelper, task: Task): Promise<VariantResult[]> {
  for (const o of task.origins) await ext.grant(o);
  const { guideId, recorded, titles } = await recordTask(context, ext, task);
  const recordIssues = checkRecorded(task, titles);
  const results: VariantResult[] = [];
  const variants: Variant[] = [{ name: 'reload' }, ...(task.variants ?? [])];
  for (const v of variants) {
    // A recording with the wrong number of steps cannot be replayed against the spec.
    if (recordIssues.length && titles.length !== task.steps.length) break;
    try {
      results.push(await replayTask(context, ext, task, guideId, v, recorded));
    } catch (e) {
      results.push({ site: task.site, task: task.task, variant: v.name, recorded, expectedSteps: task.steps.length, outcomes: task.steps.map(() => 'aborted'), details: [`harness error: ${String(e).slice(0, 300)}`], done: false });
    }
  }
  const summary = { site: task.site, task: task.task, recorded, recordIssues, results: results.map((r) => ({ variant: r.variant, outcomes: r.outcomes, details: r.details, done: r.done })) };
  console.log(JSON.stringify(summary, null, 2));
  expect.soft(recordIssues, 'recorded steps').toEqual([]);
  for (const r of results) {
    const v = variants.find((x) => x.name === r.variant)!;
    const allowed = new Set(v.expectNotFound ?? []);
    expect.soft(r.outcomes.filter((o) => o === 'wrong').length, `${r.variant}: wrong matches`).toBe(0);
    const bad = r.outcomes.map((o, i) => (o === 'found' || (o === 'not-found' && allowed.has(i)) ? null : `${i + 1}:${o}`)).filter(Boolean);
    expect.soft(bad, `${r.variant}: steps not found on the right element`).toEqual([]);
  }
  return results;
}

/**
 * For an instance 'any' step the player spotlights the first tied element; a learner clicks
 * that one (the tooltip may cover the others). While recording there is no spotlight, so the
 * author's own choice is clicked.
 */
export async function clickSpotOr(p: Page, group: Locator, authorChoice: Locator): Promise<void> {
  const spot = group.and(p.locator('[data-waymark-test-spot]'));
  if (await spot.count()) await spot.first().click();
  else await authorChoice.click();
}

/**
 * The e2e fixtures with a profile whose password manager is off: demo sites log in with public
 * passwords, and Chrome's native "found in a data breach" modal would swallow all input.
 */
export const test = base.extend({
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'waymark-real-'));
    mkdirSync(join(dir, 'Default'), { recursive: true });
    const prefs = { credentials_enable_service: false, profile: { password_manager_enabled: false, password_manager_leak_detection: false } };
    writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify(prefs));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
});
