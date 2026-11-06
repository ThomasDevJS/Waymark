/** Settings: the theme, System (the default), Light or Dark (D200). */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { ThemeChoice } from '../../core/theme';

const theme = signal<ThemeChoice | null>(null);
const error = signal<string | null>(null);

const CHOICES: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Light or dark, as your computer is set.' },
  { value: 'light', label: 'Light', hint: 'Always light.' },
  { value: 'dark', label: 'Dark', hint: 'Always dark.' },
];

async function choose(value: ThemeChoice) {
  const before = theme.value;
  theme.value = value;
  error.value = null;
  try {
    theme.value = (await send('ui.theme.set', { theme: value })).theme;
  } catch {
    theme.value = before;
    error.value = 'The theme could not be saved. Try again.';
  }
}

export function AppearanceSetting() {
  useEffect(() => {
    void send('ui.theme.get', {}).then(
      (r) => (theme.value = r.theme),
      () => (theme.value = 'system'),
    );
  }, []);
  const v = theme.value;
  return (
    <div class="stack-sm">
      <fieldset class="formats" data-testid="theme" aria-describedby="theme-hint">
        <legend class="label">Theme</legend>
        {CHOICES.map((c) => (
          <label key={c.value} class={`format lift pressable${v === c.value ? ' on' : ''}`}>
            <input type="radio" name="theme" value={c.value} checked={v === c.value} disabled={v === null} data-testid={`theme-${c.value}`} onChange={() => void choose(c.value)} />
            <span class="stack-sm">
              <strong>{c.label}</strong>
              <span class="xsmall muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p class="hint" id="theme-hint">
        For the side panel, Settings, the tutorials, and what Waymark shows on your pages.
      </p>
      <p class="small status-text warn" role="status" data-testid="theme-error">
        {error.value ?? ''}
      </p>
    </div>
  );
}
