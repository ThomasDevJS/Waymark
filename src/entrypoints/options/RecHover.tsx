/** Settings: while recording, outline what a click will record (D153). On by default. */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';

const hover = signal<boolean | null>(null);
const error = signal<string | null>(null);

async function choose(value: boolean) {
  const before = hover.value;
  hover.value = value;
  error.value = null;
  try {
    hover.value = (await send('recorder.settings.set', { patch: { hover: value } })).hover;
  } catch {
    hover.value = before;
    error.value = 'The setting could not be saved. Try again.';
  }
}

export function RecHoverSetting() {
  useEffect(() => {
    void send('recorder.settings.get', {}).then(
      (s) => (hover.value = s.hover),
      () => (hover.value = true), // the default, so the switch never stays locked
    );
  }, []);
  return (
    <div class="stack-sm">
      <label class="check">
        <input
          type="checkbox"
          role="switch"
          class="switch"
          data-testid="rec-hover"
          checked={!!hover.value}
          disabled={hover.value === null}
          onChange={(e) => void choose((e.target as HTMLInputElement).checked)}
        />
        <span>
          While recording, outline what a click will record
          <span class="hint block">Orange means “hard to find”: the guide may not find it next time, so pick a button, link or field nearby. Red means it won’t be recorded.</span>
        </span>
      </label>
      <p class="small status-text warn" role="status" data-testid="rec-hover-error">
        {error.value ?? ''}
      </p>
    </div>
  );
}
