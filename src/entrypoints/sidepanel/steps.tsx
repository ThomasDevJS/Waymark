/** Small pieces shared by the recorder's live list and the editor's step cards (D91). */
import type { Step } from '../../core/model/schema';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

type Flag = NonNullable<Step['flags']>[number];

/** What each recorder warning means and what to do, in one line (docs/TESTING.md section 3). */
export const FLAG_HELP: Record<Flag, { label: string; help: string }> = {
  'low-confidence': { label: 'Hard to find', help: 'This isn’t a button, link or field, so the guide may not find it next time. Use Re-pick element to choose the real button, or delete the step.' },
  canvas: { label: 'Drawing area', help: 'Charts and maps have nothing inside them to point at. Delete this step, or add a note that explains it.' },
  'closed-shadow': { label: 'Closed component', help: 'Waymark can’t see inside this part of the page, so it points at the whole box. Press Test step to check it.' },
};

export const KIND: Record<Step['kind'], { label: string; icon: IconName }> = {
  click: { label: 'Click', icon: 'crosshair' },
  input: { label: 'Type', icon: 'edit' },
  select: { label: 'Choose', icon: 'steps' },
  check: { label: 'Check', icon: 'check' },
  submit: { label: 'Submit', icon: 'upload' },
  navigate: { label: 'Go to page', icon: 'globe' },
  note: { label: 'Note', icon: 'note' },
  hover: { label: 'Point at', icon: 'crosshair' },
};

/** Warning badges with their explanation inline, so authors don't need to hover. */
export function FlagNotes({ flags, testid, later }: { flags: Step['flags']; testid?: string; later?: boolean }) {
  if (!flags?.length) return null;
  return (
    <div class="flag-notes" data-testid={testid}>
      {later && <p class="small muted">You can fix this in the editor after you press Stop.</p>}
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
