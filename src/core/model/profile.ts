import { z } from 'zod';

/** Per-site profile (SPEC: Element targeting, "Per-site profiles"). */
export const SiteProfileSchema = z.object({
  origin: z.string(),
  stableAttributes: z.array(z.string()).default([]),
  ignorePatterns: z.array(z.string()).default([]),
  hashRouting: z.boolean().default(false),
  keepQueryKeys: z.array(z.string()).default([]),
});
export type SiteProfile = z.infer<typeof SiteProfileSchema>;

export interface ProfileOptions {
  stableAttributes?: string[];
  ignorePatterns?: RegExp[];
  hashRouting?: boolean;
  keepQueryKeys?: string[];
}

export function compileProfile(p: SiteProfile | undefined): ProfileOptions {
  if (!p) return {};
  const ignorePatterns: RegExp[] = [];
  for (const src of p.ignorePatterns) {
    try {
      ignorePatterns.push(new RegExp(src));
    } catch {
      // invalid user pattern: ignore it rather than fail matching
    }
  }
  return {
    stableAttributes: p.stableAttributes,
    ignorePatterns,
    hashRouting: p.hashRouting,
    keepQueryKeys: p.keepQueryKeys,
  };
}
