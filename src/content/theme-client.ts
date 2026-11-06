/** The overlay follows the theme chosen in Settings (D200): asked once, then told of changes. */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { isThemeChoice } from '../core/theme';
import { setOverlayTheme } from './overlay/host';

export function startThemeClient(): () => void {
  send('ui.theme.get', {})
    .then((r) => isThemeChoice(r.theme) && setOverlayTheme(r.theme))
    .catch(() => undefined);
  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const m = msg as ContentPush;
    if (m?.type === 'ui.theme' && isThemeChoice(m.payload?.theme)) setOverlayTheme(m.payload.theme);
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // context gone
    }
  };
}
