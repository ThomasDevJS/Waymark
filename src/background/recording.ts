/** Service worker side of recording (SPEC: Recorder, "State"; Discovery, REC badge). */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { ContentPush } from '../core/messaging/protocol';
import { enqueue } from '../core/storage/queue';
import { siteAllowed } from './site-access';
import { getGuides, writeGuide } from '../core/storage/guides';
import { updateAllBadges, updateBadge } from './discovery';
import type { Step } from '../core/model/schema';
import {
  addOrigin,
  applyOp,
  eventTime,
  isRecordingTab,
  navigationStep,
  noteStep,
  startRecording,
  toGuide,
  viewOf,
  type RecordingState,
  urlKey,
} from '../core/recorder/session';
import { originToMatchPattern, routedPath, stepUrlRule } from '../core/url/url';
import { loadProfiles, urlOptionsFor } from '../core/storage/profiles';
import { withoutLinks } from '../core/text/markdown';
import { dlog } from './debug';
import { redactUrl } from '../core/debug/log';
import { addShotsFlagInQueue, probeShot, queueShot, shotStep, shotsOn, sweepShots, type ShotOutcome } from './shots';
import { planInsertStop } from '../core/recorder/insert';
import { newId } from '../core/model/ids';

const KEY = 'recording';

export async function getRecording(): Promise<RecordingState | null> {
  return ((await chrome.storage.session.get(KEY))[KEY] as RecordingState | undefined) ?? null;
}

async function setRecording(state: RecordingState | null): Promise<void> {
  if (state) await chrome.storage.session.set({ [KEY]: state });
  else await chrome.storage.session.remove(KEY);
}

/**
 * Read-modify-write of the recording, serialized through the write queue. With `writeIf`, the
 * state is written back only when the result says something changed (refused steps cost no write).
 */
function mutate<T>(fn: (state: RecordingState | null) => Promise<T> | T, writeIf?: (out: T) => boolean): Promise<T> {
  return enqueue(async () => {
    const state = await getRecording();
    const out = await fn(state);
    if (!writeIf || writeIf(out)) await setRecording(state);
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

const RECORDER_KINDS = new Set<Step['kind']>(['hover', 'click', 'input', 'select', 'check', 'submit']);

/** Keeps only what the recorder produces: no notes, voice text or placement from a page. */
export function recorderStep(step: Step): Step | null {
  if (!RECORDER_KINDS.has(step.kind) || !step.target) return null;
  const out: Step = { id: step.id, kind: step.kind, title: withoutLinks(step.title), url: step.url, target: step.target, advance: 'action' };
  if (step.flags?.length) out.flags = step.flags;
  return out;
}

/**
 * Per-step check from content scripts. The raw permission is enough here: a fetch-only site (D80)
 * has no content script, and this runs on every recorded step, so it stays one call.
 */
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

/** Hints remembered per recording: one per tab and site is enough (D186). */
const MAX_HINTED = 50;

/**
 * What a screenshot's outcome changes in the recording (D186): a refusal shows the one-click
 * hint in the panel, and once per tab and site in the page's REC pill; a stored image hides it.
 */
export async function onShotOutcome(tabId: number, origin: string, outcome: ShotOutcome): Promise<void> {
  if (outcome === 'skipped') return;
  const key = `${tabId}|${origin}`;
  const out = await mutate(
    (st) => {
      if (!st?.shots) return { changed: false, first: false };
      if (outcome === 'saved') {
        if (!st.shotHint) return { changed: false, first: false };
        st.shotHint = false;
        return { changed: true, first: false };
      }
      const first = !(st.shotHinted ?? []).includes(key);
      const changed = first || !st.shotHint;
      st.shotHint = true;
      if (first) st.shotHinted = [...(st.shotHinted ?? []), key].slice(-MAX_HINTED);
      return { changed, first };
    },
    (r) => r.changed,
  );
  if (out.first) {
    const msg: ContentPush = { type: 'shot.hint' };
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);
  }
}

export const recordingHandlers: Handlers = {
  'rec.state': () => getRecording(),
  'rec.start': async ({ tabId, title, shots, insertInto }) => {
    const url = await tabUrl(tabId);
    if (!url || !/^https?:/.test(url)) throw new Error('Open a web page to record on.');
    if (!(await siteAllowed(new URL(url).origin))) throw new Error('Allow Waymark on this site first.');
    // Into an existing guide (D202): one of your own guides, from a page of its sites.
    const into = insertInto ? (await getGuides([insertInto.guideId]))[0] : undefined;
    if (insertInto) {
      if (!into) throw new Error('Guide not found.');
      if (into.source === 'library') throw new Error('Team guides are read-only. Use Duplicate in the list to edit your own copy.');
      if (!into.appOrigins.includes(new URL(url).origin)) throw new Error('Open a page of this guide’s site in this tab first.');
    }
    const intoShots = into ? await shotsOn(into.id) : false;
    const state = await enqueue(async () => {
      if (await getRecording()) throw new Error('A recording is already running.');
      // The site's own profile: a recording makes the author's own guide (D213).
      const s = startRecording(into ? into.title : title, tabId, url, Date.now(), urlOptionsFor(await loadProfiles(), url, 'local'));
      if (into && insertInto) {
        // The guide's own id: its screenshots, if on, are keyed to it already (D185).
        s.guideId = into.id;
        s.insert = { at: Math.min(insertInto.at, into.steps.length), baseRevisionId: into.revisionId };
        if (intoShots) s.shots = true;
      } else if (shots) s.shots = true;
      await setRecording(s);
      return s;
    });
    await broadcast(state, state.tabIds);
    // Does Chrome allow screenshots on this tab? Only after a click on Waymark's icon or a
    // shortcut there (D181). The probe's picture is dropped at once; recording doesn't wait.
    if (state.shots) void probeShot(tabId).then((o) => onShotOutcome(tabId, new URL(url).origin, o));
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
      // The site's own profile shapes the note's page rule, as for every recorded step (D213 review).
      const step = noteStep(st, title, note, url, urlOptionsFor(await loadProfiles(), url, 'local'));
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
      if (st.insert) {
        // Into the guide it was started from, if that is still the version the editor showed and
        // the steps fit (D202). Otherwise nothing is lost: the steps become a guide of their own.
        const cur = (await getGuides([st.guideId]))[0];
        const plan = planInsertStop(cur, { title: st.title, steps: st.steps, appOrigins: st.appOrigins, insert: st.insert });
        if (plan.kind === 'insert') {
          await writeGuide(plan.guide);
          await setRecording(null);
          return { state: st, guide: plan.guide, added: { count: plan.count, at: plan.at } };
        }
        if (plan.kind === 'nothing') {
          await setRecording(null);
          return { state: st, guide: cur ?? toGuide(st), added: { count: 0, at: st.insert.at } };
        }
        // Images taken meanwhile are keyed to the first guide: the sweep after Stop removes them
        // (review of D202); the new guide has no screenshots.
        st.guideId = newId();
        st.title = plan.title;
        const aside = toGuide(st);
        await writeGuide(aside);
        await setRecording(null);
        return { state: st, guide: aside, aside: true };
      }
      const guide = toGuide(st);
      await writeGuide(guide);
      // The guide's screenshot setting is written in the same queued task, so no sweep can see
      // its images without it (D185).
      if (st.shots) await addShotsFlagInQueue(guide.id);
      await setRecording(null);
      return { state: st, guide };
    });
    if (!result) return null;
    await broadcast(null, result.state.tabIds);
    await updateAllBadges();
    // Images of steps taken back with Undo go now.
    if (result.state.shots) void sweepShots();
    return {
      guideId: result.guide.id,
      title: result.guide.title,
      steps: result.guide.steps,
      ...('added' in result && result.added ? { added: result.added } : {}),
      ...('aside' in result && result.aside ? { aside: true } : {}),
    };
  },
  'rec.step': async (op, ctx: HandlerContext) => {
    const tabId = ctx.tabId;
    const top = ctx.sender.tab?.url;
    const clean = recorderStep(op.step);
    if (!clean) {
      dlog('rec', 'step.refused', { tab: tabId, frame: ctx.frameId, o: ctx.sender.origin ?? null }, { why: 'not a recorder step', kind: op.step.kind });
      return { ok: false };
    }
    // Queued at once, in arrival order, so a step is never overtaken by the route report it
    // caused or by a Stop sent after it; the site check runs inside the queue (D67).
    const result = await mutate(async (st) => {
      // Debug log entries are written here, inside the queued callback, so logging cannot change
      // the order of steps and route reports (D67).
      const where = { tab: tabId, frame: ctx.frameId, o: ctx.sender.origin ?? null };
      const refused = (why: string) => {
        dlog('rec', 'step.refused', where, { why, kind: clean.kind });
        return false;
      };
      // A script left in a page whose site access was revoked must not keep recording.
      if (!ctx.sender.origin || !(await siteGranted(ctx.sender.origin))) return refused('site access is gone');
      // Content scripts may send rec.step only while their tab is recording (SPEC: Security).
      if (!st || !isRecordingTab(st, tabId)) return refused('this tab is not recording');
      if (st.status !== 'recording') return refused('recording is paused');
      const step = clean;
      // Steps belong to the page: a step recorded in a frame gets the top page's URL rule.
      if (ctx.frameId !== 0 && top) step.url = stepUrlRule(top, urlOptionsFor(await loadProfiles(), top, 'local'));
      if (top) addOrigin(st, new URL(top).origin);
      // The action's own time, not when this message got here: a route report it caused may
      // have been handled first (D67).
      const before = st.steps.length;
      const ok = applyOp(st, op.op === 'add' ? { op: 'add', step } : { op: 'replace', stepId: op.stepId, step }, eventTime(op.at), tabId);
      dlog('rec', ok ? (op.op === 'add' ? 'step.added' : 'step.replaced') : 'step.refused', where, () => ({
        ...(ok ? {} : { why: op.op === 'replace' ? 'not the last step' : st.steps.length >= 500 ? 'the 500-step limit' : 'duplicate step id' }),
        n: st.steps.length,
        kind: step.kind,
        title: step.title.replace(/\*\*/g, ''),
        flags: step.flags ?? [],
        page: step.url.value,
        // A navigate step this action caused had been added first: taken back (D67).
        tookBackNav: op.op === 'add' && ok ? Math.max(0, before + 1 - st.steps.length) : 0,
      }));
      return ok;
    }, (ok) => ok);
    if (result) {
      const st = await getRecording();
      await broadcast(st, st?.tabIds ?? []);
      // A screenshot of the step, if asked for (D180). Queued, never awaited: recording and the
      // page's click never wait for it.
      // Steps in frames too: the element is placed through its frames (D191).
      if (st?.shots && tabId !== undefined && ctx.sender.origin && shotStep(clean, ctx.frameId)) {
        const origin = ctx.sender.origin;
        const frameId = ctx.frameId;
        const guideId = st.guideId;
        const stepId = op.op === 'add' ? clean.id : op.stepId;
        void queueShot({
          tabId,
          origin,
          guideId,
          step: { id: stepId, target: clean.target },
          frameId,
          ...(top ? { page: top } : {}),
          // Still wanted: the step is in the recording, or in the guide it was saved as.
          stillWanted: async () => {
            const now = await getRecording();
            if (now?.guideId === guideId) return !!now.shots && now.steps.some((x) => x.id === stepId);
            const [g] = await getGuides([guideId]);
            return !!g?.steps.some((x) => x.id === stepId) && (await shotsOn(guideId));
          },
        }).then((o) => onShotOutcome(tabId, origin, o));
      }
    }
    return { ok: result };
  },
};

/** Route reports from a recording tab's top frame can become navigate steps. */
export async function onRouteReport(
  payload: { url: string; via: string; navigationType?: string | undefined; title?: string | undefined; timeOrigin?: number | undefined; at?: number | undefined },
  ctx: HandlerContext,
): Promise<ReturnType<typeof viewOf>> {
  const tabId = ctx.tabId;
  let changed = false;
  // Hash routing and kept query keys of the site's own profile shape the step's URL rule (D213).
  const profiles = await loadProfiles();
  const state = await mutate((st) => {
    if (!st || !isRecordingTab(st, tabId) || ctx.frameId !== 0) return st;
    const key = String(tabId);
    if (payload.via === 'leaving') {
      st.leavingAt = { ...(st.leavingAt ?? {}), [key]: eventTime(payload.at) };
      return st;
    }
    const routeOpts = urlOptionsFor(profiles, payload.url, 'local');
    const prevRoute = st.lastRoute?.[key];
    const prevUrl = st.lastUrl[key];
    // Navigation start: when the old page started leaving, or the new document's time origin
    // (which survives even when the "leaving" report was lost).
    const marks = [st.leavingAt?.[key], payload.timeOrigin].filter((x): x is number => typeof x === 'number');
    const leavingAt = payload.via === 'load' && marks.length ? Math.min(...marks) : undefined;
    const at = eventTime(payload.at);
    const step = navigationStep(
      st,
      {
        url: payload.url,
        prevUrl,
        navigationType: payload.navigationType,
        title: payload.title,
        now: at,
        ...(leavingAt !== undefined ? { leavingAt } : {}),
        ...(prevRoute !== undefined ? { prevRoute } : {}),
      },
      routeOpts,
    );
    if (payload.via === 'load' && st.leavingAt) delete st.leavingAt[key];
    st.lastUrl[key] = urlKey(payload.url);
    // With kept query keys, the page as its URL rule reads it, to tell a change of a kept key (D213 review).
    if (routeOpts.keepQueryKeys?.length) {
      try {
        st.lastRoute = { ...(st.lastRoute ?? {}), [key]: routedPath(new URL(payload.url), routeOpts) };
      } catch {
        // not a URL: nothing to compare next time
      }
    }
    if (payload.via !== 'leaving') {
      dlog('rec', step ? 'nav.step' : 'nav.no-step', { tab: tabId, frame: 0, o: ctx.sender.origin ?? null }, () => ({
        via: payload.via,
        nav: payload.navigationType ?? null,
        url: redactUrl(payload.url),
        ...(step ? { page: step.url.value } : { why: !prevUrl ? 'first page of the tab' : 'same page, a replace, a query-only change, or within 1.5 s of the last action' }),
        sinceAction: at - st.lastActionAt,
      }));
    }
    if (step) {
      st.steps.push(step);
      // A click reported after this, but done just before the navigation, takes it back (D67).
      st.pendingNav = [...(st.pendingNav ?? []), { stepId: step.id, at: leavingAt ?? at, tabId }].slice(-5);
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
