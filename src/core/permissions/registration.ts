/**
 * Runtime content script registration (SPEC: Architecture, "Content script"). The manifest has
 * no content_scripts and no host_permissions; the script is registered only for granted sites
 * and re-synced with chrome.permissions.getAll() on install, startup and permission changes.
 */
import { HD_HOST_PATTERNS } from '../voice/hd';

export const CONTENT_SCRIPT_ID = 'waymark-content';
export const CONTENT_SCRIPT_FILE = 'waymark-content.js';

/** Subset of the chrome API used here, so unit tests can pass a fake. */
export interface RegistrationApi {
  permissions: { getAll(): Promise<{ origins?: string[] }> };
  scripting: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<{ id: string; matches?: string[]; js?: string[] }[]>;
    registerContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
    updateContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  };
}

/**
 * Granted http(s) site patterns, sorted and de-duplicated. `exclude`: sites granted for another
 * reason, such as a library site granted only to fetch the pack (D80).
 */
export function grantedSitePatterns(origins: string[], exclude: readonly string[] = []): string[] {
  // HD voice download hosts are held only while the model downloads; they are not guide sites (D51).
  const reserved = new Set<string>([...HD_HOST_PATTERNS, ...exclude]);
  return [...new Set(origins.filter((o) => /^(https?|\*):\/\//.test(o) && !reserved.has(o)))].sort();
}

export function desiredRegistration(matches: string[]): chrome.scripting.RegisteredContentScript {
  return {
    id: CONTENT_SCRIPT_ID,
    js: [CONTENT_SCRIPT_FILE],
    matches,
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: 'document_start',
    persistAcrossSessions: true,
  };
}

function sameList(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
}

/** Makes the registration match the granted sites exactly. Returns the registered match patterns. */
export async function syncRegistrations(api: RegistrationApi, exclude: readonly string[] = []): Promise<string[]> {
  const { origins = [] } = await api.permissions.getAll();
  const patterns = grantedSitePatterns(origins, exclude);
  const existing = (await api.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] }))[0];
  if (!patterns.length) {
    if (existing) await api.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    return [];
  }
  const desired = desiredRegistration(patterns);
  if (!existing) await api.scripting.registerContentScripts([desired]);
  else if (!sameList(existing.matches, patterns) || !sameList(existing.js, desired.js)) {
    await api.scripting.updateContentScripts([desired]);
  }
  return patterns;
}

/** Injects the content script into already-open tabs of the given sites (after a grant or an update). */
export async function injectIntoOpenTabs(patterns: string[]): Promise<number> {
  if (!patterns.length) return 0;
  const tabs = await chrome.tabs.query({ url: patterns });
  let n = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: [CONTENT_SCRIPT_FILE], injectImmediately: true });
        n++;
      } catch {
        // tab may be closed, discarded or showing an error page
      }
    }),
  );
  return n;
}
