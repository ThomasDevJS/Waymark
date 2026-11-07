/**
 * Site profiles in the service worker (issue #97, D213): content scripts get the profile of their
 * own origin only; the panel reads and saves the author's own profile for a site, lists attribute
 * candidates on the tab's page (values shown, never stored), and tests the site's steps on the page.
 */
import type { HandlerContext, Handlers } from '../core/messaging/router';
import type { AttrCandidate, ContentPush, StepCheck } from '../core/messaging/protocol';
import { ATTR_NAME, isEmptyProfile, profileProblem, SiteProfileSchema, urlOptionsOf, type SiteProfile } from '../core/model/profile';
import { GuideSchema, isSiteOrigin, type Guide } from '../core/model/schema';
import { enqueue } from '../core/storage/queue';
import { getGuides, listGuides } from '../core/storage/guides';
import { loadProfiles, LOCAL_PROFILES_KEY, MAX_PROFILES, profileFor, readProfileMap, urlOptionsFor } from '../core/storage/profiles';
import { urlMatches } from '../core/url/url';
import { getRun } from './runs';
import { editorHandlers, type TestResult } from './editor';
import { updateAllBadges } from './discovery';

/** Steps tested at once by Test all steps on this page: a page rarely has more, and each waits briefly. */
export const MAX_TESTED_STEPS = 40;
export const MAX_CANDIDATES = 30;

async function tabUrl(tabId: number): Promise<string | null> {
  try {
    return (await chrome.tabs.get(tabId)).url ?? null;
  } catch {
    return null;
  }
}

/** The page's answer is untrusted: only well-formed, capped entries go to the panel. */
export function cleanCandidates(raw: unknown): AttrCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: AttrCandidate[] = [];
  for (const c of raw.slice(0, MAX_CANDIDATES)) {
    const v = c as Partial<AttrCandidate>;
    if (typeof v?.attr !== 'string' || !ATTR_NAME.test(v.attr) || typeof v.elements !== 'number' || !Number.isFinite(v.elements)) continue;
    const samples = Array.isArray(v.samples) ? v.samples.filter((s): s is string => typeof s === 'string').slice(0, 3).map((s) => s.slice(0, 80)) : [];
    out.push({ attr: v.attr, elements: Math.max(0, Math.min(100_000, Math.floor(v.elements))), unique: v.unique === true, samples });
  }
  return out;
}

export const profileHandlers: Handlers = {
  // From a content script: the profile of its own origin, for the tab's run (a team guide uses the
  // library's) or for recording and the editor (the author's own).
  'profile.get': async ({ purpose }, ctx: HandlerContext) => {
    const origin = ctx.sender.origin;
    if (!origin || ctx.tabId === undefined) return { profile: null };
    const source = purpose === 'run' ? ((await getRun(ctx.tabId))?.guideSnapshot.source ?? 'local') : 'local';
    return { profile: profileFor(await loadProfiles(), origin, source) };
  },
  'profile.site.get': async ({ origin }) => {
    const p = await loadProfiles();
    return { local: p.local[origin] ?? null, library: p.library[origin] ?? null };
  },
  'profile.site.set': async ({ origin, profile }) => {
    if (!isSiteOrigin(origin)) return { ok: false, error: 'Not a site Waymark can work on.' };
    if (profile) {
      if (profile.origin !== origin) return { ok: false, error: 'This profile is for another site.' };
      const problem = profileProblem(profile);
      if (problem) return { ok: false, error: problem };
    }
    const error = await enqueue(async () => {
      const map = readProfileMap((await chrome.storage.local.get(LOCAL_PROFILES_KEY))[LOCAL_PROFILES_KEY]);
      if (!profile || isEmptyProfile(profile)) delete map[origin];
      else {
        if (!map[origin] && Object.keys(map).length >= MAX_PROFILES) return `At most ${MAX_PROFILES} sites can have a profile.`;
        map[origin] = SiteProfileSchema.parse(profile);
      }
      await chrome.storage.local.set({ [LOCAL_PROFILES_KEY]: map });
      return null;
    });
    if (error) return { ok: false, error };
    // Hash routing and kept query keys change which guides a page offers.
    await updateAllBadges();
    return { ok: true };
  },
  'profile.candidates': async ({ tabId }) => {
    const msg: ContentPush = { type: 'profile.scan' };
    try {
      return { candidates: cleanCandidates(await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })) };
    } catch {
      throw new Error('Waymark is not running on this page. Reload the page and try again.');
    }
  },
  // Test all steps on this page: the site's guides that use the author's own profile here, every
  // step of theirs whose page this is, tested at once without drawing anything.
  'profile.testAll': async ({ tabId, origin: site, compare }, ctx: HandlerContext) => {
    const url = await tabUrl(tabId);
    let origin: string | null = null;
    try {
      origin = url ? new URL(url).origin : null;
    } catch {
      origin = null;
    }
    // The tab may have moved on while the panel was open: test only the site being saved.
    if (!url || !origin || origin !== site) throw new Error('This tab no longer shows that site. Open it again, then save.');
    const profiles = await loadProfiles();
    // A team guide with the library's own profile for this site doesn't use the author's.
    const ids = (await listGuides()).filter((g) => g.appOrigins.includes(origin) && (g.source === 'local' || !profiles.library[origin])).map((g) => g.id);
    const guides: Guide[] = (await getGuides(ids)).filter((g) => GuideSchema.safeParse(g).success);
    // The same steps before and after: those on this page with either profile's URL options.
    const now = urlOptionsFor(profiles, url, 'local');
    const other = urlOptionsOf(compare);
    const jobs: { g: Guide; i: number; onPage: boolean }[] = [];
    for (const g of guides) {
      g.steps.forEach((s, i) => {
        if (!s.target || jobs.length >= MAX_TESTED_STEPS) return;
        const onPage = urlMatches(s.url, url, g.appOrigins, now);
        if (onPage || urlMatches(s.url, url, g.appOrigins, other)) jobs.push({ g, i, onPage });
      });
    }
    const test = editorHandlers['step.test']!;
    const results = await Promise.all(
      jobs.map(async ({ g, i, onPage }): Promise<StepCheck> => {
        const step = g.steps[i]!;
        const base = { guideId: g.id, guideTitle: g.title, stepId: step.id, stepIndex: i, stepTitle: step.title };
        if (!onPage) return { ...base, result: 'off-page' };
        let r: TestResult | null = null;
        try {
          r = (await test({ tabId, step, origins: g.appOrigins, quiet: true }, ctx)) as TestResult;
        } catch {
          r = null;
        }
        return { ...base, result: !r?.found ? 'not-found' : r.fragile ? 'fragile' : 'found' };
      }),
    );
    return { results };
  },
};

export type { SiteProfile };
