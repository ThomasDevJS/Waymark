/** The theme choice (D200), in storage.local; open pages Waymark runs on are told when it changes. */
import { isThemeChoice, THEME_KEY, type ThemeChoice } from '../core/theme';
import type { ContentPush } from '../core/messaging/protocol';

export async function getTheme(): Promise<ThemeChoice> {
  const v = (await chrome.storage.local.get(THEME_KEY))[THEME_KEY];
  return isThemeChoice(v) ? v : 'system';
}

export async function setTheme(theme: ThemeChoice): Promise<ThemeChoice> {
  await chrome.storage.local.set({ [THEME_KEY]: theme });
  const msg: ContentPush = { type: 'ui.theme', payload: { theme } };
  // Every tab: content scripts run only where Waymark is allowed; elsewhere this just fails.
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (t.id === undefined ? undefined : chrome.tabs.sendMessage(t.id, msg).catch(() => undefined))));
  return theme;
}
