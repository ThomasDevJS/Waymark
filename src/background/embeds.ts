/**
 * Sites embedded in a tab's frames (D155): each frame's report of its direct child frames, kept in
 * session storage per tab, and the ones Waymark may not run in yet for the side panel's Allow.
 * Reports are untrusted: cleaned, capped, and written only when they change.
 */
import { cleanEmbedOrigins, embedOrigins, withReport, type EmbedMap } from '../core/frames/embeds';
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

/** A new page in the tab (or the tab closed): its frames report again as they load. */
export function clearEmbeds(tabId: number): Promise<void> {
  return enqueue(() => chrome.storage.session.remove(embedsKey(tabId)));
}

/** Embedded sites in this tab that Waymark may not run in yet (not granted, or fetch-only, D80). */
export async function pendingEmbeds(tabId: number): Promise<string[]> {
  const out: string[] = [];
  for (const o of embedOrigins(await read(tabId))) if (!(await siteAllowed(o))) out.push(o);
  return out;
}
