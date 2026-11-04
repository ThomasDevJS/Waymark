/**
 * Discovery and sharing in the service worker (SPEC: Discovery and hints; Sharing and storage):
 * toolbar badge, guides for a page, launcher and deep links, pack import, the library URL.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { Guide } from '../core/model/schema';
import { badgeText, guideMatchesUrl, guidesForUrl } from '../core/discovery/match';
import { duplicateGuide, findConflicts, packOrigins, parsePack, planImport, type Choice } from '../core/sharing/pack';
import { allGuides, guideKey, listGuides, writeGuides } from '../core/storage/guides';
import { enqueue } from '../core/storage/queue';
import { originToMatchPattern } from '../core/url/url';
import { GuideSchema } from '../core/model/schema';
import { getRecording } from './recording';
import { startRunInTab } from './runs';

// ---------- toolbar badge ----------

/** Badge for a tab: REC while it records (it takes precedence), else the number of guides for its page. */
export async function updateBadge(tabId: number, url?: string): Promise<void> {
  try {
    const rec = await getRecording();
    const recording = !!rec && rec.tabIds.includes(tabId);
    let count = 0;
    if (!recording) {
      const pageUrl = url ?? (await chrome.tabs.get(tabId).catch(() => undefined))?.url;
      if (pageUrl) count = guidesForUrl(await listGuides(), pageUrl).length;
    }
    await chrome.action.setBadgeText({ tabId, text: badgeText(recording, count) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: recording ? '#c62828' : '#2f5fd0' });
  } catch {
    // tab gone
  }
}

/** After guides change: every tab whose URL Waymark can read (granted sites) gets a fresh count. */
export async function updateAllBadges(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((t) => t.id !== undefined && t.url).map((t) => updateBadge(t.id!, t.url)));
}

// ---------- settings: launcher per site, pending Allow, library ----------

const SITE_KEY = 'siteSettings';
const PENDING_KEY = 'pendingAllow';
const LIBRARY_KEY = 'library';
export const LIBRARY_ALARM = 'library-refresh';
export const LIBRARY_PERIOD_MIN = 6 * 60;

interface SiteSettings {
  launcher?: boolean;
}

async function siteSettings(): Promise<Record<string, SiteSettings>> {
  return ((await chrome.storage.local.get(SITE_KEY))[SITE_KEY] as Record<string, SiteSettings> | undefined) ?? {};
}

export interface LibraryState {
  url: string | null;
  lastFetchAt: string | null;
  lastError: string | null;
  count: number;
}

async function libraryState(): Promise<LibraryState> {
  return ((await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY] as LibraryState | undefined) ?? { url: null, lastFetchAt: null, lastError: null, count: 0 };
}

async function setLibraryState(patch: Partial<LibraryState>): Promise<LibraryState> {
  const next = { ...(await libraryState()), ...patch };
  await chrome.storage.local.set({ [LIBRARY_KEY]: next });
  return next;
}

/** Sites from imported guides that are not granted yet: the panel offers one Allow request. */
async function addPendingAllow(origins: string[]): Promise<void> {
  const cur = ((await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as string[] | undefined) ?? [];
  const missing: string[] = [];
  for (const o of origins) {
    if (cur.includes(o)) continue;
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: [originToMatchPattern(o)] });
    } catch {
      granted = false;
    }
    if (!granted) missing.push(o);
  }
  if (missing.length) await chrome.storage.local.set({ [PENDING_KEY]: [...cur, ...missing].sort() });
}

async function pendingAllow(): Promise<string[]> {
  const cur = ((await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as string[] | undefined) ?? [];
  const still: string[] = [];
  for (const o of cur) if (!(await chrome.permissions.contains({ origins: [originToMatchPattern(o)] }).catch(() => false))) still.push(o);
  if (still.length !== cur.length) await chrome.storage.local.set({ [PENDING_KEY]: still });
  return still;
}

/** http(s) only; plain http only for local development hosts. */
export function libraryUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Fetches the library pack and replaces the library guides (SPEC: Sharing, "v1: library URL"). */
export async function refreshLibrary(): Promise<LibraryState> {
  const state = await libraryState();
  if (!state.url) return state;
  try {
    const res = await fetch(state.url, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`The library answered ${res.status}.`);
    const text = await res.text();
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const pack = parsed.pack;
    await enqueue(async () => {
      const plan = planImport(await allGuides(), pack, {}, 'library');
      await writeGuides(plan.write, plan.remove);
    });
    await addPendingAllow(packOrigins(pack.guides));
    await updateAllBadges();
    return setLibraryState({ lastFetchAt: new Date().toISOString(), lastError: null, count: pack.guides.length });
  } catch (e) {
    return setLibraryState({ lastFetchAt: new Date().toISOString(), lastError: e instanceof Error ? e.message : String(e) });
  }
}

export async function scheduleLibrary(): Promise<void> {
  const { url } = await libraryState();
  if (url) await chrome.alarms.create(LIBRARY_ALARM, { periodInMinutes: LIBRARY_PERIOD_MIN, delayInMinutes: 1 });
  else await chrome.alarms.clear(LIBRARY_ALARM);
}

async function loadGuide(id: string): Promise<Guide | null> {
  const p = GuideSchema.safeParse((await chrome.storage.local.get(guideKey(id)))[guideKey(id)]);
  return p.success ? p.data : null;
}

/** The guide, if it may be offered to this content script: its origin must be one of the guide's. */
async function guideForSender(id: string, ctx: HandlerContext): Promise<Guide | null> {
  const g = await loadGuide(id);
  const origin = ctx.sender.origin;
  if (!g || !origin || !g.appOrigins.includes(origin)) return null;
  return g;
}

export const discoveryHandlers: Handlers = {
  // ---- extension pages ----
  'guide.all': async () => ({ guides: await allGuides() }),
  'guide.delete': async ({ id }) => {
    await enqueue(() => writeGuides([], [id]));
    await updateAllBadges();
    return { ok: true };
  },
  'guide.duplicate': async ({ id }) => {
    const g = await loadGuide(id);
    if (!g) throw new Error('Guide not found.');
    const copy = duplicateGuide(g);
    await enqueue(() => writeGuides([copy], []));
    await updateAllBadges();
    return copy;
  },
  'pack.check': async ({ text }) => {
    const parsed = parsePack(text);
    if (!parsed.ok) return { ok: false, error: parsed.error, guides: [], conflicts: [], origins: [] };
    return {
      ok: true,
      guides: parsed.pack.guides.map((g) => ({ id: g.id, title: g.title, steps: g.steps.length })),
      conflicts: findConflicts(await allGuides(), parsed.pack),
      origins: packOrigins(parsed.pack.guides),
    };
  },
  'pack.import': async ({ text, choices }) => {
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const pack = parsed.pack;
    const plan = await enqueue(async () => {
      const p = planImport(await allGuides(), pack, choices as Record<string, Choice>, 'local');
      await writeGuides(p.write, []);
      return p;
    });
    await addPendingAllow(packOrigins(pack.guides));
    await updateAllBadges();
    return { imported: plan.write.length, skipped: plan.skipped };
  },
  'allow.pending': async () => ({ origins: await pendingAllow() }),
  'allow.dismiss': async () => {
    await chrome.storage.local.set({ [PENDING_KEY]: [] });
    return { ok: true };
  },
  'site.settings.get': async ({ origin }) => ({ launcher: !!(await siteSettings())[origin]?.launcher }),
  'site.settings.set': async ({ origin, launcher }) => {
    await enqueue(async () => {
      const all = await siteSettings();
      all[origin] = { ...all[origin], launcher };
      await chrome.storage.local.set({ [SITE_KEY]: all });
    });
    return { launcher };
  },
  'library.get': () => libraryState(),
  'library.set': async ({ url }) => {
    if (url !== null && !libraryUrlAllowed(url)) throw new Error('The library URL must start with https://');
    await setLibraryState({ url, lastError: null, ...(url === null ? { count: 0, lastFetchAt: null } : {}) });
    if (url === null) {
      // Unsubscribing removes the library guides.
      await enqueue(async () => writeGuides([], (await allGuides()).filter((g) => g.source === 'library').map((g) => g.id)));
      await updateAllBadges();
    }
    await scheduleLibrary();
    return url === null ? libraryState() : refreshLibrary();
  },
  'library.refresh': () => refreshLibrary(),

  // ---- content scripts (data only for their own origin, SPEC: Security) ----
  'guide.forPage': async (_p, ctx: HandlerContext) => {
    const url = ctx.sender.tab?.url;
    const origin = ctx.sender.origin;
    if (!url || !origin || ctx.frameId !== 0) return { guides: [], launcher: false };
    const guides = (await listGuides()).filter((g) => g.appOrigins.includes(origin) && guideMatchesUrl(g, url)).map((g) => ({ id: g.id, title: g.title }));
    const launcher = !!(await siteSettings())[origin]?.launcher;
    return { guides, launcher };
  },
  'launcher.start': async ({ guideId, openStart }, ctx: HandlerContext) => {
    if (ctx.tabId === undefined || ctx.frameId !== 0 || !(await guideForSender(guideId, ctx))) throw new Error('Guide not available here.');
    return startRunInTab(ctx.tabId, guideId, !!openStart);
  },
  'deeplink.check': async ({ guideId }, ctx: HandlerContext) => {
    if (ctx.frameId !== 0) return { guide: null };
    const g = await guideForSender(guideId, ctx);
    return { guide: g ? { id: g.id, title: g.title } : null };
  },
};
