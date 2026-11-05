/**
 * D80: a library site granted only to fetch the pack is not a guide site (no content script,
 * not "allowed" in the panel) until the user allows it. D81: one library fetch per browser start.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantedSitePatterns } from '../../src/core/permissions/registration';
import { fetchOnlyPatterns, setFetchOnly, siteAllowed } from '../../src/background/site-access';
import { scheduleLibrary, LIBRARY_ALARM, LIBRARY_PERIOD_MIN, discoveryHandlers } from '../../src/background/discovery';

function fakeChrome(granted: string[], library: string | null = null) {
  const local = new Map<string, unknown>();
  if (library) local.set('library', { url: library, lastFetchAt: null, lastError: null, count: 0 });
  const alarms: { name: string; info: chrome.alarms.AlarmCreateInfo }[] = [];
  const removed: string[] = [];
  return {
    alarms,
    removed,
    chrome: {
      storage: {
        local: {
          get: async (k: string | null) => (k === null ? Object.fromEntries(local) : { [k]: local.get(k) }),
          set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => local.set(k, v)),
          remove: async (k: string | string[]) => void [k].flat().forEach((x) => local.delete(x)),
        },
        session: { get: async () => ({}) },
      },
      tabs: { query: async () => [], get: async () => undefined },
      action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
      permissions: {
        contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.includes(o)),
        remove: async ({ origins }: { origins: string[] }) => {
          removed.push(...origins);
          return true;
        },
      },
      alarms: {
        create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => void alarms.push({ name, info }),
        clear: async () => true,
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('library site granted only for fetching (D80)', () => {
  it('gets no content script and is not "allowed", until the user allows it', async () => {
    const f = fakeChrome(['https://raw.example/*', 'https://app.test/*']);
    vi.stubGlobal('chrome', f.chrome);
    await setFetchOnly('https://raw.example', true);
    const fetchOnly = await fetchOnlyPatterns();
    expect(grantedSitePatterns(['https://raw.example/*', 'https://app.test/*'], fetchOnly)).toEqual(['https://app.test/*']);
    expect(await siteAllowed('https://raw.example')).toBe(false);
    expect(await siteAllowed('https://app.test')).toBe(true);
    await setFetchOnly('https://raw.example', false); // the user clicked Allow on that site
    expect(await siteAllowed('https://raw.example')).toBe(true);
    expect(grantedSitePatterns(['https://raw.example/*'], await fetchOnlyPatterns())).toEqual(['https://raw.example/*']);
  });

  it('unsubscribing gives back a permission held only for fetching', async () => {
    const f = fakeChrome(['https://raw.example/*'], 'https://raw.example/pack.json');
    vi.stubGlobal('chrome', f.chrome);
    await setFetchOnly('https://raw.example', true);
    await discoveryHandlers['library.set']!({ url: null }, {} as never);
    expect(f.removed).toEqual(['https://raw.example/*']);
    expect(await fetchOnlyPatterns()).toEqual([]);
  });
});

describe('library refresh schedule (D81)', () => {
  it('at browser start the first alarm is the only fetch; after an immediate fetch the next waits a full period', async () => {
    const f = fakeChrome([], 'https://raw.example/pack.json');
    vi.stubGlobal('chrome', f.chrome);
    await scheduleLibrary();
    await scheduleLibrary({ fetchedNow: true });
    expect(f.alarms).toEqual([
      { name: LIBRARY_ALARM, info: { periodInMinutes: LIBRARY_PERIOD_MIN, delayInMinutes: 1 } },
      { name: LIBRARY_ALARM, info: { periodInMinutes: LIBRARY_PERIOD_MIN, delayInMinutes: LIBRARY_PERIOD_MIN } },
    ]);
  });
});

describe('browser start (D81)', () => {
  it('does not fetch the library itself; the alarm a minute later does', async () => {
    const f = fakeChrome([], 'https://raw.example/pack.json');
    vi.stubGlobal('chrome', f.chrome);
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const { onBrowserStartLibrary } = await import('../../src/background/discovery');
    await onBrowserStartLibrary();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(f.alarms.map((a) => a.info.delayInMinutes)).toEqual([1]);
  });
});
