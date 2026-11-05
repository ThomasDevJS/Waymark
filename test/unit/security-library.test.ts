/** D48: the library server is untrusted. Its answer is bounded in size, time and destination. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshLibrary } from '../../src/background/discovery';

function fakeChrome(url: string) {
  const local = new Map<string, unknown>([['library', { url, lastFetchAt: null, lastError: null, count: 0 }]]);
  return {
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
    permissions: { contains: async () => true },
  };
}

function streamOf(chunks: number, chunkBytes: number, pulled: { n: number }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(c) {
      if (pulled.n >= chunks) return c.close();
      pulled.n++;
      c.enqueue(new Uint8Array(chunkBytes).fill(32));
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('library refresh (D48)', () => {
  it('stops reading an oversized answer at the 5 MB cap', async () => {
    vi.stubGlobal('chrome', fakeChrome('https://lib.example/pack.json'));
    const pulled = { n: 0 };
    // 40 MB with no content-length: the old code read all of it before checking the size.
    vi.stubGlobal('fetch', async () => new Response(streamOf(40, 1024 * 1024, pulled), { status: 200 }));
    const state = await refreshLibrary();
    expect(state.lastError).toMatch(/larger than 5 MB/);
    expect(pulled.n).toBeLessThanOrEqual(7);
  });
  it('refuses a declared oversized answer without reading it', async () => {
    vi.stubGlobal('chrome', fakeChrome('https://lib.example/pack.json'));
    const pulled = { n: 0 };
    vi.stubGlobal('fetch', async () => new Response(streamOf(40, 1024 * 1024, pulled), { status: 200, headers: { 'content-length': String(40 * 1024 * 1024) } }));
    const state = await refreshLibrary();
    expect(state.lastError).toMatch(/larger than 5 MB/);
    expect(pulled.n).toBeLessThanOrEqual(1);
  });
  it('refuses a redirect to plain http', async () => {
    vi.stubGlobal('chrome', fakeChrome('https://lib.example/pack.json'));
    const pack = JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: '2026-01-01T00:00:00Z', guides: [] });
    vi.stubGlobal('fetch', async () => {
      const r = new Response(pack, { status: 200 });
      Object.defineProperty(r, 'url', { value: 'http://evil.example/pack.json' });
      return r;
    });
    const state = await refreshLibrary();
    expect(state.lastError).toMatch(/redirected/);
  });
  it('gives up on a library that never answers', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('chrome', fakeChrome('https://lib.example/pack.json'));
      vi.stubGlobal('fetch', (_u: string, init?: RequestInit) =>
        new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
      );
      const p = refreshLibrary();
      await vi.advanceTimersByTimeAsync(31_000);
      expect((await p).lastError).toMatch(/did not answer in time/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('site settings (D48)', () => {
  it('stores the launcher setting only for real site origins', async () => {
    const fake = fakeChrome('');
    vi.stubGlobal('chrome', fake);
    const { discoveryHandlers } = await import('../../src/background/discovery');
    const set = discoveryHandlers['site.settings.set']!;
    for (const bad of ['__proto__', 'constructor', 'https://*', 'javascript:x', '']) {
      await expect(Promise.resolve().then(() => set({ origin: bad, launcher: true }, {} as never)), bad).rejects.toThrow();
    }
    await set({ origin: 'https://app.test', launcher: true }, {} as never);
    const stored = (await fake.storage.local.get('siteSettings')).siteSettings as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(['https://app.test']);
  });
});

describe('one Allow click (D48)', () => {
  it('queues at most 50 sites from a pack, each listed by name', async () => {
    const fake = fakeChrome('');
    fake.permissions.contains = async () => false;
    vi.stubGlobal('chrome', fake);
    const { discoveryHandlers, MAX_PENDING_ALLOW } = await import('../../src/background/discovery');
    const origins = Array.from({ length: 300 }, (_, i) => `https://s${i}.example`);
    const guides = Array.from({ length: 6 }, (_, g) => ({
      id: `g${g}`, schemaVersion: 1, revisionId: `r${g}`, title: `G${g}`, lang: 'en', tags: [],
      appOrigins: origins.slice(g * 50, g * 50 + 50), startUrl: `${origins[g * 50]}/`, matchUrls: [], steps: [],
      version: 1, source: 'local', updatedAt: '2026-01-01T00:00:00Z',
    }));
    const text = JSON.stringify({ format: 'waymark-pack', formatVersion: 1, exportedAt: '2026-01-01T00:00:00Z', guides });
    await discoveryHandlers['pack.import']!({ text, choices: {} }, {} as never);
    const pending = (await discoveryHandlers['allow.pending']!({}, {} as never)) as { origins: string[] };
    expect(MAX_PENDING_ALLOW).toBe(50);
    expect(pending.origins.length).toBeLessThanOrEqual(50);
  });
  it('requests only the sites left ticked', async () => {
    const { originsToAllow } = await import('../../src/entrypoints/sidepanel/Library');
    expect(originsToAllow(['https://a.test', 'https://b.test'], new Set(['https://b.test']))).toEqual(['https://a.test']);
  });
});
