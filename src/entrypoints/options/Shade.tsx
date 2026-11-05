/** Settings: the shade around a highlighted step, for every guide and tutorial (D144, D145). */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { LearnerShade } from '../../core/player/shade';
import { LEARNER_SHADE_CHOICES } from '../../ui/shadeCopy';

const shade = signal<LearnerShade | null>(null);

async function choose(value: LearnerShade) {
  shade.value = value;
  shade.value = (await send('player.settings.set', { patch: { shade: value } })).shade;
}

export function ShadeSetting() {
  useEffect(() => {
    void send('player.settings.get', {}).then((s) => (shade.value = s.shade));
  }, []);
  const v = shade.value;
  // The preview follows the choice; "Follow each guide" shows the usual shade.
  const preview = v === 'lighter' || v === 'darker' ? v : 'medium';
  return (
    <div class="shade-setting">
      <fieldset class="formats" data-testid="shade" aria-describedby="shade-hint">
        <legend class="label">Shade around the highlighted step</legend>
        {LEARNER_SHADE_CHOICES.map((c) => (
          <label key={c.value} class={`format lift pressable${v === c.value ? ' on' : ''}`}>
            <input type="radio" name="shade" value={c.value} checked={v === c.value} disabled={v === null} data-testid={`shade-${c.value}`} onChange={() => void choose(c.value)} />
            <span class="stack-sm">
              <strong>{c.label}</strong>
              <span class="xsmall muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div class="shade-preview" data-shade={preview} aria-hidden="true">
        <span class="shade-preview-line" />
        <span class="shade-preview-line short" />
        <span class="shade-preview-hole">Save</span>
        <span class="shade-preview-line" />
      </div>
      <p class="hint" id="shade-hint">
        Your choice here is used for every guide and tutorial. Only the rest of the page gets darker: the highlighted item is never shaded.
      </p>
    </div>
  );
}
