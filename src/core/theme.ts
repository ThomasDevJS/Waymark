/**
 * The theme choice (D200): System (the default: follow the computer's light or dark setting),
 * Light or Dark. tokens.css reads `data-wm-theme` on the root (extension pages) or on the overlay
 * layer (pages Waymark runs on). Pure: no chrome.*; the content script imports it.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];
export const THEME_KEY = 'uiTheme';
/** A copy in the extension's localStorage, read synchronously so a page opens in its theme. */
export const THEME_CACHE_KEY = 'wm-theme';

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

/** Sets an element's theme: no attribute for System, so the system setting decides. */
export function applyTheme(el: Element, theme: ThemeChoice): void {
  if (theme === 'system') el.removeAttribute('data-wm-theme');
  else el.setAttribute('data-wm-theme', theme);
}

