/**
 * Discovery and sharing in the service worker (SPEC: Discovery and hints; Sharing and storage):
 * toolbar badge, guides for a page, launcher and deep links, pack import, the library URL.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { Guide } from '../core/model/schema';
import { badgeText, guideMatchesUrl, guidesForUrl } from '../core/discovery/match';
import { duplicateGuide, findConflicts, packOrigins, parsePack, planImport, type Choice } from '../core/sharing/pack';
import { getGuides, guideKey, listGuides, writeGuides, type GuideIndexEntry } from '../core/storage/guides';
import { enqueue } from '../core/storage/queue';
import { originToMatchPattern } from '../core/url/url';
import { GuideSchema, isSiteOrigin } from '../core/model/schema';
import { getRecording } from './recording';
import { startRunInTab } from './runs';

// ---------- toolbar badge ----------

/** What every badge needs from storage, read once per pass. */
async function badgeInputs(): Promise<{ index: GuideIndexEntry[] }> {
  return { index: await listGuides() };
}

async function writeBadge(tabId: number, url: string | undefined, index: GuideIndexEntry[], recordingTabs: number[]): Promise<void> {
  const recording = recordingTabs.includes(tabId);
  const count = !recording && url ? guidesForUrl(index, url).length : 0;
  await chrome.action.setBadgeText({ tabId, text: badgeText(recording, count) });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: recording ? '#c62828' : '#2f5fd0' });
}

/** Recording may have started while the counts were computed: REC always wins. */
async function recordingTabsNow(): Promise<number[]> {
  return (await getRecording())?.tabIds ?? [];
}

/** Badge for a tab: REC while it records (it takes precedence), else the number of guides for its page. */
export async function updateBadge(tabId: number, url?: string): Promise<void> {
  try {
    // A tab whose URL Waymark can no longer read (access removed) gets no count.
    const pageUrl = url ?? (await chrome.tabs.get(tabId).catch(() => undefined))?.url;
    const { index } = await badgeInputs();
    await writeBadge(tabId, pageUrl, index, await recordingTabsNow());
  } catch {
    // tab gone
  }
}

/**
 * After guides change: every tab whose URL Waymark can read (granted sites) gets a fresh count.
 * The index is read once and the recording state once more just before writing (D49).
 */
export async function updateAllBadges(): Promise<void> {
  try {
    const [tabs, { index }] = await Promise.all([chrome.tabs.query({}), badgeInputs()]);
    const rec = await recordingTabsNow();
    // Tabs without a readable URL (not granted) are cleared too, e.g. after access is removed.
    await Promise.all(
      tabs
        .filter((t) => t.id !== undefined)
        .map((t) => (t.url ? writeBadge(t.id!, t.url, index, rec) : chrome.action.setBadgeText({ tabId: t.id!, text: '' })).catch(() => undefined)),
    );
  } catch {
    // Badges are best effort: a failed pass never fails the write that triggered it.
  }
}

// ---------- settings: launcher per site, pending Allow, library ----------

const SITE_KEY = 'siteSettings';
const PENDING_KEY = 'pendingAllow';
const DISMISSED_KEY = 'dismissedAllow';
/** Sites the Allow banner can list at once; each is shown by name and can be unticked (D48). */
export const MAX_PENDING_ALLOW = 50;

async function grantedOrigin(o: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originToMatchPattern(o)] });
  } catch {
    return true; // not a usable origin: never offer it
  }
}
const LIBRARY_KEY = 'library';
export const LIBRARY_ALARM = 'library-refresh';
export const LIBRARY_PERIOD_MIN = 6 * 60;

interface SiteSettings {
  launcher?: boolean;
}

function ownSetting(all: Record<string, SiteSettings>, origin: string): SiteSettings | undefined {
  return Object.prototype.hasOwnProperty.call(all, origin) ? all[origin] : undefined;
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
  const dismissed = ((await chrome.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY] as string[] | undefined) ?? [];
  const missing: string[] = [];
  for (const o of origins) {
    // Only real site origins (schema-checked), and not ones the user already said "Not now" to.
    if (cur.includes(o) || dismissed.includes(o) || !isSiteOrigin(o)) continue;
    if (!(await grantedOrigin(o))) missing.push(o);
  }
  // A pack or library cannot queue an unbounded list of sites for the one Allow click (D48).
  const room = Math.max(0, MAX_PENDING_ALLOW - cur.length);
  if (missing.length && room) await chrome.storage.local.set({ [PENDING_KEY]: [...cur, ...missing.slice(0, room)].sort() });
}

async function pendingAllow(): Promise<string[]> {
  const cur = ((await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as string[] | undefined) ?? [];
  const still: string[] = [];
  for (const o of cur) if (isSiteOrigin(o) && !(await grantedOrigin(o))) still.push(o);
  if (still.length !== cur.length) await chrome.storage.local.set({ [PENDING_KEY]: still });
  return still;
}

export { libraryUrlAllowed } from '../core/sharing/library';
import { fetchLibraryText, libraryUrlAllowed } from '../core/sharing/library';

/** Fetches the library pack and replaces the library guides (SPEC: Sharing, "v1: library URL"). */
export async function refreshLibrary(): Promise<LibraryState> {
  const state = await libraryState();
  if (!state.url) return state;
  try {
    const text = await fetchLibraryText(state.url);
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const pack = parsed.pack;
    const applied = await enqueue(async () => {
      // The user may have unsubscribed or changed the URL while this fetch was running.
      if ((await libraryState()).url !== state.url) return false;
      const plan = planImport(await listGuides(), pack, {}, 'library');
      await writeGuides(plan.write, plan.remove);
      return true;
    });
    if (!applied) return libraryState();
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
  'guide.many': async ({ ids }) => ({ guides: await getGuides(ids) }),
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
      conflicts: findConflicts(await listGuides(), parsed.pack),
      origins: packOrigins(parsed.pack.guides),
    };
  },
  'pack.import': async ({ text, choices }) => {
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const pack = parsed.pack;
    const plan = await enqueue(async () => {
      const p = planImport(await listGuides(), pack, choices as Record<string, Choice>, 'local');
      await writeGuides(p.write, []);
      return p;
    });
    await addPendingAllow(packOrigins(pack.guides));
    await updateAllBadges();
    return { imported: plan.write.length, skipped: plan.skipped };
  },
  'allow.pending': async () => ({ origins: await pendingAllow() }),
  'allow.dismiss': async () => {
    await enqueue(async () => {
      const cur = ((await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as string[] | undefined) ?? [];
      const dismissed = ((await chrome.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY] as string[] | undefined) ?? [];
      const still: string[] = [];
      for (const o of cur) if (!(await grantedOrigin(o))) still.push(o);
      // "Not now" is remembered: library refreshes do not bring the banner back for these sites.
      await chrome.storage.local.set({ [PENDING_KEY]: [], [DISMISSED_KEY]: [...new Set([...dismissed, ...still])].slice(-200) });
    });
    return { ok: true };
  },
  'site.settings.get': async ({ origin }) => ({ launcher: isSiteOrigin(origin) && !!ownSetting(await siteSettings(), origin)?.launcher }),
  'site.settings.set': async ({ origin, launcher }) => {
    // Settings are keyed by origin: only real site origins, never "__proto__" or other junk (D48).
    if (!isSiteOrigin(origin)) throw new Error('Waymark works only on http and https sites.');
    await enqueue(async () => {
      const all = await siteSettings();
      all[origin] = { ...all[origin], launcher };
      await chrome.storage.local.set({ [SITE_KEY]: all });
    });
    return { launcher };
  },
  'library.get': () => libraryState(),
  'library.set': async ({ url }) => {
    if (url !== null && !libraryUrlAllowed(url)) throw new Error('The pack address must start with https://');
    await setLibraryState({ url, lastError: null, ...(url === null ? { count: 0, lastFetchAt: null } : {}) });
    if (url === null) {
      // Unsubscribing removes the library guides.
      await enqueue(async () => writeGuides([], (await listGuides()).filter((g) => g.source === 'library').map((g) => g.id)));
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
    const launcher = !!ownSetting(await siteSettings(), origin)?.launcher;
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
