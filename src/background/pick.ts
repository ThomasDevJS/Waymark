/**
 * The pending pick of a tab (Re-pick element, Add a step, and the player's Pick the right element,
 * D210): one key per tab in chrome.storage.session, so it survives a service worker restart.
 */
import type { ContentPush } from '../core/messaging/protocol';

export const PICK_TTL_MS = 120_000;
export const pickKey = (tabId: number) => `pick:${tabId}`;
export const pickResultKey = (tabId: number) => `pickResult:${tabId}`;

/** Ends a pending editor pick on a tab and lets the panel know (cancelled, timed out, page left). */
export async function endPick(tabId: number, cancelled: boolean): Promise<void> {
  const pending = (await chrome.storage.session.get(pickKey(tabId)))[pickKey(tabId)];
  await chrome.storage.session.remove(pickKey(tabId));
  if (cancelled && pending) await chrome.storage.session.set({ [pickResultKey(tabId)]: { cancelled: true, at: Date.now() } });
  const msg: ContentPush = { type: 'pick.stop' };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}
