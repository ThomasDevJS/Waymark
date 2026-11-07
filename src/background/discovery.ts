/**
 * Discovery and sharing in the service worker (SPEC: Discovery and hints; Sharing and storage):
 * toolbar badge, guides for a page, launcher and deep links, pack import, the library URL.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { Guide } from '../core/model/schema';
import { badgeText, guideMatchesUrl, guidesForUrl } from '../core/discovery/match';
import { forPageEntry, MAX_FOR_PAGE } from '../core/discovery/page-search';
import { ForPageResponseSchema } from '../core/messaging/protocol';
import { duplicateGuide, findConflicts, packOrigins, parsePack, planImport, type Choice } from '../core/sharing/pack';
import { getGuides, guideKey, listGuides, writeGuides, type GuideIndexEntry } from '../core/storage/guides';
import { enqueue } from '../core/storage/queue';
import { dropShotsOf, scheduleShotSweep, sweepShots } from './shots';
import { addToTrash, liveTrash, TRASH_KEY, trashIsStale, trashItems, UNDO_MS } from '../core/storage/trash';
import { lastCompletions } from '../core/storage/problems';
import { sweepStatsInQueue } from './stats';
import { originToMatchPattern } from '../core/url/url';
import { GuideSchema, isSiteOrigin } from '../core/model/schema';
import { getRecording } from './recording';
import { startRunInTab } from './runs';
import { linkOffer, linkOfferKey, type LinkOfferRecord } from './report-link';
import { LIBRARY_PROFILES_KEY, loadProfiles, LOCAL_PROFILES_KEY, MAX_PROFILES, readProfileMap, type Profiles } from '../core/storage/profiles';
import { sameProfile } from '../core/model/profile';
import { fetchOnlyPatterns, setFetchOnly, siteAllowed } from './site-access';

// ---------- toolbar badge ----------

/** What every badge needs from storage, read once per pass. */
async function badgeInputs(): Promise<{ index: GuideIndexEntry[]; profiles: Profiles }> {
  return { index: await listGuides(), profiles: await loadProfiles() };
}

async function writeBadge(tabId: number, url: string | undefined, index: GuideIndexEntry[], recordingTabs: number[], profiles: Profiles): Promise<void> {
  const recording = recordingTabs.includes(tabId);
  const count = !recording && url ? guidesForUrl(index, url, profiles).length : 0;
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
    const { index, profiles } = await badgeInputs();
    await writeBadge(tabId, pageUrl, index, await recordingTabsNow(), profiles);
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
    const [tabs, { index, profiles }] = await Promise.all([chrome.tabs.query({}), badgeInputs()]);
    const rec = await recordingTabsNow();
    // Tabs without a readable URL (not granted) are cleared too, e.g. after access is removed.
    await Promise.all(
      tabs
        .filter((t) => t.id !== undefined)
        .map((t) => (t.url ? writeBadge(t.id!, t.url, index, rec, profiles) : chrome.action.setBadgeText({ tabId: t.id!, text: '' })).catch(() => undefined)),
    );
  } catch {
    // Badges are best effort: a failed pass never fails the write that triggered it.
  }
}

// ---------- trash (D100) ----------

/**
 * Drops trash entries whose undo window is over, so a deleted guide does not stay on disk. Runs
 * when the panel asks (trash.list), at browser start and install, and on every delete or restore.
 */
export function purgeTrash(now = Date.now()) {
  return enqueue(async () => {
    const raw = (await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY];
    const live = liveTrash(raw, now);
    if (trashIsStale(raw, now)) {
      if (live.length) await chrome.storage.local.set({ [TRASH_KEY]: live });
      else await chrome.storage.local.remove(TRASH_KEY);
    }
    // Guides gone for good (out of the trash, however their entry left it) lose their play results (D211).
    await sweepStatsInQueue(now);
    return live;
  });
}

// ---------- settings: launcher per site, pending Allow, library ----------

const SITE_KEY = 'siteSettings';
const PENDING_KEY = 'pendingAllow';
const DISMISSED_KEY = 'dismissedAllow';
/** Sites the Allow banner can list at once; each is shown by name and can be unticked (D48). */
export const MAX_PENDING_ALLOW = 50;

async function grantedOrigin(o: string): Promise<boolean> {
  try {
    originToMatchPattern(o);
  } catch {
    return true; // not a usable origin: never offer it
  }
  // A library site granted only to fetch the pack is still offered (D80).
  return siteAllowed(o);
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
import { libraryAddress } from '../core/sharing/drive';

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
      // The library's site profiles replace the last ones (D213): its guides match the way it says.
      await chrome.storage.local.set({ [LIBRARY_PROFILES_KEY]: Object.fromEntries(parsed.profiles.map((p) => [p.origin, p])) });
      return plan.write.map((g) => g.id);
    });
    if (!applied) return libraryState();
    // Library guides replace what was there: no screenshots carry over (D185).
    await dropShotsOf(applied);
    await addPendingAllow(packOrigins(pack.guides));
    await updateAllBadges();
    return setLibraryState({ lastFetchAt: new Date().toISOString(), lastError: null, count: pack.guides.length });
  } catch (e) {
    return setLibraryState({ lastFetchAt: new Date().toISOString(), lastError: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * The refresh alarm. Without `fetchedNow` the first refresh comes a minute from now (browser start,
 * install); with it, the caller just fetched, so the next one waits a full period (D81).
 */
export async function scheduleLibrary(opts: { fetchedNow?: boolean } = {}): Promise<void> {
  const { url } = await libraryState();
  const delayInMinutes = opts.fetchedNow ? LIBRARY_PERIOD_MIN : 1;
  if (url) await chrome.alarms.create(LIBRARY_ALARM, { periodInMinutes: LIBRARY_PERIOD_MIN, delayInMinutes });
  else await chrome.alarms.clear(LIBRARY_ALARM);
}

/** Browser start and install: the alarm does the first fetch, a minute later; one fetch, not two (D81). */
export async function onBrowserStartLibrary(): Promise<void> {
  await cleanUpFetchOnly();
  await scheduleLibrary();
}

/**
 * Fetch-only sites that are not the current library's site (a subscription that never finished,
 * or one changed elsewhere) are given back (D80).
 */
export async function cleanUpFetchOnly(): Promise<void> {
  const { url } = await libraryState();
  let current: string | null = null;
  try {
    current = url ? originToMatchPattern(new URL(url).origin) : null;
  } catch {
    current = null;
  }
  for (const pattern of await fetchOnlyPatterns()) {
    if (pattern === current) continue;
    await releasePattern(pattern);
  }
}

/**
 * After an update from a version without fetch-only marks: a granted library site that no guide
 * uses was granted for fetching, so it is marked now (D80). A site a guide uses stays allowed.
 */
export async function migrateLibraryFetchOnly(): Promise<boolean> {
  const { url } = await libraryState();
  if (!url) return false;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  if (!(await chrome.permissions.contains({ origins: [originToMatchPattern(origin)] }))) return false;
  if ((await fetchOnlyPatterns()).includes(originToMatchPattern(origin))) return false;
  if ((await listGuides()).some((g) => g.appOrigins.includes(origin))) return false;
  await setFetchOnly(origin, true);
  return true;
}

/** Gives back a permission held only for fetching. The mark goes only once the permission is gone. */
async function releasePattern(pattern: string): Promise<void> {
  const removed = await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
  if (removed) await setFetchOnly(new URL(pattern.replace('/*', '')).origin, false);
}

/** A library site granted only for fetching is given back when the library moves away from it (D80). */
async function releaseFetchOnly(oldUrl: string | null, newUrl: string | null): Promise<void> {
  if (!oldUrl) return;
  let oldOrigin: string;
  try {
    oldOrigin = new URL(oldUrl).origin;
    if (newUrl && new URL(newUrl).origin === oldOrigin) return;
  } catch {
    return;
  }
  const pattern = originToMatchPattern(oldOrigin);
  if (!(await fetchOnlyPatterns()).includes(pattern)) return;
  await releasePattern(pattern);
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
  // The deleted guide goes to the trash in the same write, so Undo can bring it back (D100).
  'guide.delete': async ({ id }) => {
    const undoUntil = await enqueue(async () => {
      const [g] = await getGuides([id]);
      const now = Date.now();
      if (g) {
        const trash = addToTrash(liveTrash((await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY], now), [g], now);
        await chrome.storage.local.set({ [TRASH_KEY]: trash });
      }
      await writeGuides([], [id]);
      return g ? now + UNDO_MS : null;
    });
    await updateAllBadges();
    // Its screenshots stay while Undo is possible, then go (D185).
    if (undoUntil) await scheduleShotSweep();
    return { ok: true, undoUntil };
  },
  'guide.restore': async ({ id }) => {
    const out = await enqueue(async () => {
      const entries = liveTrash((await chrome.storage.local.get(TRASH_KEY))[TRASH_KEY], Date.now());
      const entry = entries.find((e) => e.guide.id === id);
      const rest = entries.filter((e) => e !== entry);
      await chrome.storage.local.set({ [TRASH_KEY]: rest });
      if (!entry) return { ok: false, error: 'It is too late to undo this delete.' };
      // A guide with the same id came back meanwhile (an import, a library refresh): keep it.
      if ((await listGuides()).some((g) => g.id === id)) return { ok: false, error: 'This guide is already back in the list.' };
      await writeGuides([entry.guide], []);
      return { ok: true };
    });
    if (out.ok) await updateAllBadges();
    return out;
  },
  'trash.list': async () => {
    const now = Date.now();
    const entries = await purgeTrash(now);
    void sweepShots();
    return { items: trashItems(entries).filter((i) => i.undoUntil > now) };
  },
  'completions.list': async () => ({ completed: await lastCompletions() }),
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
    const own = (await loadProfiles()).local;
    return {
      ok: true,
      guides: parsed.pack.guides.map((g) => ({ id: g.id, title: g.title, steps: g.steps.length })),
      conflicts: findConflicts(await listGuides(), parsed.pack),
      origins: packOrigins(parsed.pack.guides),
      profiles: parsed.profiles.map((p) => ({ origin: p.origin, status: !own[p.origin] ? ('new' as const) : sameProfile(own[p.origin]!, p) ? ('same' as const) : ('differs' as const) })),
      droppedProfiles: parsed.droppedProfiles,
    };
  },
  'pack.import': async ({ text, choices, profileChoices }) => {
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const pack = parsed.pack;
    let profilesWritten = 0;
    let capped = 0;
    const plan = await enqueue(async () => {
      const p = planImport(await listGuides(), pack, choices as Record<string, Choice>, 'local');
      await writeGuides(p.write, []);
      // The pack's site profiles become the learner's own (D213): a new site's at once; one that
      // differs from the own only when the user chose to replace it (keep is the default).
      if (parsed.profiles.length) {
        const map = readProfileMap((await chrome.storage.local.get(LOCAL_PROFILES_KEY))[LOCAL_PROFILES_KEY]);
        for (const prof of parsed.profiles) {
          const mine = map[prof.origin];
          if (mine && (sameProfile(mine, prof) || profileChoices?.[prof.origin] !== 'replace')) continue;
          // A new site's profile is added unless the user chose to skip it ('keep': what they have, nothing).
          if (!mine && profileChoices?.[prof.origin] === 'keep') continue;
          if (!mine && Object.keys(map).length >= MAX_PROFILES) {
            capped++;
            continue;
          }
          map[prof.origin] = prof;
          profilesWritten++;
        }
        if (profilesWritten) await chrome.storage.local.set({ [LOCAL_PROFILES_KEY]: map });
      }
      return p;
    });
    await addPendingAllow(packOrigins(pack.guides));
    await updateAllBadges();
    // A replaced guide's screenshots showed the old content (D185).
    await dropShotsOf(plan.write.map((g) => g.id));
    return { imported: plan.write.length, skipped: plan.skipped, profiles: profilesWritten, droppedProfiles: parsed.droppedProfiles + capped };
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
  // The launcher is on unless turned off for this site (D150); it shows only where the page has guides.
  'site.settings.get': async ({ origin }) => ({ launcher: isSiteOrigin(origin) && (ownSetting(await siteSettings(), origin)?.launcher ?? true) }),
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
  'library.set': async ({ url: input }) => {
    // A Google Drive share link is read through Drive's direct download (D157).
    const url = input === null ? null : libraryAddress(input);
    if (url !== null && !libraryUrlAllowed(url)) throw new Error('The pack address must start with https://');
    const before = (await libraryState()).url;
    await setLibraryState({ url, lastError: null, ...(url === null ? { count: 0, lastFetchAt: null } : {}) });
    if (url === null) {
      // Unsubscribing removes the library guides, and the library's site profiles (D213).
      await enqueue(async () => {
        await writeGuides([], (await listGuides()).filter((g) => g.source === 'library').map((g) => g.id));
        await chrome.storage.local.remove(LIBRARY_PROFILES_KEY);
      });
      await updateAllBadges();
    }
    await releaseFetchOnly(before, url);
    if (url === null) {
      await scheduleLibrary();
      return libraryState();
    }
    const state = await refreshLibrary();
    await scheduleLibrary({ fetchedNow: true });
    return state;
  },
  // Options marks the library site before asking for it, so the grant never registers the
  // content script there (D80); the panel clears the mark when the user allows the site.
  'site.fetchOnly': async ({ origin, on }) => {
    if (!isSiteOrigin(origin)) throw new Error('Not a site origin');
    // A site already granted is the user's (or already marked): never turn it into fetch-only.
    if (on && (await chrome.permissions.contains({ origins: [originToMatchPattern(origin)] }))) return { ok: true };
    await setFetchOnly(origin, on);
    return { ok: true };
  },
  'library.refresh': () => refreshLibrary(),

  // ---- content scripts (data only for their own origin, SPEC: Security) ----
  'guide.forPage': async (_p, ctx: HandlerContext) => {
    const url = ctx.sender.tab?.url;
    const origin = ctx.sender.origin;
    if (!url || !origin || ctx.frameId !== 0) return { guides: [], launcher: false };
    // Only this origin's guides that match this page, with their tags for the ? menu's search,
    // capped and checked against the schema (D171).
    const profiles = await loadProfiles();
    const guides = (await listGuides())
      .filter((g) => g.appOrigins.includes(origin) && guideMatchesUrl(g, url, profiles))
      .slice(0, MAX_FOR_PAGE)
      .map(forPageEntry);
    const launcher = ownSetting(await siteSettings(), origin)?.launcher ?? true; // on unless turned off (D150)
    return ForPageResponseSchema.parse({ guides, launcher });
  },
  'launcher.start': async ({ guideId, openStart, stepIndex }, ctx: HandlerContext) => {
    const g = ctx.tabId === undefined || ctx.frameId !== 0 ? null : await guideForSender(guideId, ctx);
    if (!g || ctx.tabId === undefined) throw new Error('Guide not available here.');
    // Start from step N of a report link (D212): a step the guide has.
    const at = stepIndex !== undefined && stepIndex < g.steps.length ? stepIndex : 0;
    const r = await startRunInTab(ctx.tabId, guideId, !!openStart, at);
    if (r.status === 'started') await chrome.storage.session.remove(linkOfferKey(ctx.tabId));
    return r;
  },
  'deeplink.check': async ({ guideId, step }, ctx: HandlerContext) => {
    if (ctx.frameId !== 0) return { guide: null };
    const g = await guideForSender(guideId, ctx);
    // A report link for a guide not available on this site says so, whether it is missing or another
    // site's: the page can't learn which guides of other sites exist (review of D212).
    if (!g) return step !== undefined ? { guide: null, notInLibrary: true } : { guide: null };
    const guide = { id: g.id, title: g.title };
    if (step === undefined) return { guide };
    const o = linkOffer(g, step);
    // The panel shows the same offer while this page is open.
    if (ctx.tabId !== undefined) {
      const rec: LinkOfferRecord = { guideId: g.id, title: g.title, offer: o.offer, stepIndex: o.stepIndex, step, origin: ctx.sender.origin!, at: Date.now() };
      await chrome.storage.session.set({ [linkOfferKey(ctx.tabId)]: rec });
    }
    return { guide, offer: o.offer, stepIndex: o.stepIndex };
  },
};
