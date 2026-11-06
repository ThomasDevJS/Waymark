/** D200: the theme choice, and the two dark blocks in tokens.css staying the same. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTheme, isThemeChoice } from '../../src/core/theme';

const css = readFileSync('src/ui/tokens.css', 'utf8');

describe('theme (D200)', () => {
  it('Dark from the system and Dark chosen in Settings use exactly the same values', () => {
    const fromSystem = css.indexOf(":root:not([data-wm-theme='light'])");
    const chosen = css.indexOf(":root[data-wm-theme='dark']");
    expect(fromSystem).toBeGreaterThan(0);
    expect(chosen).toBeGreaterThan(fromSystem);
    const a = css.slice(css.indexOf('{', fromSystem) + 1, css.indexOf('}', fromSystem));
    const b = css.slice(css.indexOf('{', chosen) + 1, css.indexOf('}', chosen));
    const norm = (x: string) => x.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(norm(a).length).toBeGreaterThan(20);
    expect(norm(b)).toEqual(norm(a));
    expect(norm(a)).toContain('color-scheme: dark');
  });

  it('System leaves the attribute off, so the computer decides; Light and Dark set it', () => {
    const el = document.createElement('div');
    applyTheme(el, 'dark');
    expect(el.getAttribute('data-wm-theme')).toBe('dark');
    applyTheme(el, 'light');
    expect(el.getAttribute('data-wm-theme')).toBe('light');
    applyTheme(el, 'system');
    expect(el.hasAttribute('data-wm-theme')).toBe(false);
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('neon')).toBe(false);
  });
});
