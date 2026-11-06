/**
 * Step screenshots for the printable how-to (D180–D188), service worker side.
 *
 * - Off by default, on per guide (`shots:guides` in storage.local, or the recording's own flag).
 * - Captured with chrome.tabs.captureVisibleTab, which Chrome allows only on a tab where the user
 *   invoked Waymark (activeTab: the toolbar icon, Alt+W, Alt+R); a site permission alone is not
 *   enough (D181). A refused capture records nothing and shows a hint (D186).
 * - Queued and rate-limited, never awaited by recording. The page hides Waymark's UI and field
 *   text for the capture and measures the step's element at that moment (content/shots.ts).
 * - Only a crop around the element is stored, as WebP under 60 KB, in IndexedDB (store.ts), with
 *   the hash of the element it shows.
 */
import type { ContentPush } from '../core/messaging/protocol';
import type { Guide, Step } from '../core/model/schema';
import { enqueue } from '../core/storage/queue';
import { getGuides, listGuides } from '../core/storage/guides';
import { liveTrash, TRASH_KEY, UNDO_MS, RESTORE_GRACE_MS } from '../core/storage/trash';
import { fitUnderCap, planCrop, QUALITY, type Box, type CropPlan, type ViewportRect } from '../core/shots/crop';
import { createCallSpacer, createCaptureQueue, DROPPED, type Dropped } from '../core/shots/rate';
import { asIdList, SHOTS_ON_KEY, shotFits, staleFlags, staleShots, stepHashes, targetHash, type ShotRef } from '../core/shots/lifecycle';
import { allShotRefs, deleteGuideShots, deleteShots, putShot, shotKey, shotRefsOf } from '../core/shots/store';
import { dlog } from './debug';

export type ShotOutcome = 'saved' | 'refused' | 'skipped';

const queue = createCaptureQueue();

/** Alarm that removes a deleted guide's images once its Undo window is over (D185). */
export const SHOTS_ALARM = 'shots-sweep';

/** How long the page has to hide Waymark's UI before the capture is given up. */
const HIDE_WAIT_MS = 800;
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
 * ids only, never images. The export offers only these (D188).
 */
export async function shotsStatus(guideId: string): Promise<{ on: boolean; stepIds: string[] }> {
  const on = await shotsOn(guideId);
  if (!on) return { on, stepIds: [] };
  const [g] = await getGuides([guideId]);
  if (!g) return { on, stepIds: [] };
  const steps = stepHashes(g);
  const refs = await shotRefsOf(guideId).catch(() => [] as ShotRef[]);
  return { on, stepIds: refs.filter((r) => shotFits(r, steps)).map((r) => r.stepId) };
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

/** The page as the top frame saw it at the capture (from shot.hide; untrusted, checked). */
export interface PageView {
  vw: number;
  vh: number;
  /** devicePixelRatio (with zoom): image pixels per CSS pixel in the capture. */
  dpr: number;
  /** The step's element now, in viewport coordinates; null: gone or hidden. */
  rect: Box | null;
  /** Embedded documents in view (their fields can't be hidden from the top page). */
  frames: Box[];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function asBox(v: unknown): Box | null {
  const b = v as Partial<Record<keyof Box, unknown>> | null | undefined;
  if (!b || !num(b.x) || !num(b.y) || !num(b.w) || !num(b.h) || b.w <= 0 || b.h <= 0) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/** The page's answer to shot.hide, checked: anything malformed means no picture. */
export function asPageView(ack: unknown): PageView | null {
  const a = ack as Partial<Record<keyof PageView, unknown>> | null | undefined;
  if (!a || !num(a.vw) || !num(a.vh) || !num(a.dpr) || a.vw <= 0 || a.vh <= 0 || a.dpr <= 0 || a.dpr > 10) return null;
  if (a.rect !== null && !asBox(a.rect)) return null;
  if (!Array.isArray(a.frames) || a.frames.length > 50) return null;
  const frames = a.frames.map(asBox);
  if (frames.some((f) => !f)) return null;
  return { vw: a.vw, vh: a.vh, dpr: a.dpr, rect: a.rect === null ? null : asBox(a.rect), frames: frames as Box[] };
}

/** The element's rect for the crop: viewport coordinates with the viewport size. */
export function toViewport(rect: Box, view: Pick<PageView, 'vw' | 'vh'>): ViewportRect {
  return { ...rect, vw: view.vw, vh: view.vh };
}

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

type Grab = { dataUrl: string; view: PageView | null } | { refused: true } | { skipped: string };

/**
 * Captures the visible part of `tabId`, if it is the tab showing in its window and still on the
 * step's page. With `stepId`, Waymark's UI and field text are hidden in the page meanwhile, and
 * the page measures the step's element.
 */
async function grab(tabId: number, origin: string | null, stepId: string | null, page: string | null = null): Promise<Grab> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { skipped: 'the tab is gone' };
  }
  if (!tab.active) return { skipped: 'the tab is not the one showing' };
  if (!stillThere(tab.url, origin, page)) return { skipped: 'the page changed after the action' };
  let view: PageView | null = null;
  const hide = stepId !== null;
  if (hide) {
    const msg: ContentPush = { type: 'shot.hide', payload: { stepId } };
    const ack: unknown = await Promise.race([chrome.tabs.sendMessage(tabId, msg).catch(() => undefined), new Promise((r) => setTimeout(r, HIDE_WAIT_MS))]);
    view = asPageView(ack);
  }
  try {
    // No answer: Waymark's UI may still be showing. No element: nothing to point at.
    if (hide && !view) return { skipped: 'the page did not hide Waymark in time' };
    if (hide && !view?.rect) return { skipped: 'the element is gone or hidden' };
    const dataUrl = await captureTab(tab.windowId);
    // The window may have switched to another tab meanwhile: then the picture is of that tab.
    const after = await chrome.tabs.get(tabId).catch(() => null);
    if (!after?.active || !stillThere(after.url, origin, page)) return { skipped: 'the tab or page changed during the capture' };
    return { dataUrl, view };
  } catch (e) {
    return isActiveTabRefusal(e) ? { refused: true } : { skipped: 'the capture failed' };
  } finally {
    if (hide) {
      const msg: ContentPush = { type: 'shot.show' };
      chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
    }
  }
}

interface Encoded {
  blob: Blob;
  size: number;
  plan: CropPlan;
}

/** Embedded documents in the stored image's pixels, rounded outward (D183). */
export function maskBoxes(frames: Box[], plan: Pick<CropPlan, 'sx' | 'sy' | 'sw' | 'dw'>, dpr: number): Box[] {
  const k = plan.dw / plan.sw;
  return frames.map((f) => {
    const x0 = Math.floor((f.x * dpr - plan.sx) * k);
    const y0 = Math.floor((f.y * dpr - plan.sy) * k);
    const x1 = Math.ceil(((f.x + f.w) * dpr - plan.sx) * k);
    const y1 = Math.ceil(((f.y + f.h) * dpr - plan.sy) * k);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

/** The crop around the element, iframes painted over, as WebP under the size cap (D182). */
async function encodeCrop(dataUrl: string, view: PageView & { rect: Box }): Promise<Encoded | null> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const rect = toViewport(view.rect, view);
    const out = await fitUnderCap<Encoded>(async (scale) => {
      const plan = planCrop(rect, bmp.width, bmp.height, scale, view.dpr);
      if (!plan) return null;
      const canvas = new OffscreenCanvas(plan.dw, plan.dh);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.dw, plan.dh);
      ctx.fillStyle = FRAME_MASK;
      for (const f of maskBoxes(view.frames, plan, view.dpr)) ctx.fillRect(f.x, f.y, f.w, f.h);
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
  /** The page (URL) of the step: no capture once the tab shows another page. */
  page?: string;
  /** Checked just before the image is stored, and again after: the step must still be wanted. */
  stillWanted?: () => Promise<boolean>;
}

async function shoot(r: ShootRequest): Promise<{ outcome: ShotOutcome; why?: string }> {
  const g = await grab(r.tabId, r.origin, r.step.id, pageOf(r.page));
  if ('refused' in g) return { outcome: 'refused' };
  if ('skipped' in g) return { outcome: 'skipped', why: g.skipped };
  const view = g.view;
  if (!view?.rect) return { outcome: 'skipped', why: 'the element is gone or hidden' };
  const enc = await encodeCrop(g.dataUrl, { ...view, rect: view.rect });
  if (!enc) return { outcome: 'skipped', why: 'the element was not on screen, or the image was too big' };
  if (r.stillWanted && !(await r.stillWanted())) return { outcome: 'skipped', why: 'the step or its screenshot setting is gone' };
  const ref = { guideId: r.guideId, stepId: r.step.id };
  await putShot({ key: shotKey(ref.guideId, ref.stepId), ...ref, blob: enc.blob, w: enc.plan.dw, h: enc.plan.dh, box: enc.plan.box, t: targetHash(r.step.target), at: Date.now() });
  // Turned off (or the step taken back) while the image was being stored: it goes again.
  if (r.stillWanted && !(await r.stillWanted())) {
    await deleteShots([ref]);
    return { outcome: 'skipped', why: 'the step or its screenshot setting is gone' };
  }
  dlog('rec', 'shot.saved', { tab: r.tabId, frame: 0, o: r.origin }, { kb: Math.round(enc.size / 1024), w: enc.plan.dw, h: enc.plan.dh });
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

/** A step that can have a screenshot: an element in the top frame. */
export function shotStep(step: Pick<Step, 'target'>, frameId: number | undefined): boolean {
  return frameId === 0 && !!step.target && !step.target.framePath.length;
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
