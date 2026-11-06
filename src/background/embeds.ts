/**
 * Sites embedded in a tab's frames (D155): each frame's report of its direct child frames, kept in
 * session storage per tab, and the ones Waymark may not run in yet for the side panel's Allow.
 * Reports are untrusted: cleaned, capped, and written only when they change.
 */
import { cleanEmbedOrigins, embedOrigins, reportsSince, withReport, type EmbedMap } from '../core/frames/embeds';
import { isSiteOrigin } from '../core/model/schema';
import { enqueue } from '../core/storage/queue';
import { siteAllowed } from './site-access';

export const embedsKey = (tabId: number) => `embeds:${tabId}`;

async function read(tabId: number): Promise<EmbedMap> {
  const v = (await chrome.storage.session.get(embedsKey(tabId)))[embedsKey(tabId)];
  return v && typeof v === 'object' ? (v as EmbedMap) : {};
}

export function onEmbedsReport(tabId: number, frameId: number, origins: string[], now = Date.now()): Promise<void> {
  const clean = cleanEmbedOrigins(origins, isSiteOrigin);
  return enqueue(async () => {
    const next = withReport(await read(tabId), frameId, clean, now);
    if (next) await chrome.storage.session.set({ [embedsKey(tabId)]: next });
  });
}

/** The tab closed. */
export function clearEmbeds(tabId: number): Promise<void> {
  return enqueue(() => chrome.storage.session.remove(embedsKey(tabId)));
}

/**
 * The tab's top frame loaded a new page: reports older than that page belong to the frames of the
 * pages before it and go. Frames of the new page reported after it started, so they stay (frames
 * often load, and report, before the top page's load event). Per frame, never on a frame's own
 * navigation or an in-app route change (review of D155).
 */
export function pruneEmbedsBefore(tabId: number, since: number): Promise<void> {
  return enqueue(async () => {
    const next = reportsSince(await read(tabId), since);
    if (next) await chrome.storage.session.set({ [embedsKey(tabId)]: next });
  });
}

/** Embedded sites in this tab that Waymark may not run in yet (not granted, or fetch-only, D80). */
export async function pendingEmbeds(tabId: number): Promise<string[]> {
  const out: string[] = [];
  for (const o of embedOrigins(await read(tabId))) if (!(await siteAllowed(o))) out.push(o);
  return out;
}
