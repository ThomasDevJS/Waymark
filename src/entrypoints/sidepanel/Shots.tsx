/**
 * The opt-in for step screenshots (D180): one switch, in the recorder and in the editor. Turning
 * it on first shows what screenshots can contain; nothing is captured until the author confirms.
 */
import { useState } from 'preact/hooks';
import { Icon } from '../../ui/Icon';

export const SHOTS_LABEL = 'Capture screenshots for the printable export';

/** What the author reads before screenshots are turned on (D180). */
export const SHOTS_NOTICE =
  'Screenshots can show customer data that is on the page, such as names, amounts or account numbers. Text inside fields is hidden. Screenshots stay on this computer and are used only in the printable how-to, where you can check each one and leave it out before you download.';

/** The one-click hint when Chrome refused a screenshot (D186). */
export const SHOT_HINT_PANEL = 'Screenshots need one click on the Waymark icon (or Alt+W) on this tab.';

export function ShotsSwitch({ on, onChange, testid, disabled, hint }: { on: boolean; onChange: (on: boolean) => void; testid: string; disabled?: boolean; hint: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div class="stack-sm">
      <label class="check small">
        <input
          type="checkbox"
          role="switch"
          class="switch"
          data-testid={testid}
          checked={on}
          disabled={disabled}
          aria-expanded={asking}
          onChange={(e) => {
            const want = (e.target as HTMLInputElement).checked;
            if (want && !on) {
              // Not on yet: the author confirms after reading the notice.
              (e.target as HTMLInputElement).checked = false;
              setAsking(true);
              return;
            }
            setAsking(false);
            onChange(want);
          }}
        />
        <span>
          {SHOTS_LABEL}
          <span class="hint block">{hint}</span>
        </span>
      </label>
      {asking && (
        <div class="banner warn" role="group" aria-label="Before you turn on screenshots" data-testid={`${testid}-notice`}>
          <Icon name="warn" />
          <div class="stack-sm">
            <span>{SHOTS_NOTICE}</span>
            <div class="row">
              <button
                type="button"
                class="sm primary"
                data-testid={`${testid}-confirm`}
                onClick={() => {
                  setAsking(false);
                  onChange(true);
                }}
              >
                Turn on screenshots
              </button>
              <button type="button" class="sm ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
