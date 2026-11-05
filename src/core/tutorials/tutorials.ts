/**
 * Built-in tutorials (D128): a small JSON pack bundled in the extension, played only on the
 * Practice page (an extension page). They are never stored as guides: they don't count against
 * the library, never reach exports, badges or search, and never ask for site access.
 */
import { z } from 'zod';
import { ID_PATTERN, StepKindSchema, type ElementFingerprint, type Guide, type Step } from '../model/schema';
import { newId } from '../model/ids';
import { voiceTextFor } from '../voice/voice';
import raw from './pack.json';

/** A practice-page element, named by its `data-guide-id`. */
const TargetSchema = z.string().regex(/^(practice|pic)-[a-z0-9-]{1,40}$/);

export const TutorialStepSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  kind: StepKindSchema,
  title: z.string().min(1).max(200),
  note: z.string().max(600).optional(),
  voiceText: z.string().max(600).optional(),
  target: TargetSchema.optional(),
  advance: z.enum(['action', 'next']),
});
export type TutorialStep = z.infer<typeof TutorialStepSchema>;

export const TutorialSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
  title: z.string().min(1).max(100),
  summary: z.string().max(200),
  minutes: z.number().int().min(1).max(10),
  steps: z.array(TutorialStepSchema).min(1).max(20),
});
export type Tutorial = z.infer<typeof TutorialSchema>;

export const TutorialPackSchema = z
  .object({ format: z.literal('waymark-tutorials'), version: z.literal(1), tutorials: z.array(TutorialSchema).min(1).max(20) })
  .refine((p) => new Set(p.tutorials.map((t) => t.id)).size === p.tutorials.length, 'tutorial ids must be unique')
  .refine((p) => {
    const ids = p.tutorials.flatMap((t) => t.steps.map((s) => s.id));
    return new Set(ids).size === ids.length;
  }, 'step ids must be unique')
  // An action step must point at something to act on.
  .refine((p) => p.tutorials.every((t) => t.steps.every((s) => s.advance === 'next' || (s.target && s.kind !== 'note'))), 'action steps need a target');

/** The bundled pack, checked once (a unit test checks it too, so a bad pack fails the build's tests). */
export const TUTORIALS: readonly Tutorial[] = TutorialPackSchema.parse(raw).tutorials;

export function tutorialById(id: string | null | undefined): Tutorial | null {
  return TUTORIALS.find((t) => t.id === id) ?? null;
}

export const TUTORIALS_HIDDEN_KEY = 'ui:tutorialsHidden';

/** The step as the player draws it. Tutorials run on one page, so the URL rule always matches. */
export function toStep(s: TutorialStep): Step {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    ...(s.note ? { note: s.note } : {}),
    ...(s.voiceText ? { voiceText: s.voiceText } : {}),
    url: { kind: 'prefix', value: '/' },
    advance: s.kind === 'note' ? 'next' : s.advance,
  };
}

/**
 * A fingerprint for a practice element that isn't on the page (the "can't find" demo): only its
 * guide id, which nothing matches, so the real matcher reports not-found at once.
 */
export function missingFingerprint(guideId: string): ElementFingerprint {
  return {
    instance: 'unique',
    matchCount: 1,
    guideId,
    tag: 'button',
    cssPath: `[data-guide-id="${guideId}"]`,
    xpath: '',
    ancestors: [],
    shadowPath: [],
    framePath: [],
    rect: { x: 0, y: 0, w: 0, h: 0, vw: 0, vh: 0 },
  };
}

/**
 * "Copy to my guides": the tutorial as a starting template on the user's own (allowed) site.
 * Practice elements don't exist there, so every step becomes a note step that keeps its title,
 * note and spoken text: the copy never points at a wrong element. The author re-records or edits.
 */
export function tutorialAsGuide(t: Tutorial, pageUrl: string, now = new Date()): Guide {
  const u = new URL(pageUrl);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Open a page of your web app first.');
  return {
    id: newId(),
    schemaVersion: 1,
    revisionId: newId(),
    title: `Draft: ${t.title}`,
    description: t.summary,
    lang: 'en',
    tags: ['tutorial'],
    appOrigins: [u.origin],
    startUrl: `${u.origin}${u.pathname}`,
    matchUrls: [],
    steps: [
      {
        id: newId(),
        kind: 'note' as const,
        title: 'About this draft',
        note: `A copy of the Waymark tutorial “${t.title}”, to show how steps, notes and spoken text are written. Its steps were made for the practice page: edit them, or record your own steps on this site.`,
        url: { kind: 'prefix' as const, value: '/' },
        advance: 'next' as const,
      },
      ...t.steps.map((s) => ({
        ...toStep(s),
        id: newId(),
        kind: 'note' as const,
        advance: 'next' as const,
        url: { kind: 'prefix' as const, value: '/' },
      })),
    ],
    version: 1,
    source: 'local',
    updatedAt: now.toISOString(),
  };
}

/** The spoken text of a bundled step: the service worker speaks only this, never page text (D129). */
export function tutorialVoiceText(tutorialId: string, stepId: string): string | null {
  const s = tutorialById(tutorialId)?.steps.find((x) => x.id === stepId);
  return s ? voiceTextFor(toStep(s)) || null : null;
}

/** The voice text of the step after this one, which the HD voice prepares while this one plays (D142). */
export function nextTutorialVoiceText(tutorialId: string, stepId: string): string | null {
  const steps = tutorialById(tutorialId)?.steps ?? [];
  const i = steps.findIndex((x) => x.id === stepId);
  const next = i >= 0 ? steps[i + 1] : undefined;
  return next ? voiceTextFor(toStep(next)) || null : null;
}
