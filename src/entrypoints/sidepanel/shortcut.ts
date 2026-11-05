/**
 * The panel follows the recording shortcut (D105): after Stop it opens the editor, as the Stop
 * button does; a refusal (site not allowed, no web page) is shown. The panel may open just after
 * the outcome is written (the shortcut opens it), so a recent outcome is also read once at start.
 */
import { useEffect } from 'preact/hooks';
import { SHORTCUT_KEY, type ShortcutOutcome } from '../../core/storage/shortcut';
/** An outcome older than this was meant for an earlier panel. */
export const SHORTCUT_FRESH_MS = 5000;

const handled = new Set<number>();

export function useShortcutOutcome(kinds: ShortcutOutcome['kind'][], fn: (o: ShortcutOutcome) => void): void {
  useEffect(() => {
    const take = (o: ShortcutOutcome | undefined) => {
      if (!o || !kinds.includes(o.kind) || handled.has(o.at) || Date.now() - o.at > SHORTCUT_FRESH_MS) return;
      handled.add(o.at);
      fn(o);
    };
    void chrome.storage.session
      .get(SHORTCUT_KEY)
      .then((r) => take(r[SHORTCUT_KEY] as ShortcutOutcome | undefined))
      .catch(() => undefined);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && SHORTCUT_KEY in changes) take(changes[SHORTCUT_KEY]!.newValue as ShortcutOutcome | undefined);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
}
