/**
 * Service worker side of the editor (SPEC: User flows, Edit; Milestones M4): load and save a
 * guide (Save bumps the version and gives a new revisionId), Test step, and Re-pick element.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { ElementFingerprintSchema, GuideSchema, type Guide } from '../core/model/schema';
import { newId } from '../core/model/ids';
import { enqueue } from '../core/storage/queue';
import { guideKey, writeGuide } from '../core/storage/guides';
import { framesKey, type FrameMap } from '../core/frames/registry';
import { sessionKV } from '../core/storage/session-kv';
import { stepUrlRule } from '../core/url/url';
import { withoutLinks } from '../core/text/markdown';
import { updateAllBadges } from './discovery';

/** The tab must show a page of the guide's site: steps are only sent to their own origin (D41). */
async function tabOnOrigins(tabId: number, origins: string[]): Promise<string> {
  let url: string | undefined;
  try {
    url = (await chrome.tabs.get(tabId)).url;
  } catch {
    url = undefined;
  }
  let origin = '';
  try {
    origin = url ? new URL(url).origin : '';
  } catch {
    origin = '';
  }
  if (!url || !origins.includes(origin)) throw new Error("Open a page of this guide's site in this tab first.");
  return url;
}

/** Ends a pending pick on a tab and lets the panel know (cancelled, timed out, page left). */
export async function endPick(tabId: number, cancelled: boolean): Promise<void> {
  const pending = (await chrome.storage.session.get(pickKey(tabId)))[pickKey(tabId)];
  await chrome.storage.session.remove(pickKey(tabId));
  if (cancelled && pending) await chrome.storage.session.set({ [pickResultKey(tabId)]: { cancelled: true, at: Date.now() } });
  const msg: ContentPush = { type: 'pick.stop' };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

export const PICK_TTL_MS = 120_000;
const pickKey = (tabId: number) => `pick:${tabId}`;
export const pickResultKey = (tabId: number) => `pickResult:${tabId}`;

async function loadGuide(id: string): Promise<Guide> {
  const parsed = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(id)))[guideKey(id)]);
  if (!parsed.success) throw new Error('Guide not found.');
  return parsed.data;
}

/** The frameId whose framePath equals the step's recorded one (0 for the top frame). */
async function frameFor(tabId: number, framePath: string[]): Promise<number | null> {
  if (!framePath.length) return 0;
  const map = (await sessionKV.get<FrameMap>(framesKey(tabId))) ?? {};
  const want = JSON.stringify(framePath);
  for (const id of Object.keys(map)) {
    const path: string[] = [];
    let cur: number = Number(id);
    const seen = new Set<number>();
    while (cur !== 0 && !seen.has(cur)) {
      seen.add(cur);
      const link = map[String(cur)];
      if (!link) break;
      path.unshift(link.selector);
      cur = link.parentFrameId;
    }
    if (cur === 0 && JSON.stringify(path) === want) return Number(id);
  }
  return null;
}

export interface TestResult {
  found: boolean;
  score: number;
  margin: number;
  matched: string[];
  /** Matched on a single strong signal: likely to break when the app changes (SPEC: per-site profiles). */
  fragile: boolean;
  reason?: string;
}

export const editorHandlers: Handlers = {
  'guide.get': async ({ id }) => loadGuide(id),
  'guide.save': async ({ guide, baseRevisionId }) => {
    return enqueue(async () => {
      const current = await loadGuide(guide.id).catch(() => null);
      if (!current) throw new Error('Guide not found.');
      if (current.source === 'library') throw new Error('Library guides are read-only. Duplicate it to edit.');
      // Never overwrite a newer copy saved elsewhere (another side panel) without knowing.
      if (current.revisionId !== baseRevisionId) throw new Error('This guide was changed elsewhere. Close the editor and open it again.');
      const next: Guide = {
        ...guide,
        id: current.id,
        source: 'local',
        schemaVersion: 1,
        version: current.version + 1,
        revisionId: newId(),
        updatedAt: new Date().toISOString(),
      };
      await writeGuide(next);
      return next;
    }).then(async (g) => {
      await updateAllBadges();
      return g;
    });
  },
  'step.test': async ({ tabId, step, origins }): Promise<TestResult> => {
    await tabOnOrigins(tabId, origins);
    if (!step.target) return { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'This step has no element.' };
    const frameId = await frameFor(tabId, step.target.framePath);
    if (frameId === null) return { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'The frame of this step is not on the page.' };
    const msg: ContentPush = { type: 'test.step', payload: { step } };
    try {
      const r = (await chrome.tabs.sendMessage(tabId, msg, { frameId })) as TestResult | undefined;
      return r ?? { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'Waymark is not running on this page.' };
    } catch {
      return { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'Waymark is not running on this page. Allow it on this site first.' };
    }
  },
  'pick.start': async ({ tabId, origins }) => {
    await tabOnOrigins(tabId, origins);
    await chrome.storage.session.set({ [pickKey(tabId)]: Date.now() });
    await chrome.storage.session.remove(pickResultKey(tabId));
    const msg: ContentPush = { type: 'pick.start' };
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      await chrome.storage.session.remove(pickKey(tabId));
      throw new Error('Waymark is not running on this page. Reload the page and try again.');
    }
    return { ok: true };
  },
  'pick.cancel': async ({ tabId }) => {
    await endPick(tabId, true);
    return { ok: true };
  },
  'pick.abort': async (_p, ctx: HandlerContext) => {
    if (ctx.tabId !== undefined) await endPick(ctx.tabId, true);
    return { ok: true };
  },
  // From a content script: only while the panel asked this tab for a pick.
  'pick.result': async ({ target, title }, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    if (tabId === undefined) return { ok: false };
    const started = (await chrome.storage.session.get(pickKey(tabId)))[pickKey(tabId)] as number | undefined;
    if (!started || Date.now() - started > PICK_TTL_MS) return { ok: false };
    const fp = ElementFingerprintSchema.parse(target);
    await chrome.storage.session.remove(pickKey(tabId));
    // The step moves to the page the element was picked on (the top page's URL rule).
    const top = ctx.sender.tab?.url;
    const url = top ? stepUrlRule(top) : undefined;
    await chrome.storage.session.set({ [pickResultKey(tabId)]: { target: fp, title: withoutLinks(title), url, at: Date.now() } });
    const msg: ContentPush = { type: 'pick.stop' };
    await chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
    return { ok: true };
  },
};
