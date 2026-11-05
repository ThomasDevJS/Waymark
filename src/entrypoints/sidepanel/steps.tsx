/** Small pieces shared by the recorder's live list and the editor's step cards (D91). */
import type { Step } from '../../core/model/schema';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

type Flag = NonNullable<Step['flags']>[number];

/** What each recorder warning means and what to do, in one line (docs/TESTING.md section 3). */
export const FLAG_HELP: Record<Flag, { label: string; help: string }> = {
  'low-confidence': { label: 'Hard to find', help: 'Not a button, link or field, so it may not be found again. Re-pick the real control, or delete the step.' },
  canvas: { label: 'Drawing area', help: 'A chart or map has nothing inside to point at. Use a note step instead.' },
  'closed-shadow': { label: 'Closed component', help: 'Waymark can’t see inside this component and used its outer box. Test the step.' },
};

export const KIND: Record<Step['kind'], { label: string; icon: IconName }> = {
  click: { label: 'Click', icon: 'crosshair' },
  input: { label: 'Type', icon: 'edit' },
  select: { label: 'Choose', icon: 'steps' },
  check: { label: 'Check', icon: 'check' },
  submit: { label: 'Submit', icon: 'upload' },
  navigate: { label: 'Go to page', icon: 'globe' },
  note: { label: 'Note', icon: 'note' },
};

/** Warning badges with their explanation inline, so authors don't need to hover. */
export function FlagNotes({ flags, testid }: { flags: Step['flags']; testid?: string }) {
  if (!flags?.length) return null;
  return (
    <div class="flag-notes" data-testid={testid}>
      {flags.map((f) => (
        <p key={f}>
          <span class="badge warn">
            <Icon name="warn" />
            {FLAG_HELP[f].label}
          </span>{' '}
          <span class="small muted">{FLAG_HELP[f].help}</span>
        </p>
      ))}
    </div>
  );
}
