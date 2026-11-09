/**
 * Packs: export, import and the library file (SPEC: Sharing and storage). Every pack is
 * untrusted input: capped at 5 MB and 500 steps per guide, validated with the Zod schema, and
 * newer schema or format versions are rejected with a message, never silently trimmed.
 */
import { BASE_FORMAT_VERSION, FORMAT_VERSION, HOVER_FORMAT_VERSION, GuidePackSchema, SCHEMA_VERSION, type Guide, type GuidePack } from '../model/schema';
import { newId } from '../model/ids';
import { isEmptyProfile, profileProblem, SiteProfileSchema, type SiteProfile } from '../model/profile';
import { isSiteOrigin } from '../model/schema';

export const MAX_PACK_BYTES = 5 * 1024 * 1024;

export type ParseResult = { ok: true; pack: GuidePack; profiles: SiteProfile[]; droppedProfiles: number } | { ok: false; error: string };

/**
 * The pack's site profiles that are well formed, for a site of its guides, one per site (D213).
 * Anything else is dropped and counted, so the import can say so; the guides import anyway.
 */
/** Site profiles a pack carries at most; more are dropped with the notice (review of D213). */
export const MAX_PACK_PROFILES = 50;

export function packProfiles(pack: Pick<GuidePack, 'guides' | 'profiles'>): { profiles: SiteProfile[]; dropped: number } {
  const sites = new Set(pack.guides.flatMap((g) => g.appOrigins));
  const out = new Map<string, SiteProfile>();
  let dropped = 0;
  for (const raw of pack.profiles ?? []) {
    const p = SiteProfileSchema.safeParse(raw);
    if (!p.success || !isSiteOrigin(p.data.origin) || !sites.has(p.data.origin) || profileProblem(p.data) || out.has(p.data.origin) || out.size >= MAX_PACK_PROFILES) {
      dropped++;
      continue;
    }
    // An empty profile changes nothing: not stored (it would hide another store's).
    if (isEmptyProfile(p.data)) continue;
    out.set(p.data.origin, p.data);
  }
  return { profiles: [...out.values()], dropped };
}

export function parsePack(text: string): ParseResult {
  if (new Blob([text]).size > MAX_PACK_BYTES) return { ok: false, error: 'This pack is larger than 5 MB.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a Waymark guide file (not valid JSON).' };
  }
  const r = raw as { format?: unknown; formatVersion?: unknown; guides?: unknown };
  if (!r || typeof r !== 'object' || r.format !== 'waymark-pack') return { ok: false, error: 'This file is not a Waymark guide file.' };
  if (typeof r.formatVersion === 'number' && r.formatVersion > FORMAT_VERSION) {
    return { ok: false, error: 'This pack was made by a newer version of Waymark. Update Waymark to import it.' };
  }
  if (Array.isArray(r.guides) && r.guides.some((g) => typeof (g as { schemaVersion?: unknown })?.schemaVersion === 'number' && (g as { schemaVersion: number }).schemaVersion > SCHEMA_VERSION)) {
    return { ok: false, error: 'This pack contains guides from a newer version of Waymark. Update Waymark to import it.' };
  }
  const parsed = GuidePackSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issue.path.join('.') : '';
    return { ok: false, error: `This pack is not valid${where ? ` (at ${where})` : ''}.` };
  }
  const ids = new Set<string>();
  for (const g of parsed.data.guides) {
    if (ids.has(g.id)) return { ok: false, error: 'This pack lists the same guide twice.' };
    ids.add(g.id);
  }
  const { profiles, dropped } = packProfiles(parsed.data);
  return { ok: true, pack: parsed.data, profiles, droppedProfiles: dropped };
}

/** The oldest format that can hold these guides: 3 with a Sheets cell step (D206), 2 with a hover step (D204), else 1. */
export function packFormatFor(guides: Pick<Guide, 'steps'>[]): GuidePack['formatVersion'] {
  const kinds = new Set(guides.flatMap((g) => g.steps.map((s) => s.kind)));
  if (kinds.has('cell')) return FORMAT_VERSION;
  if (kinds.has('hover')) return HOVER_FORMAT_VERSION;
  return BASE_FORMAT_VERSION;
}

/** A pack of guides, with the site profiles of their sites when there are any (D213). */
export function makePack(guides: Guide[], now = new Date(), profiles: SiteProfile[] = []): GuidePack {
  const sites = new Set(guides.flatMap((g) => g.appOrigins));
  const carried = profiles.filter((p) => sites.has(p.origin) && !isEmptyProfile(p)).slice(0, MAX_PACK_PROFILES);
  return { format: 'waymark-pack', formatVersion: packFormatFor(guides), exportedAt: now.toISOString(), guides, ...(carried.length ? { profiles: carried } : {}) };
}

export type Choice = 'keep' | 'replace' | 'both';

/** What the import rules need from a stored guide: an index entry is enough (D49). */
export type GuideRef = Pick<Guide, 'id' | 'revisionId' | 'title' | 'source' | 'forkedFrom'>;

export interface Conflict {
  id: string;
  title: string;
  existingTitle: string;
}

/** Guides in a pack that clash with local guides: same id, different revisionId. */
export function findConflicts(existing: GuideRef[], pack: GuidePack): Conflict[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  return pack.guides
    .filter((g) => {
      const cur = byId.get(g.id);
      return !!cur && cur.source === 'local' && cur.revisionId !== g.revisionId;
    })
    .map((g) => ({ id: g.id, title: g.title, existingTitle: byId.get(g.id)!.title }));
}

export interface ImportPlan {
  write: Guide[];
  remove: string[];
  skipped: number;
}

/**
 * Import rules (SPEC: Sharing, "Import rules"):
 * - same id and same revisionId: nothing to do;
 * - same id, different revisionId: library guides always take the library copy; for local
 *   guides the user picks keep, replace, or keep both (keep both gives the import a new id
 *   with forkedFrom set);
 * - imported guides become local guides; library refreshes replace the library set.
 */
export function planImport(existing: GuideRef[], pack: GuidePack, choices: Record<string, Choice>, as: 'local' | 'library' = 'local'): ImportPlan {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const write: Guide[] = [];
  let skipped = 0;
  for (const incoming of pack.guides) {
    const g: Guide = { ...incoming, source: as };
    const cur = byId.get(g.id);
    if (!cur) {
      write.push(g);
      continue;
    }
    if (cur.revisionId === g.revisionId && cur.source === as) {
      skipped++;
      continue;
    }
    if (as === 'library') {
      // A local guide with the same id is the author's own copy: it is never overwritten (D42).
      if (cur.source === 'local') skipped++;
      else write.push(g);
      continue;
    }
    if (cur.source === 'library') {
      // An imported copy of a library guide becomes the user's own: keep both, once per revision.
      const already = existing.some((e) => e.forkedFrom?.guideId === g.id && e.forkedFrom.revisionId === g.revisionId);
      if (already || cur.revisionId === g.revisionId) skipped++;
      else write.push({ ...g, id: newId(), forkedFrom: { guideId: g.id, revisionId: g.revisionId } });
      continue;
    }
    const choice = choices[g.id] ?? 'keep';
    if (choice === 'keep') skipped++;
    else if (choice === 'replace') write.push(g);
    else write.push({ ...g, id: newId(), revisionId: newId(), forkedFrom: { guideId: g.id, revisionId: g.revisionId } });
  }
  const remove =
    as === 'library'
      ? existing.filter((g) => g.source === 'library' && !pack.guides.some((p) => p.id === g.id)).map((g) => g.id)
      : [];
  return { write, remove, skipped };
}

/** A copy of a guide the user can edit (Duplicate on a library guide). */
export function duplicateGuide(g: Guide, now = new Date()): Guide {
  return { ...structuredClone(g), id: newId(), revisionId: newId(), forkedFrom: { guideId: g.id, revisionId: g.revisionId }, source: 'local', version: 1, title: `${g.title} (copy)`, updatedAt: now.toISOString() };
}

/** Every site the guides run on, for one Allow request (SPEC: Discovery, "First-run access"). */
export function packOrigins(guides: Guide[]): string[] {
  return [...new Set(guides.flatMap((g) => g.appOrigins))].sort();
}
