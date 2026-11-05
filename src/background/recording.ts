/** Service worker side of recording (SPEC: Recorder, "State"; Discovery, REC badge). */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { enqueue } from '../core/storage/queue';
import { writeGuide } from '../core/storage/guides';
import { updateAllBadges, updateBadge } from './discovery';
import type { Step } from '../core/model/schema';
import {
  addOrigin,
  applyOp,
  isRecordingTab,
  navigationStep,
  noteStep,
  startRecording,
  toGuide,
  viewOf,
  type RecordingState,
  urlKey,
} from '../core/recorder/session';
import { originToMatchPattern, stepUrlRule } from '../core/url/url';
import { withoutLinks } from '../core/text/markdown';

const KEY = 'recording';

export async function getRecording(): Promise<RecordingState | null> {
  return ((await chrome.storage.session.get(KEY))[KEY] as RecordingState | undefined) ?? null;
}

async function setRecording(state: RecordingState | null): Promise<void> {
  if (state) await chrome.storage.session.set({ [KEY]: state });
  else await chrome.storage.session.remove(KEY);
}

/** Read-modify-write of the recording, serialized through the write queue. */
function mutate<T>(fn: (state: RecordingState | null) => Promise<T> | T): Promise<T> {
  return enqueue(async () => {
    const state = await getRecording();
    const out = await fn(state);
    await setRecording(state);
    return out;
  });
}

async function broadcast(state: RecordingState | null, tabIds: number[]): Promise<void> {
  const view = viewOf(state);
  const msg: ContentPush = { type: 'rec.changed', payload: view };
  await Promise.all(
    tabIds.map(async (tabId) => {
      // REC while recording; afterwards the guide count for the page comes back.
      await updateBadge(tabId);
      chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
    }),
  );
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

const RECORDER_KINDS = new Set<Step['kind']>(['click', 'input', 'select', 'check', 'submit']);

/** Keeps only what the recorder produces: no notes, voice text or placement from a page. */
export function recorderStep(step: Step): Step | null {
  if (!RECORDER_KINDS.has(step.kind) || !step.target) return null;
  const out: Step = { id: step.id, kind: step.kind, title: withoutLinks(step.title), url: step.url, target: step.target, advance: 'action' };
  if (step.flags?.length) out.flags = step.flags;
  return out;
}

async function siteGranted(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originToMatchPattern(origin)] });
  } catch {
    return false;
  }
}

/** After site access is revoked, recording stops in tabs on that site. */
export async function onSitesRevoked(): Promise<void> {
  const st = await getRecording();
  if (!st) return;
  const revoked: number[] = [];
  for (const tabId of st.tabIds) {
    const url = await tabUrl(tabId); // unreadable once access is gone
    let ok = false;
    try {
      ok = !!url && (await siteGranted(new URL(url).origin));
    } catch {
      ok = false;
    }
    if (!ok) revoked.push(tabId);
  }
  if (!revoked.length) return;
  await mutate((s2) => {
    if (s2) s2.tabIds = s2.tabIds.filter((t) => !revoked.includes(t));
    return s2;
  });
  await broadcast(null, revoked);
}

export const recordingHandlers: Handlers = {
  'rec.state': () => getRecording(),
  'rec.start': async ({ tabId, title }) => {
    const url = await tabUrl(tabId);
    if (!url || !/^https?:/.test(url)) throw new Error('Open a web page to record on.');
    if (!(await chrome.permissions.contains({ origins: [originToMatchPattern(url)] }))) throw new Error('Allow Waymark on this site first.');
    const state = await enqueue(async () => {
      if (await getRecording()) throw new Error('A recording is already running.');
      const s = startRecording(title, tabId, url);
      await setRecording(s);
      return s;
    });
    await broadcast(state, state.tabIds);
    return state;
  },
  'rec.pause': async () => {
    const s = await mutate((st) => {
      if (st) st.status = 'paused';
      return st;
    });
    if (s) await broadcast(s, s.tabIds);
    return s;
  },
  'rec.resume': async () => {
    const s = await mutate((st) => {
      if (st) st.status = 'recording';
      return st;
    });
    if (s) await broadcast(s, s.tabIds);
    return s;
  },
  'rec.undo': async () => {
    const s = await mutate((st) => {
      st?.steps.pop();
      return st;
    });
    if (s) await broadcast(s, s.tabIds);
    return s;
  },
  'rec.note': async ({ title, note }) => {
    const s = await mutate(async (st) => {
      if (!st) return st;
      const url = (await tabUrl(st.tabIds[0]!)) ?? st.startUrl;
      const step = noteStep(st, title, note, url);
      if (step) st.steps.push(step);
      return st;
    });
    if (s) await broadcast(s, s.tabIds);
    return s;
  },
  'rec.stop': async () => {
    // Validate and save inside the same queued task; the recording is cleared only after the
    // guide is safely stored, so a failed save never loses it.
    const result = await enqueue(async () => {
      const st = await getRecording();
      if (!st) return null;
      const guide = toGuide(st);
      await writeGuide(guide);
      await setRecording(null);
      return { state: st, guide };
    });
    if (!result) return null;
    await broadcast(null, result.state.tabIds);
    await updateAllBadges();
    return { guideId: result.guide.id, title: result.guide.title, steps: result.guide.steps };
  },
  'rec.step': async (op, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    const top = ctx.sender.tab?.url;
    // A script left in a page whose site access was revoked must not keep recording.
    if (!ctx.sender.origin || !(await siteGranted(ctx.sender.origin))) return { ok: false };
    const clean = recorderStep(op.step);
    if (!clean) return { ok: false };
    const result = await mutate((st) => {
      // Content scripts may send rec.step only while their tab is recording (SPEC: Security).
      if (!st || !isRecordingTab(st, tabId) || st.status !== 'recording') return false;
      const step = clean;
      // Steps belong to the page: a step recorded in a frame gets the top page's URL rule.
      if (ctx.frameId !== 0 && top) step.url = stepUrlRule(top);
      if (top) addOrigin(st, new URL(top).origin);
      return applyOp(st, op.op === 'add' ? { op: 'add', step } : { op: 'replace', stepId: op.stepId, step });
    });
    if (result) {
      const st = await getRecording();
      await broadcast(st, st?.tabIds ?? []);
    }
    return { ok: result };
  },
};

/** Route reports from a recording tab's top frame can become navigate steps. */
export async function onRouteReport(
  payload: { url: string; via: string; navigationType?: string | undefined; title?: string | undefined; timeOrigin?: number | undefined },
  ctx: HandlerContext,
): Promise<ReturnType<typeof viewOf>> {
  const tabId = ctx.tabId;
  let changed = false;
  const state = await mutate((st) => {
    if (!st || !isRecordingTab(st, tabId) || ctx.frameId !== 0) return st;
    const key = String(tabId);
    if (payload.via === 'leaving') {
      st.leavingAt = { ...(st.leavingAt ?? {}), [key]: Date.now() };
      return st;
    }
    const prevUrl = st.lastUrl[key];
    // Navigation start: when the old page started leaving, or the new document's time origin
    // (which survives even when the "leaving" report was lost).
    const marks = [st.leavingAt?.[key], payload.timeOrigin].filter((x): x is number => typeof x === 'number');
    const leavingAt = payload.via === 'load' && marks.length ? Math.min(...marks) : undefined;
    const step = navigationStep(st, {
      url: payload.url,
      prevUrl,
      navigationType: payload.navigationType,
      title: payload.title,
      ...(leavingAt !== undefined ? { leavingAt } : {}),
    });
    if (payload.via === 'load' && st.leavingAt) delete st.leavingAt[key];
    st.lastUrl[key] = urlKey(payload.url);
    if (step) {
      st.steps.push(step);
      changed = true;
    }
    return st;
  });
  if (changed && state) await broadcast(state, state.tabIds);
  return isRecordingTab(state, tabId) ? viewOf(state) : viewOf(null);
}

/** A click that opens a new tab carries the recording there (SPEC: Recorder, "Navigation"). */
export async function onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  const id = tab.id;
  const opener = tab.openerTabId;
  const s = await mutate((st) => {
    if (st && st.tabIds.includes(opener) && !st.tabIds.includes(id)) st.tabIds.push(id);
    return st;
  });
  if (s && s.tabIds.includes(id)) await broadcast(s, [id]);
}

export async function onTabRemoved(tabId: number): Promise<void> {
  await mutate((st) => {
    if (st) st.tabIds = st.tabIds.filter((t) => t !== tabId);
    return st;
  });
}
