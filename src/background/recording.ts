/** Service worker side of recording (SPEC: Recorder, "State"; Discovery, REC badge). */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { enqueue } from '../core/storage/queue';
import { saveGuide } from '../core/storage/guides';
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
} from '../core/recorder/session';
import { originToMatchPattern, stepUrlRule } from '../core/url/url';

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
      try {
        await chrome.action.setBadgeText({ tabId, text: state ? 'REC' : '' });
        if (state) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#c62828' });
      } catch {
        // tab gone
      }
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
      st.steps.push(noteStep(st, title, note, url));
      return st;
    });
    if (s) await broadcast(s, s.tabIds);
    return s;
  },
  'rec.stop': async () => {
    const state = await enqueue(async () => {
      const st = await getRecording();
      await setRecording(null);
      return st;
    });
    if (!state) return null;
    await broadcast(null, state.tabIds);
    const guide = toGuide(state);
    await saveGuide(guide);
    return { guideId: guide.id, title: guide.title, steps: guide.steps };
  },
  'rec.step': async (op, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    const top = ctx.sender.tab?.url;
    const result = await mutate((st) => {
      // Content scripts may send rec.step only while their tab is recording (SPEC: Security).
      if (!st || !isRecordingTab(st, tabId) || st.status !== 'recording') return false;
      const step = { ...op.step };
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
  payload: { url: string; navigationType?: string | undefined; title?: string | undefined },
  ctx: HandlerContext,
): Promise<ReturnType<typeof viewOf>> {
  const tabId = ctx.tabId;
  let changed = false;
  const state = await mutate((st) => {
    if (!st || !isRecordingTab(st, tabId) || ctx.frameId !== 0) return st;
    const prevUrl = st.lastUrl[String(tabId)];
    const step = navigationStep(st, { url: payload.url, prevUrl, navigationType: payload.navigationType, title: payload.title });
    st.lastUrl[String(tabId)] = payload.url;
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
