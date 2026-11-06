/** Extension pages follow the theme choice (D200). */
import { applyTheme, isThemeChoice, THEME_CACHE_KEY as CACHE_KEY, THEME_KEY } from '../core/theme';

/** Extension pages: apply the stored choice now (cached) and whenever it changes. */
export function watchPageTheme(root: Element = document.documentElement): () => void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (isThemeChoice(cached)) applyTheme(root, cached);
  } catch {
    // no localStorage: the stored value follows
  }
  const set = (v: unknown) => {
    const t = isThemeChoice(v) ? v : 'system';
    applyTheme(root, t);
    try {
      localStorage.setItem(CACHE_KEY, t);
    } catch {
      // ignore
    }
  };
  void chrome.storage.local.get(THEME_KEY).then((r) => set(r[THEME_KEY]), () => undefined);
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && THEME_KEY in changes) set(changes[THEME_KEY]!.newValue);
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
