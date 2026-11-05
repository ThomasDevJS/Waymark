/**
 * Starts the HD voice download (D51), from a click on an extension page: Settings and the HD voice
 * offer (D140) share this one path. The click asks for the download hosts; the service worker
 * releases them when the download ends. Never call it from a content script (it can't ask).
 */
import { send } from '../core/messaging/client';
import { HD_HOST_PATTERNS, type HdStatus } from '../core/voice/hd';

export const HD_HOSTS_REFUSED = 'HD voice needs to reach Hugging Face and GitHub once, to download the voice.';

export type HdStart = { ok: true; status: HdStatus } | { ok: false; message: string };

export async function startHdDownload(): Promise<HdStart> {
  const before = await Promise.all(HD_HOST_PATTERNS.map((p) => chrome.permissions.contains({ origins: [p] })));
  const granted = await chrome.permissions.request({ origins: [...HD_HOST_PATTERNS] }).catch(() => false);
  if (!granted) return { ok: false, message: HD_HOSTS_REFUSED };
  const added = HD_HOST_PATTERNS.filter((_, i) => !before[i]);
  return { ok: true, status: await send('hd.enable', { added }) };
}
