/**
 * The shade around a highlighted step (D144). A closed set of levels, never a free number, so a
 * guide file or a message can't make the page black or invisible. No Zod here: the content script
 * imports this.
 */
export const SHADES = ['lighter', 'medium', 'darker'] as const;
export type Shade = (typeof SHADES)[number];
/** The learner's choice in Settings: follow each guide, or one shade for every guide. */
export const LEARNER_SHADES = ['guide', ...SHADES] as const;
export type LearnerShade = (typeof LEARNER_SHADES)[number];

/** Lighter by default (D151): Thomas found Medium heavy on busy app pages. */
export const DEFAULT_SHADE: Shade = 'lighter';

export function isShade(v: unknown): v is Shade {
  return typeof v === 'string' && (SHADES as readonly string[]).includes(v);
}

/**
 * Which shade a run uses (D145). The learner's own pick wins (it can be an accessibility need);
 * otherwise the guide's; otherwise the default. Anything unknown counts as not set.
 */
export function resolveShade(learner: unknown, guide: unknown): Shade {
  if (isShade(learner)) return learner;
  if (isShade(guide)) return guide;
  return DEFAULT_SHADE;
}

/** The editor's choice for a guide: a level sets it; Default ("") removes the field (D144). */
export function withGuideShade<T extends { shade?: Shade }>(guide: T, choice: string): T {
  const { shade: _old, ...rest } = guide;
  return (isShade(choice) && choice !== DEFAULT_SHADE ? { ...rest, shade: choice } : rest) as T;
}
