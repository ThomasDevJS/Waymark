/** Names people read for the shade levels (D144), shared by Settings and the editor. */
import type { LearnerShade, Shade } from '../core/player/shade';

/** One name for the setting, in Settings and the editor (UX rule 6). */
export const SHADE_NAME = 'Shade around the highlighted step';

export const SHADE_LABEL: Record<Shade, string> = { lighter: 'Lighter', medium: 'Medium', darker: 'Darker' };

export const LEARNER_SHADE_CHOICES: { value: LearnerShade; label: string; hint: string }[] = [
  { value: 'guide', label: 'Follow each guide', hint: 'Medium, unless the guide’s author picked another shade.' },
  { value: 'lighter', label: 'Lighter', hint: 'More of the page stays readable around the step.' },
  { value: 'medium', label: 'Medium', hint: 'The usual shade.' },
  { value: 'darker', label: 'Darker', hint: 'The highlighted step stands out more.' },
];
