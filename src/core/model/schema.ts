import { z } from 'zod';
import { SHADES } from '../player/shade';

/**
 * Data model (SPEC: Data model). Defined once in Zod and shared by recorder, player,
 * storage and import. Everything coming from a pack, a library or a content script is
 * validated with these schemas.
 */

export const SCHEMA_VERSION = 1 as const;
/**
 * Pack format. A pack is written in the oldest format that holds its steps, so an older Waymark
 * says it was made by a newer version instead of failing on an unknown step kind: 2 with a hover
 * step (D204), 3 with a Sheets cell step (D206). Packs without either are still written as 1,
 * which every version reads.
 */
export const FORMAT_VERSION = 3 as const;
export const HOVER_FORMAT_VERSION = 2 as const;
export const BASE_FORMAT_VERSION = 1 as const;
export const MAX_STEPS_PER_GUIDE = 500;

const shortStr = (max = 2000) => z.string().max(max);

/**
 * A real site origin: http(s), exactly as `new URL(o).origin` writes it, with no wildcard. Packs
 * are untrusted: a guide claiming "https://*" must never reach a permission request (D44).
 */
export function isSiteOrigin(o: string): boolean {
  try {
    const u = new URL(o);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === o && !u.hostname.includes('*');
  } catch {
    return false;
  }
}
const SiteOriginSchema = z.string().max(500).refine(isSiteOrigin, 'not a site origin');

/**
 * Guide, revision and step ids: ULIDs when Waymark makes them. Packs are untrusted, so ids are
 * limited to letters, digits, `-` and `_` (the deep link rule): no `__proto__`, separators or
 * spaces that could reach object keys, storage keys or URLs (D48).
 */
export const ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;
const IdSchema = z.string().regex(ID_PATTERN, 'not an id').refine((s) => s !== '__proto__', 'not an id');

/** An http(s) start URL on one of the guide's own sites (D48). */
export function startUrlOk(startUrl: string, appOrigins: string[]): boolean {
  try {
    const u = new URL(startUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') && appOrigins.includes(u.origin);
  } catch {
    return false;
  }
}

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
  /** Radio / checkbox `value` attribute (author-defined, never typed): which option of a named group. */
  value: shortStr(200).optional(),
  inputType: shortStr(64).optional(),
  placeholder: shortStr(200).optional(),
  text: shortStr(200).optional(),
  /** Text of the list item or row around a control with no name or text of its own (D65). */
  itemLabel: shortStr(200).optional(),
  hrefPath: shortStr(2000).optional(),
  cssPath: shortStr(2000),
  xpath: shortStr(2000),
  ancestors: z.array(LandmarkSchema).max(3),
  shadowPath: z.array(shortStr(2000)).max(20),
  framePath: z.array(shortStr(2000)).max(20),
  rect: RectSchema,
  /**
   * Non-positional signals that each look-alike on the page matched at record time (D64). A
   * unique match that matched no more than one of these is refused.
   */
  lookalikes: z.array(z.array(shortStr(32)).max(16)).max(5).optional(),
});
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;

export const StepKindSchema = z.enum(['click', 'input', 'select', 'check', 'submit', 'navigate', 'note', 'hover', 'cell']);
export type StepKind = z.infer<typeof StepKindSchema>;

export const StepFlagSchema = z.enum(['low-confidence', 'closed-shadow', 'canvas']);
export type StepFlag = z.infer<typeof StepFlagSchema>;

export const StepSchema = z.object({
  id: IdSchema,
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
  /** A Google Sheets cell or range to select (kind `cell`, D206); the target is the Name Box. */
  cell: z
    .object({
      ref: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/),
      sheet: shortStr(200).optional(),
    })
    .optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const GuideSchema = z.object({
  id: IdSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  revisionId: IdSchema,
  forkedFrom: z.object({ guideId: IdSchema, revisionId: IdSchema }).optional(),
  title: shortStr(500),
  description: shortStr(5000).optional(),
  lang: shortStr(35),
  tags: z.array(shortStr(100)).max(50),
  appOrigins: z.array(SiteOriginSchema).min(1).max(50),
  startUrl: shortStr(2000),
  matchUrls: z.array(UrlRuleSchema).max(50),
  // A Sheets cell step carries its cell, and only it does (D206): one without would never advance.
  steps: z
    .array(StepSchema)
    .max(MAX_STEPS_PER_GUIDE)
    .refine((steps) => steps.every((s) => (s.kind === 'cell') === !!s.cell), 'a cell step needs its cell, and only a cell step has one'),
  version: z.number().int().nonnegative(),
  source: z.enum(['local', 'library']),
  updatedAt: shortStr(64),
  /**
   * The author's shade around the highlight (D144). Optional: older guides and files have none.
   * A value this version doesn't know (from a newer Waymark) counts as not set, so the guide
   * still imports.
   */
  shade: z.enum(SHADES).optional().catch(undefined),
}).refine((g) => startUrlOk(g.startUrl, g.appOrigins), { message: 'the start URL is not on one of the guide sites', path: ['startUrl'] });
export type Guide = z.infer<typeof GuideSchema>;

export const RunStateSchema = z.object({
  guideSnapshot: GuideSchema,
  stepIndex: z.number().int().nonnegative(),
  status: z.enum(['running', 'paused', 'finished']),
  startedAt: shortStr(64),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const GuidePackSchema = z.object({
  format: z.literal('waymark-pack'),
  formatVersion: z.union([z.literal(BASE_FORMAT_VERSION), z.literal(HOVER_FORMAT_VERSION), z.literal(FORMAT_VERSION)]),
  exportedAt: shortStr(64),
  guides: z.array(GuideSchema),
  // Site profiles of the guides' sites (D213). Checked one by one in parsePack: a bad one is
  // dropped with a notice and the guides still import. Older Waymark ignores the field.
  // A pack with more is not refused: packProfiles keeps the first MAX_PACK_PROFILES (review of D213).
  profiles: z.array(z.unknown()).max(1000).optional(),
});
export type GuidePack = z.infer<typeof GuidePackSchema>;
