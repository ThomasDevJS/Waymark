/**
 * Debug log (issue #33, D110–D112): the ring buffer's cap and eviction, the per-tab rate limit,
 * redaction, the text format, and the service worker's logger (nothing is collected while off;
 * a content script's copy holds only its own tab, site and run).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendEntries,
  browserName,
  CONTENT_RATE_MAX,
  CONTENT_RATE_WINDOW_MS,
  DEBUG_CAP,
  DEBUG_LOG_KEY,
  DEBUG_SETTING_KEY,
  emptyBuffer,
  entryTime,
  formatEntry,
  formatLog,
  redactUrl,
  sanitizeData,
  type DebugBuffer,
  type NewEntry,
} from '../../src/core/debug/log';

const data = (e: { d?: [string, unknown][] } | undefined) => Object.fromEntries(e?.d ?? []);
const entry = (i: number, extra: Partial<NewEntry> = {}): NewEntry => ({ at: 1_000 + i, tab: 1, frame: 0, o: null, src: 'run', ev: 'step', d: { i }, ...extra });

describe('ring buffer', () => {
  it('keeps at most DEBUG_CAP entries, evicting the oldest, newest last', () => {
    const buf = emptyBuffer();
    appendEntries(buf, Array.from({ length: DEBUG_CAP + 150 }, (_, i) => entry(i)), 5_000);
    expect(buf.entries).toHaveLength(DEBUG_CAP);
    expect(data(buf.entries[0])).toEqual({ i: 150 });
    expect(data(buf.entries.at(-1))).toEqual({ i: DEBUG_CAP + 149 });
    // Sequence numbers keep counting across evictions.
    expect(buf.entries.at(-1)!.n).toBe(DEBUG_CAP + 150);
    appendEntries(buf, [entry(9999)], 5_000);
    expect(buf.entries).toHaveLength(DEBUG_CAP);
    expect(data(buf.entries[0])).toEqual({ i: 151 });
  });

  it('drops a bad event name instead of storing it', () => {
    const buf = appendEntries(emptyBuffer(), [entry(0, { ev: 'Not an event' }), entry(1)], 0);
    expect(buf.entries.map((e) => e.ev)).toEqual(['step']);
  });

  it('rate-limits content entries per tab, counts the drops, and resets each window', () => {
    const buf: DebugBuffer = emptyBuffer();
    const fromTab = (tab: number, n: number) => Array.from({ length: n }, (_, i) => entry(i, { tab, content: true, src: 'match' }));
    appendEntries(buf, fromTab(1, CONTENT_RATE_MAX + 40), 10_000);
    expect(buf.entries).toHaveLength(CONTENT_RATE_MAX);
    expect(buf.dropped).toBe(40);
    // Another tab has its own window; the service worker's own entries are never limited.
    appendEntries(buf, [...fromTab(2, 5), ...Array.from({ length: 300 }, (_, i) => entry(i, { tab: 1 }))], 10_100);
    expect(buf.entries).toHaveLength(CONTENT_RATE_MAX + 5 + 300);
    expect(buf.dropped).toBe(40);
    appendEntries(buf, fromTab(1, 1), 10_200);
    expect(buf.dropped).toBe(41);
    appendEntries(buf, fromTab(1, 1), 10_000 + CONTENT_RATE_WINDOW_MS);
    expect(buf.dropped).toBe(41);
    // A clock that went backwards starts a new window rather than locking the tab out.
    appendEntries(buf, fromTab(1, 1), 5_000);
    expect(buf.dropped).toBe(41);
  });
});

describe('redaction', () => {
  it('keeps the site and the normalized path, never the query or fragment', () => {
    expect(redactUrl('https://app.test/orders/12345/edit?token=s3cret&q=jane#/frag')).toBe('https://app.test/orders/:id/edit');
    expect(redactUrl('https://app.test/users/jane.doe@acme.com/profile')).toBe('https://app.test/users/:id/profile');
    expect(redactUrl('https://app.test/')).toBe('https://app.test/');
    expect(redactUrl('chrome://settings/?search=x')).toBe('(chrome page)');
    expect(redactUrl('not a url')).toBe('(not a URL)');
    expect(redactUrl(undefined)).toBe('');
  });

  it('drops keys that would carry typed values or URL data, and caps everything else', () => {
    const d = sanitizeData({
      value: 'typed by the user',
      password: 'x',
      query: '?a=1',
      hash: '#x',
      typed: 'y',
      url: 'https://app.test/a/987654?x=1#y',
      path: '/orders/42?tab=2',
      why: 'w'.repeat(500),
      list: Array.from({ length: 50 }, (_, i) => `s${i}`),
      nan: Number.NaN,
      score: 82.3456,
      'bad key': 1,
      ok: true,
      none: null,
      nested: { a: 1 },
    })!;
    for (const k of ['value', 'password', 'query', 'hash', 'typed', 'bad key', 'nested']) expect(d).not.toHaveProperty(k);
    expect(d.url).toBe('https://app.test/a/:id');
    expect(d.path).toBe('/orders/:id');
    expect((d.why as string).length).toBe(200);
    expect(d.list).toHaveLength(20);
    expect(d.nan).toBeNull();
    expect(d.score).toBe(82.35);
    expect(d.ok).toBe(true);
    expect(d.none).toBeNull();
  });

  it('applies the same clean-up to entries in the buffer', () => {
    const buf = appendEntries(emptyBuffer(), [entry(0, { d: { value: 'hunter2', url: 'https://a.test/x?y=1' } })], 0);
    expect(buf.entries[0]!.d).toEqual([['url', 'https://a.test/x']]);
    expect(JSON.stringify(buf)).not.toContain('hunter2');
  });

  it('uses the page’s time only when it is close to the service worker’s clock', () => {
    expect(entryTime(9_000, 10_000)).toBe(9_000);
    expect(entryTime(100_000, 10_000)).toBe(10_000);
    expect(entryTime(Number.NaN, 10_000)).toBe(10_000);
  });
});

describe('text', () => {
  it('formats one line per entry, sorted by time, newest last, after the header', () => {
    const buf = appendEntries(
      emptyBuffer(),
      [
        { at: Date.UTC(2026, 10, 5, 12, 0, 2, 5), tab: 7, frame: 0, o: null, src: 'run', ev: 'step', d: { from: 1, step: 2, title: 'Click Save' } },
        { at: Date.UTC(2026, 10, 5, 12, 0, 1, 0), tab: 7, frame: 3, o: 'https://a.test', src: 'match', ev: 'found', d: { score: 82, matched: ['roleName', 'text'] } },
      ],
      0,
    );
    const text = formatLog(['Waymark debug log', 'Version: 1'], buf.entries);
    const lines = text.trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['Waymark debug log', 'Version: 1', '---']);
    expect(lines[3]).toBe('12:00:01.000 tab 7 f3 match found score=82 matched=roleName,text');
    expect(lines[4]).toBe('12:00:02.005 tab 7 f0 run   step from=1 step=2 title="Click Save"');
    expect(formatLog(['h'], [])).toBe('h\n---\n(no entries)\n');
    expect(formatEntry({ n: 1, at: 0, tab: null, frame: null, o: null, src: 'voice', ev: 'voice.stop', d: [['why', '']] })).toBe('00:00:00.000 tab - f- voice voice.stop why=""');
  });

  it('names the browser and its version', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36';
    expect(browserName(ua, [{ brand: 'Chromium', version: '142' }, { brand: 'Google Chrome', version: '142' }, { brand: 'Not_A Brand', version: '99' }])).toBe('Google Chrome 142.0.7444.59');
    expect(browserName(ua, [{ brand: 'Google Chrome', version: '142.0.7444.60' }])).toBe('Google Chrome 142.0.7444.60');
    expect(browserName(`${ua} Edg/142.0.3595.53`, [])).toBe('Microsoft Edge 142.0.3595.53');
    expect(browserName(ua, null)).toBe('Chromium-based 142.0.7444.59');
  });
});

// ---- the service worker's logger, with a stubbed chrome ----

function stubChrome(opts: { on: boolean; run?: unknown }) {
  const session: Record<string, unknown> = opts.run ? { 'run:7': opts.run } : {};
  const local: Record<string, unknown> = {
    [DEBUG_SETTING_KEY]: { on: opts.on, since: '2026-11-05T12:00:00.000Z' },
    voiceSettings: { autoPlay: true, muted: false, rate: 1.2, allowOnlineVoices: false, voices: { en: 'Secret Voice Name' } },
    library: { url: 'https://intranet.acme.test/team/guides.json?key=abc' },
  };
  const get = (store: Record<string, unknown>) => async (k?: string | string[] | null) => {
    if (k == null) return structuredClone(store);
    const keys = Array.isArray(k) ? k : [k];
    return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
  };
  const sent: unknown[] = [];
  vi.stubGlobal('chrome', {
    storage: {
      session: { get: get(session), set: async (o: Record<string, unknown>) => Object.assign(session, structuredClone(o)), remove: async (k: string) => void delete session[k] },
      local: { get: get(local), set: async (o: Record<string, unknown>) => Object.assign(local, structuredClone(o)) },
    },
    runtime: { getManifest: () => ({ version: '9.9.9' }), getPlatformInfo: async () => ({ os: 'linux' }) },
    permissions: { getAll: async () => ({ origins: ['https://a.test/*', 'https://b.test/*'] }) },
    tabs: { query: async () => [{ id: 7 }, { id: 8 }], sendMessage: async (id: number, m: unknown) => void sent.push([id, m]) },
  });
  return { session, local, sent };
}

const run = (startedAt: string) => ({
  guideSnapshot: { id: 'g1', title: 'Guide', appOrigins: ['https://a.test'], steps: [{ id: 's1', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/' } }] },
  stepIndex: 0,
  status: 'running',
  startedAt,
  stepToken: 't',
  rev: 1,
});

const content = (tabId: number, origin: string, frameId = 0) => ({ kind: 'content' as const, sender: { tab: { id: tabId }, origin } as chrome.runtime.MessageSender, tabId, frameId });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('service worker logger', () => {
  it('collects nothing while the switch is off, and never builds the data', async () => {
    const { session } = stubChrome({ on: false });
    const dbg = await import('../../src/background/debug');
    expect(await dbg.debugReady()).toBe(false);
    const data = vi.fn(() => ({ a: 1 }));
    dbg.dlog('run', 'step', { tab: 1 }, data);
    expect(await dbg.addContentEntries([{ t: Date.now(), src: 'match', ev: 'found' }], content(7, 'https://a.test'))).toBe(false);
    await dbg.flushDebug();
    expect(data).not.toHaveBeenCalled();
    expect(session[DEBUG_LOG_KEY]).toBeUndefined();
  });

  it('entries logged before the switch is read are dropped when it turns out off', async () => {
    const { session } = stubChrome({ on: false });
    const dbg = await import('../../src/background/debug');
    dbg.dlog('run', 'step', { tab: 1 }, { a: 1 });
    await dbg.debugReady();
    await dbg.flushDebug();
    expect(session[DEBUG_LOG_KEY]).toBeUndefined();
  });

  it('stores entries while on; tab, frame and origin of content entries come from the sender', async () => {
    const { session } = stubChrome({ on: true });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    dbg.dlog('run', 'step', { tab: 7 }, () => ({ step: 2 }));
    await dbg.addContentEntries([{ t: Date.now(), src: 'match', ev: 'found', d: { score: 90 } }], content(7, 'https://a.test', 3));
    await dbg.flushDebug();
    const buf = session[DEBUG_LOG_KEY] as DebugBuffer;
    expect(buf.entries.map((e) => [e.src, e.ev, e.tab, e.frame, e.o])).toEqual([
      ['run', 'step', 7, null, null],
      ['match', 'found', 7, 3, 'https://a.test'],
    ]);
  });

  it('never throws into the caller', async () => {
    stubChrome({ on: true });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    expect(() =>
      dbg.dlog('run', 'step', {}, () => {
        throw new Error('boom');
      }),
    ).not.toThrow();
  });

  it('turning it off stops collection and tells every tab; turning it on keeps the first start time', async () => {
    const { session, local, sent } = stubChrome({ on: false });
    const dbg = await import('../../src/background/debug');
    await dbg.setDebug(true);
    const since = (local[DEBUG_SETTING_KEY] as { since: string }).since;
    expect(since).toBeTruthy();
    expect(sent).toContainEqual([7, { type: 'debug.changed', payload: { on: true } }]);
    expect((await dbg.setDebug(true)).since).toBe(since);
    await dbg.setDebug(false);
    dbg.dlog('run', 'step', { tab: 7 }, { a: 1 });
    await dbg.flushDebug();
    const buf = session[DEBUG_LOG_KEY] as DebugBuffer | undefined;
    expect(buf?.entries.some((e) => e.ev === 'step') ?? false).toBe(false);
    expect(sent).toContainEqual([8, { type: 'debug.changed', payload: { on: false } }]);
  });

  it('the full copy has a header with version, browser and settings, but no library address or voice name', async () => {
    stubChrome({ on: true });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    dbg.dlog('run', 'run.start', { tab: 7 }, { url: 'https://a.test/orders/123?secret=1' });
    const text = await dbg.debugText();
    expect(text).toMatch(/^Waymark debug log\nVersion: 9\.9\.9\nBrowser: .*\(linux\)\nDebug log: on since 2026-11-05T12:00:00\.000Z\n/);
    expect(text).toContain('Voice: read aloud on, muted off, speed 1.2, online voices off, chosen voices 1, HD voice off');
    expect(text).toContain('Team library: subscribed; site permissions: 2');
    expect(text).toContain('url=https://a.test/orders/:id');
    expect(text).not.toContain('intranet.acme.test');
    expect(text).not.toContain('Secret Voice Name');
    expect(text).not.toContain('secret=1');
  });

  it('the page’s copy holds only its tab, its site and its current run, without settings', async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    stubChrome({ on: true, run: run(startedAt) });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    const now = Date.now();
    // Before the run, another tab, another site's frame: all left out.
    await chrome.storage.session.set({
      [DEBUG_LOG_KEY]: appendEntries(
        emptyBuffer(),
        [
          { at: now - 120_000, tab: 7, frame: 0, o: 'https://a.test', src: 'page', ev: 'page.load', d: { url: 'https://a.test/old' } },
          { at: now - 1000, tab: 8, frame: 0, o: 'https://a.test', src: 'match', ev: 'other-tab' },
          { at: now - 1000, tab: 7, frame: 4, o: 'https://ads.test', src: 'match', ev: 'other-site' },
          { at: now - 1000, tab: 7, frame: 0, o: 'https://a.test', src: 'match', ev: 'mine' },
          { at: now - 900, tab: 7, frame: null, o: null, src: 'run', ev: 'run-entry' },
        ],
        now,
      ),
    });
    const r = run(startedAt) as never;
    const text = (await dbg.debugTextForTab(7, 'https://a.test', r))!;
    expect(text).toContain(' mine');
    expect(text).toContain(' run-entry');
    for (const left of ['other-tab', 'other-site', 'page.load']) expect(text).not.toContain(left);
    expect(text).not.toMatch(/Voice:|Team library|Debug log: on/);
    // A page of another site gets nothing, nor does a tab without a run.
    expect(await dbg.debugTextForTab(7, 'https://b.test', r)).toBeNull();
    expect(await dbg.debugTextForTab(7, 'https://a.test', null)).toBeNull();
  });
});

// ---- review fixes (independent review of D110–D112); each fails on the first version ----

describe('review fixes', () => {
  it('#1 an entry is at most 1 KB stored, and a full buffer stays far below the session quota', async () => {
    const { ContentEntrySchema, MAX_ENTRY_BYTES } = await import('../../src/core/debug/log');
    const fat = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, Array.from({ length: 20 }, () => 'x'.repeat(60))]));
    // The schema already refuses what sanitizeData would clip anyway.
    expect(ContentEntrySchema.safeParse({ t: 1, src: 'match', ev: 'x', d: { a: 'x'.repeat(201) } }).success).toBe(false);
    expect(ContentEntrySchema.safeParse({ t: 1, src: 'match', ev: 'x', d: { a: Array(21).fill('x') } }).success).toBe(false);
    expect(ContentEntrySchema.safeParse({ t: 1, src: 'match', ev: 'x', d: { a: ['x'.repeat(61)] } }).success).toBe(false);
    const buf = appendEntries(emptyBuffer(), Array.from({ length: DEBUG_CAP }, (_, i) => entry(i, { d: fat })), 0);
    for (const e of buf.entries) expect(JSON.stringify(e).length).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    expect(buf.entries[0]!.d).toContainEqual(['truncated', true]);
    expect(JSON.stringify(buf).length).toBeLessThan(2.2 * 1024 * 1024);
  });

  it('#2 one tab flooding the log cannot push out other tabs’ or the service worker’s entries', async () => {
    const { session } = stubChrome({ on: true });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    dbg.dlog('run', 'mine', { tab: 7 });
    await dbg.addContentEntries([{ t: Date.now(), src: 'match', ev: 'other-tab' }], content(8, 'https://a.test'));
    for (let i = 0; i < 40; i++) await dbg.addContentEntries(Array.from({ length: 50 }, () => ({ t: Date.now(), src: 'match' as const, ev: 'flood' })), content(9, 'https://evil.test'));
    await dbg.flushDebug();
    const buf = session[DEBUG_LOG_KEY] as DebugBuffer;
    expect(buf.entries.map((e) => e.ev)).toEqual(expect.arrayContaining(['mine', 'other-tab']));
    expect(buf.entries.filter((e) => e.ev === 'flood')).toHaveLength(CONTENT_RATE_MAX);
    expect(buf.dropped).toBe(2000 - CONTENT_RATE_MAX);
  });

  it('#3 the page’s copy never holds the address of the page the tab was on before the guide opened its start page', async () => {
    const { session, local } = stubChrome({ on: true });
    const guide = {
      id: '01GUIDE0000000000000000000', revisionId: '01REV00000000000000000000', title: 'Guide', lang: 'en', version: 1, schemaVersion: 1, tags: [], matchUrls: [], source: 'local', appOrigins: ['https://a.test'],
      startUrl: 'https://a.test/', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z',
      steps: [{ id: 's1', kind: 'click', title: 'Click **Save**', url: { kind: 'pattern', value: '/' }, advance: 'action', target: { instance: 'unique', matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', cssPath: 'button', xpath: '/html[1]/body[1]/button[1]', ancestors: [], shadowPath: [], framePath: [], rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 } } }],
    };
    local['guide:' + guide.id] = guide;
    let url = 'https://bank.example/accounts/summary';
    Object.assign(chrome, {
      tabs: { ...chrome.tabs, get: async () => ({ id: 7, url }), update: async (_id: number, p: { url: string }) => void (url = p.url) },
      permissions: { ...chrome.permissions, contains: async () => true },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      tts: undefined,
    });
    const { guideKey } = await import('../../src/core/storage/guides');
    local[guideKey(guide.id)] = guide;
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    const runs = await import('../../src/background/runs');
    expect(await runs.startRunInTab(7, guide.id, true)).toEqual({ status: 'started' });
    await dbg.flushDebug();
    const text = (await dbg.debugTextForTab(7, 'https://a.test', session['run:7'] as never))!;
    // That entry is about the previous page's site, so this page's copy leaves it out.
    expect(text).not.toContain('bank.example');
    // The full log still has it, as the site and path only.
    expect(await dbg.debugText()).toContain('url=https://bank.example/accounts/summary');
  });

  it('#5 step rules in the log lose kept query keys and anything after #', () => {
    expect(sanitizeData({ page: '/orders?tab=open', expected: '/x?id=:id#frag' })).toEqual({ page: '/orders', expected: '/x' });
  });

  it('#6 Clear also drops entries still on their way from pages; switching off stops at once', async () => {
    const { session } = stubChrome({ on: true });
    const dbg = await import('../../src/background/debug');
    await dbg.debugReady();
    const before = Date.now() - 200; // waited in the page, sent after Clear
    await dbg.clearDebug();
    await dbg.addContentEntries([{ t: before, src: 'match', ev: 'late' }], content(7, 'https://a.test'));
    await dbg.flushDebug();
    expect((session[DEBUG_LOG_KEY] as DebugBuffer).entries.map((e) => e.ev)).not.toContain('late');
    const off = dbg.setDebug(false);
    expect(dbg.debugOn()).toBe(false);
    await off;
  });
});
