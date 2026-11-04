import { z } from 'zod';

/**
 * Data model (SPEC: Data model). Defined once in Zod and shared by recorder, player,
 * storage and import. Everything coming from a pack, a library or a content script is
 * validated with these schemas.
 */

export const SCHEMA_VERSION = 1 as const;
export const FORMAT_VERSION = 1 as const;
export const MAX_STEPS_PER_GUIDE = 500;

const shortStr = (max = 2000) => z.string().max(max);

export const UrlRuleSchema = z.object({
  kind: z.enum(['prefix', 'pattern']),
  value: shortStr(2000),
});
export type UrlRule = z.infer<typeof UrlRuleSchema>;

export const LandmarkSchema = z.object({
  tag: shortStr(64),
  role: shortStr(64).optional(),
  label: shortStr(200).optional(),
});
export type Landmark = z.infer<typeof LandmarkSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  vw: z.number(),
  vh: z.number(),
});

export const ElementFingerprintSchema = z.object({
  instance: z.enum(['unique', 'any']),
  matchCount: z.number().int().nonnegative(),
  guideId: shortStr(200).optional(),
  testId: z.object({ attr: shortStr(64), value: shortStr(200) }).optional(),
  id: shortStr(200).optional(),
  tag: shortStr(64),
  role: shortStr(64).optional(),
  accessibleName: shortStr(200).optional(),
  name: shortStr(200).optional(),
  inputType: shortStr(64).optional(),
  placeholder: shortStr(200).optional(),
  text: shortStr(200).optional(),
  hrefPath: shortStr(2000).optional(),
  cssPath: shortStr(2000),
  xpath: shortStr(2000),
  ancestors: z.array(LandmarkSchema).max(3),
  shadowPath: z.array(shortStr(2000)).max(20),
  framePath: z.array(shortStr(2000)).max(20),
  rect: RectSchema,
});
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;

export const StepKindSchema = z.enum(['click', 'input', 'select', 'check', 'submit', 'navigate', 'note']);
export type StepKind = z.infer<typeof StepKindSchema>;

export const StepFlagSchema = z.enum(['low-confidence', 'closed-shadow', 'canvas']);
export type StepFlag = z.infer<typeof StepFlagSchema>;

export const StepSchema = z.object({
  id: shortStr(64),
  kind: StepKindSchema,
  title: shortStr(500),
  note: shortStr(5000).optional(),
  voiceText: shortStr(5000).optional(),
  url: UrlRuleSchema,
  target: ElementFingerprintSchema.optional(),
  advance: z.enum(['action', 'next']),
  optional: z.boolean().optional(),
  placement: z.enum(['auto', 'top', 'bottom', 'left', 'right']).optional(),
  /** Recorder warnings shown in the editor (see docs/DECISIONS.md D15). */
  flags: z.array(StepFlagSchema).max(5).optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const GuideSchema = z.object({
  id: shortStr(64),
  schemaVersion: z.literal(SCHEMA_VERSION),
  revisionId: shortStr(64),
  forkedFrom: z.object({ guideId: shortStr(64), revisionId: shortStr(64) }).optional(),
  title: shortStr(500),
  description: shortStr(5000).optional(),
  lang: shortStr(35),
  tags: z.array(shortStr(100)).max(50),
  appOrigins: z.array(shortStr(500)).max(50),
  startUrl: shortStr(2000),
  matchUrls: z.array(UrlRuleSchema).max(50),
  steps: z.array(StepSchema).max(MAX_STEPS_PER_GUIDE),
  version: z.number().int().nonnegative(),
  source: z.enum(['local', 'library']),
  updatedAt: shortStr(64),
});
export type Guide = z.infer<typeof GuideSchema>;

export const RunStateSchema = z.object({
  guideSnapshot: GuideSchema,
  stepIndex: z.number().int().nonnegative(),
  status: z.enum(['running', 'paused', 'finished']),
  startedAt: z.string(),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const GuidePackSchema = z.object({
  format: z.literal('waymark-pack'),
  formatVersion: z.literal(FORMAT_VERSION),
  exportedAt: z.string(),
  guides: z.array(GuideSchema),
});
export type GuidePack = z.infer<typeof GuidePackSchema>;
