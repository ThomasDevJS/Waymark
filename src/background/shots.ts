/**
 * Step screenshots for the printable how-to (D180–D188), service worker side.
 *
 * - Off by default, on per guide (`shots:guides` in storage.local, or the recording's own flag).
 * - Captured with chrome.tabs.captureVisibleTab, which Chrome allows only on a tab where the user
 *   invoked Waymark (activeTab: the toolbar icon, Alt+W, Alt+R); a site permission alone is not
 *   enough (D181). A refused capture records nothing and shows a hint (D186).
 * - Queued and rate-limited, never awaited by recording. Every frame Waymark runs in hides
 *   Waymark's UI and field text for the capture and says where its embedded documents are; the
 *   step's own frame measures its element at that moment (content/shots.ts, D191, D192).
 * - The whole visible tab is stored (at most 1600 px wide, WebP under 250 KB, D190) in IndexedDB
 *   (store.ts), with the element's box and the hash of the element it shows. Embedded documents
 *   whose frame could not hide its fields are painted over in the stored image.
 */
import type { ContentPush } from '../core/messaging/protocol';
import type { Guide, Step } from '../core/model/schema';
import { enqueue } from '../core/storage/queue';
import { getGuides, listGuides } from '../core/storage/guides';
import { liveTrash, TRASH_KEY, UNDO_MS, RESTORE_GRACE_MS } from '../core/storage/trash';
import { fitUnderCap, layoutFrames, placeElement, planImage, QUALITY, resolveChildren, type Box, type FrameReport, type ImagePlan } from '../core/shots/place';
import { asFrameReport } from '../core/shots/report';
import { framesKey, type FrameMap } from '../core/frames/registry';
import { sessionKV } from '../core/storage/session-kv';
import { createCallSpacer, createCaptureQueue, DROPPED, type Dropped } from '../core/shots/rate';
import { asIdList, SHOTS_ON_KEY, shotFits, staleFlags, staleShots, stepHashes, targetHash, type ShotRef } from '../core/shots/lifecycle';
import { allShotRefs, deleteGuideShots, deleteShots, putShot, SHOT_VERSION, shotKey, shotRefsOf } from '../core/shots/store';
import { dlog } from './debug';

export type ShotOutcome = 'saved' | 'refused' | 'skipped';

const queue = createCaptureQueue();

/** Alarm that removes a deleted guide's images once its Undo window is over (D185). */
export const SHOTS_ALARM = 'shots-sweep';

/** How long frames have to hide Waymark's UI and field text; a late frame is painted over. */
export const HIDE_WAIT_MS = 800;
/** Frames asked to hide per capture (the registry keeps 64 per tab, D48). */
export const MAX_HIDE_FRAMES = 80;
/** How long frames have to confirm, after the capture, that nothing changed. */
export const CHECK_WAIT_MS = 400;
/** Chrome allows about two captureVisibleTab calls a second: calls are kept this far apart (D183). */
export const CALL_GAP_MS = 550;
/** Colour painted over embedded documents, whose fields the top page can't hide (D183). */
export const FRAME_MASK = '#d5d9e0';

// ---------- the per-guide setting ----------

async function onList(): Promise<string[]> {
  return asIdList((await chrome.storage.local.get(SHOTS_ON_KEY))[SHOTS_ON_KEY]);
}

export async function shotsOn(guideId: string): Promise<boolean> {
  return (await onList()).includes(guideId);
}

/** Adds a guide to the "screenshots on" list. Call only from inside a queued task (rec.stop). */
export async function addShotsFlagInQueue(guideId: string): Promise<void> {
  const cur = await onList();
  if (!cur.includes(guideId)) await chrome.storage.local.set({ [SHOTS_ON_KEY]: [...cur, guideId] });
}

/** Turns screenshots on or off for guides. Off deletes their images. Call outside the queue. */
export async function setShotsOn(guideIds: string[], on: boolean): Promise<void> {
  if (!guideIds.length) return;
  await enqueue(async () => {
    const cur = await onList();
    const next = on ? [...new Set([...cur, ...guideIds])] : cur.filter((id) => !guideIds.includes(id));
    if (next.length === cur.length && next.every((x, i) => x === cur[i])) return;
    if (next.length) await chrome.storage.local.set({ [SHOTS_ON_KEY]: next });
    else await chrome.storage.local.remove(SHOTS_ON_KEY);
  });
  if (!on) await deleteGuideShots(guideIds).catch(() => undefined);
}

/**
 * The guide's setting and the steps whose image still shows their element in the saved guide:
 * ids only, never images. The export offers only these (D188). `old`: those of them that are
 * 0.5.0 close-ups, which the editor offers to capture again (D196).
 */
export async function shotsStatus(guideId: string): Promise<{ on: boolean; stepIds: string[]; old: string[] }> {
  const on = await shotsOn(guideId);
  if (!on) return { on, stepIds: [], old: [] };
  const [g] = await getGuides([guideId]);
  if (!g) return { on, stepIds: [], old: [] };
  const steps = stepHashes(g);
  const refs = (await shotRefsOf(guideId).catch(() => [] as ShotRef[])).filter((r) => shotFits(r, steps));
  return { on, stepIds: refs.map((r) => r.stepId), old: refs.filter((r) => r.old).map((r) => r.stepId) };
}

// ---------- capture ----------

const originOf = (url: string | undefined): string | null => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/** Chrome's refusal when Waymark was not invoked on the tab (D181). */
export const isActiveTabRefusal = (e: unknown) => /activeTab|all_urls/i.test(String(e instanceof Error ? e.message : e));
/** Chrome's refusal when captures come too fast (its MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND). */
export const isQuotaRefusal = (e: unknown) => /MAX_CAPTURE|per second|quota/i.test(String(e instanceof Error ? e.message : e));

/** Origin, path and hash: the page a step belongs to (hash routes are pages too). */
export const pageOf = (url: string | undefined): string | null => {
  try {
    if (!url) return null;
    const u = new URL(url);
    return u.origin + u.pathname + u.hash;
  } catch {
    return null;
  }
};

/** True when the tab still shows the page of the step (or the origin, without a page). */
function stillThere(url: string | undefined, origin: string | null, page: string | null): boolean {
  if (page) return pageOf(url) === page;
  return !origin || originOf(url) === origin;
}

/** Waits until the next captureVisibleTab call keeps Chrome's rate: calls, not jobs, are spaced. */
const captureSlot = createCallSpacer(CALL_GAP_MS);

async function captureTab(windowId: number): Promise<string> {
  await captureSlot();
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
  } catch (e) {
    if (!isQuotaRefusal(e)) throw e;
    // Too fast after all: once more, a second later.
    await new Promise((r) => setTimeout(r, 1000));
    await captureSlot();
    return chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
  }
}

/** What the frames said at a capture, by frameId (only frames that answered in time). */
type Reports = Map<number, FrameReport>;

type Grab = { dataUrl: string; reports: Reports } | { refused: true } | { skipped: string };

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

/**
 * Asks every frame Waymark may run in to hide its UI and field text (D192): the top frame, the
 * step's frame and every frame the registry knows in the tab, all at once, each with its own
 * random token. Only the step's frame is asked for the element. A frame that does not answer in
 * time is not in the result: it is painted over.
 */
export async function hideFrames(
  send: (frameId: number, msg: ContentPush) => Promise<unknown>,
  known: number[],
  stepFrameId: number,
  stepId: string,
  waitMs = HIDE_WAIT_MS,
): Promise<{ reports: Reports; tokens: Map<number, string> }> {
  const deadline = Date.now() + waitMs;
  const ids = [...new Set([0, stepFrameId, ...known])].filter((id) => Number.isInteger(id) && id >= 0).slice(0, MAX_HIDE_FRAMES);
  const tokens = new Map(ids.map((id) => [id, crypto.randomUUID()] as const));
  const answers = await Promise.all(
    ids.map(async (frameId) => {
      const msg: ContentPush = { type: 'shot.hide', payload: { token: tokens.get(frameId)!, ...(frameId === stepFrameId ? { stepId } : {}) } };
      return [frameId, asFrameReport(await withTimeout(send(frameId, msg), Math.max(0, deadline - Date.now())))] as const;
    }),
  );
  const reports: Reports = new Map();
  for (const [id, r] of answers) if (r) reports.set(id, r);
  return { reports, tokens };
}

/** After the capture: every frame that answered must still be hidden as it reported (D192). */
export async function stillHidden(send: (frameId: number, msg: ContentPush) => Promise<unknown>, tokens: ReadonlyMap<number, string>, frames: Iterable<number>, waitMs = CHECK_WAIT_MS): Promise<boolean> {
  const ok = await Promise.all([...frames].map(async (id) => (await withTimeout(send(id, { type: 'shot.check', payload: { token: tokens.get(id) ?? '' } }), waitMs)) === true));
  return ok.every(Boolean);
}

/** The tab's frame registry (D45, D152): which frame is which iframe of which parent. */
async function frameLinks(tabId: number): Promise<FrameMap> {
  return (await sessionKV.get<FrameMap>(framesKey(tabId)).catch(() => undefined)) ?? {};
}

/** Frames of the tab the registry knows, newest first. */
const knownFrames = (links: FrameMap): number[] =>
  Object.keys(links)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => b - a);

/**
 * Captures the visible part of `tabId`, if it is the tab showing in its window and still on the
 * step's page. With a step, Waymark's UI and field text are hidden in every frame meanwhile, and
 * the step's frame measures its element.
 */
async function grab(tabId: number, origin: string | null, step: { id: string; frameId: number } | null, page: string | null = null): Promise<Grab> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { skipped: 'the tab is gone' };
  }
  if (!tab.active) return { skipped: 'the tab is not the one showing' };
  if (!stillThere(tab.url, origin, page)) return { skipped: 'the page changed after the action' };
  let reports: Reports = new Map();
  let tokens = new Map<number, string>();
  const send = (frameId: number, msg: ContentPush) => chrome.tabs.sendMessage(tabId, msg, { frameId });
  if (step) {
    const links = await frameLinks(tabId);
    const hidden = await hideFrames(send, knownFrames(links), step.frameId, step.id);
    tokens = hidden.tokens;
    reports = resolveChildren(hidden.reports, links, tokens);
  }
  try {
    // No answer from the top frame: Waymark's UI may still be showing there.
    if (step && !reports.has(0)) return { skipped: 'the page did not hide Waymark in time' };
    if (step && [...reports.values()].some((r) => r.more)) return { skipped: 'a frame could not vouch for its picture (moving, or too many embedded frames)' };
    if (step && !reports.get(step.frameId)?.rect) return { skipped: 'the element is gone or hidden' };
    const dataUrl = await captureTab(tab.windowId);
    // The window may have switched to another tab meanwhile: then the picture is of that tab.
    const after = await chrome.tabs.get(tabId).catch(() => null);
    if (!after?.active || !stillThere(after.url, origin, page)) return { skipped: 'the tab or page changed during the capture' };
    // A frame restored, navigated, or grew a new shadow root or iframe meanwhile: the picture may show field text.
    if (step && !(await stillHidden(send, tokens, reports.keys()))) return { skipped: MOVED };
    return { dataUrl, reports };
  } catch (e) {
    return isActiveTabRefusal(e) ? { refused: true } : { skipped: 'the capture failed' };
  } finally {
    if (step) {
      // To every frame of the tab, also those that answered late.
      const msg: ContentPush = { type: 'shot.show' };
      chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
    }
  }
}

interface Encoded {
  blob: Blob;
  size: number;
  plan: ImagePlan;
}

/** Where the element and the masks are, from the frames' answers (D191); null: not visible. */
export function placeShot(reports: ReadonlyMap<number, FrameReport>, stepFrameId: number): { el: Box; masks: Box[]; dpr: number } | null {
  const layout = layoutFrames(reports);
  if (!layout) return null;
  const el = placeElement(layout, stepFrameId, reports.get(stepFrameId)?.rect ?? null);
  return el ? { el, masks: layout.masks, dpr: reports.get(0)!.dpr } : null;
}

/** The whole visible tab, embedded documents painted over, as WebP under the size cap (D190). */
async function encodePage(dataUrl: string, placed: { el: Box; masks: Box[]; dpr: number }): Promise<Encoded | null> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const out = await fitUnderCap<Encoded>(async (scale) => {
      const plan = planImage(placed.el, placed.masks, bmp.width, bmp.height, placed.dpr, scale);
      if (!plan) return null;
      const canvas = new OffscreenCanvas(plan.dw, plan.dh);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, plan.sw, plan.sh, 0, 0, plan.dw, plan.dh);
      ctx.fillStyle = FRAME_MASK;
      for (const f of plan.masks) ctx.fillRect(f.x, f.y, f.w, f.h);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
      if (blob.type !== 'image/webp') return null;
      return { blob, size: blob.size, plan };
    });
    return out?.image ?? null;
  } finally {
    bmp.close();
  }
}

export interface ShootRequest {
  tabId: number;
  origin: string;
  guideId: string;
  /** The step: its id names the element the page remembered, its target is hashed. */
  step: Pick<Step, 'id' | 'target'>;
  /** The frame the step's element is in (0: the top page). */
  frameId: number;
  /** The page (URL) of the step: no capture once the tab shows another page. */
  page?: string;
  /** Checked just before the image is stored, and again after: the step must still be wanted. */
  stillWanted?: () => Promise<boolean>;
}

/** Why a capture is retried once: the page moved between the measurement and the picture. */
export const MOVED = 'a frame changed during the capture';

async function shoot(r: ShootRequest): Promise<{ outcome: ShotOutcome; why?: string }> {
  let g = await grab(r.tabId, r.origin, { id: r.step.id, frameId: r.frameId }, pageOf(r.page));
  // Once more (the call spacer keeps Chrome's rate): a scroll or a click often settles quickly.
  if ('skipped' in g && g.skipped === MOVED) g = await grab(r.tabId, r.origin, { id: r.step.id, frameId: r.frameId }, pageOf(r.page));
  if ('refused' in g) return { outcome: 'refused' };
  if ('skipped' in g) return { outcome: 'skipped', why: g.skipped };
  const placed = placeShot(g.reports, r.frameId);
  if (!placed) return { outcome: 'skipped', why: 'the element is not visible in the tab, or its frame could not be placed' };
  const enc = await encodePage(g.dataUrl, placed);
  if (!enc) return { outcome: 'skipped', why: 'the element was not in the captured area, or the image was too big' };
  if (r.stillWanted && !(await r.stillWanted())) return { outcome: 'skipped', why: 'the step or its screenshot setting is gone' };
  const ref = { guideId: r.guideId, stepId: r.step.id };
  await putShot({ key: shotKey(ref.guideId, ref.stepId), ...ref, v: SHOT_VERSION, blob: enc.blob, w: enc.plan.dw, h: enc.plan.dh, box: enc.plan.box, px: Math.round(enc.plan.s * 1000) / 1000, t: targetHash(r.step.target), at: Date.now() });
  // Turned off (or the step taken back) while the image was being stored: it goes again.
  if (r.stillWanted && !(await r.stillWanted())) {
    await deleteShots([ref]);
    return { outcome: 'skipped', why: 'the step or its screenshot setting is gone' };
  }
  dlog('rec', 'shot.saved', { tab: r.tabId, frame: r.frameId, o: r.origin }, { kb: Math.round(enc.size / 1024), w: enc.plan.dw, h: enc.plan.dh, masks: enc.plan.masks.length });
  return { outcome: 'saved' };
}

/** Queues a screenshot. Resolves when it is stored, refused or skipped; nobody has to wait. */
export async function queueShot(r: ShootRequest): Promise<ShotOutcome> {
  const out = await queue.push(() => shoot(r).catch(() => ({ outcome: 'skipped' as const, why: 'the capture failed' })));
  if (out === DROPPED) {
    dlog('rec', 'shot.skipped', { tab: r.tabId, frame: 0, o: r.origin }, { why: 'steps came faster than Chrome allows screenshots' });
    return 'skipped';
  }
  const res = out as Exclude<typeof out, Dropped>;
  if (res.outcome === 'skipped') dlog('rec', 'shot.skipped', { tab: r.tabId, frame: 0, o: r.origin }, { why: res.why ?? '' });
  if (res.outcome === 'refused') dlog('rec', 'shot.refused', { tab: r.tabId, frame: 0, o: r.origin }, { why: 'Waymark was not invoked on this tab (activeTab)' });
  return res.outcome;
}

/**
 * A capture made only to learn whether Chrome allows one on this tab (recording start, D186).
 * The picture is dropped at once: it is never decoded or stored.
 */
export async function probeShot(tabId: number): Promise<ShotOutcome> {
  const out = await queue.push(() => grab(tabId, null, null));
  if (out === DROPPED) return 'skipped';
  const g = out as Grab;
  return 'refused' in g ? 'refused' : 'skipped' in g ? 'skipped' : 'saved';
}

/** A step that can have a screenshot: an element, in any frame Waymark runs in (D191). */
export function shotStep(step: Pick<Step, 'target'>, frameId: number | undefined): frameId is number {
  return typeof frameId === 'number' && frameId >= 0 && !!step.target;
}

// ---------- lifecycle (D185) ----------

/** After a save: images of deleted steps, and of steps that now point at another element, go. */
export async function pruneAfterSave(next: Pick<Guide, 'id' | 'steps'>): Promise<void> {
  try {
    const steps = stepHashes(next);
    const refs = await shotRefsOf(next.id);
    await deleteShots(refs.filter((r) => !shotFits(r, steps)));
  } catch {
    // best effort: the sweep tries again
  }
}

/**
 * Removes images and settings nothing needs any more: guides that are gone (once out of the Undo
 * trash), guides turned off, steps no longer in their guide or pointing at another element. Runs
 * at browser start and install, on the trash's purge points, on an alarm after each delete, and
 * after a recording stops. It decides inside the write queue, so it sees guides, trash, the
 * recording and the setting as one consistent state (a stop or a restore is never half seen).
 */
export async function sweepShots(): Promise<void> {
  try {
    const decision = await enqueue(async () => {
      const [refs, on] = await Promise.all([allShotRefs(), onList()]);
      if (!refs.length && !on.length) return null;
      const exists = new Set((await listGuides()).map((e) => e.id));
      const withShots = [...new Set(refs.map((k) => k.guideId))].filter((id) => exists.has(id));
      const guides = new Map((await getGuides(withShots)).map((g) => [g.id, stepHashes(g)]));
      const trash = liveTrash((await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY], Date.now());
      // A recording's guide is not stored yet; its images are kept (session storage, see recording.ts).
      const rec = (await chrome.storage.session.get('recording'))['recording'] as { guideId?: unknown } | undefined;
      const keep = new Set([...trash.map((e) => e.guide.id), ...(typeof rec?.guideId === 'string' ? [rec.guideId] : [])]);
      return { stale: staleShots(refs, { guides, on: new Set(on), keep }), flags: staleFlags(on, exists, keep) };
    });
    if (!decision) return;
    await deleteShots(decision.stale);
    if (decision.flags.length) await setShotsOn(decision.flags, false);
  } catch {
    // best effort: the next sweep tries again
  }
}

/** After a delete: sweep once the Undo window (plus slack) is over. Alarms fire after 30 s at the soonest. */
export async function scheduleShotSweep(): Promise<void> {
  if (!(await onList()).length) return;
  await chrome.alarms.create(SHOTS_ALARM, { delayInMinutes: Math.max(0.5, (UNDO_MS + RESTORE_GRACE_MS) / 60_000) });
}

/** An import or the team library replaced these guides: their images belong to the old content. */
export async function dropShotsOf(guideIds: string[]): Promise<void> {
  const on = await onList();
  const hit = guideIds.filter((id) => on.includes(id));
  if (hit.length) await setShotsOn(hit, false);
}
