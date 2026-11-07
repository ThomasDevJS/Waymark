/**
 * The site profile for this frame (D213): asked from the service worker, which answers only for
 * this frame's own origin. `run` follows the tab's run (a team guide uses the library's profile);
 * `record` and `edit` use the author's own.
 */
import { send } from '../core/messaging/client';
import { compileProfile, SiteProfileSchema, type ProfileOptions } from '../core/model/profile';

export async function fetchProfile(purpose: 'run' | 'record' | 'edit'): Promise<ProfileOptions> {
  try {
    const r = await send('profile.get', { purpose });
    const p = r.profile ? SiteProfileSchema.safeParse(r.profile) : null;
    return p?.success ? compileProfile(p.data) : {};
  } catch {
    return {};
  }
}
