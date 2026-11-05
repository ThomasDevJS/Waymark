/**
 * PR B conveniences (D104–D106): the text how-to export, the recording shortcut, and the
 * tooltip's Replay voice / Repeat step message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memArea } from '../perf/fixtures';
import type { Guide } from '../../src/core/model/schema';
import { howtoHtml, howtoMarkdown, howtoStrings, looksLikeData, stripUrls } from '../../src/core/sharing/howto';
import { applyRemovals, packStrings } from '../../src/core/sharing/review';
import { exportText } from '../../src/entrypoints/sidepanel/ExportReview';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';
import { startRun } from '../../src/core/player/run';

const target = {
  instance: 'unique' as const, matchCount: 1, tag: 'button', role: 'button', accessibleName: 'Save', id: 'save-btn-secret',
  cssPath: '#save-btn-secret', xpath: '/html/body/button', ancestors: [{ tag: 'main', label: 'Payroll panel' }], shadowPath: [], framePath: [],
  rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1 }, hrefPath: '/internal/path',
};
const guide: Guide = {
  id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay <a contractor> & more', description: 'For the *finance* team.', lang: 'en', tags: ['secret-tag'],
  appOrigins: ['https://app.test'], startUrl: 'https://app.test/payroll/run?id=77', matchUrls: [{ kind: 'prefix', value: '/payroll' }], version: 1, source: 'local', updatedAt: '',
  steps: [
    { id: 'S1', kind: 'click', title: 'Click **Save** <script>x</script>', note: 'See [the docs](https://docs.example.com/x) or https://app.test/help?q=1\nthen wait', voiceText: 'VOICE-ONLY', url: { kind: 'prefix', value: '/payroll/run' }, target, advance: 'action' },
    { id: 'S2', kind: 'note', title: 'All done', note: 'Mail ada@example.com', url: { kind: 'prefix', value: '/payroll' }, advance: 'next' },
  ],
};

describe('how-to export (D104)', () => {
  it('Markdown: numbered titles and notes, only the start origin as an address', () => {
    const md = howtoMarkdown([guide]);
    expect(md).toBe(
      [
        '# Pay \\<a contractor\\> \\& more',
        '',
        'For the \\*finance\\* team.',
        '',
        'Start at https://app.test',
        '',
        '1. Click **Save** \\<script\\>x\\</script\\>',
        '',
        '   See the docs or https://app.test',
        '   then wait',
        '',
        '2. All done',
        '',
        '   Mail ada@example.com',
        '',
      ].join('\n'),
    );
    for (const leak of ['docs.example.com', '/payroll', 'help', 'save-btn-secret', 'Payroll panel', 'VOICE-ONLY', 'secret-tag', '/internal/path', 'id=77']) expect(md).not.toContain(leak);
  });

  it('HTML: escaped, no script, no remote resources, printable', () => {
    const html = howtoHtml([guide]);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Pay &lt;a contractor&gt; &amp; more</title>');
    expect(html).toContain('<strong>Save</strong> &lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toMatch(/<script|<a |href=|src=|@import|url\(/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('@media print');
    expect(html).toContain('See the docs or https://app.test<br>then wait');
    for (const leak of ['docs.example.com', '/payroll', 'save-btn-secret', 'VOICE-ONLY', 'secret-tag']) expect(html).not.toContain(leak);
    // Several guides: one heading each under "Guides".
    const two = howtoHtml([guide, { ...guide, id: 'G2', title: 'Second' }]);
    expect(two).toContain('<h1>Guides</h1>');
    expect(two.match(/<h2>/g)).toHaveLength(2);
  });

  it('addresses: start origin kept as the origin, everything else removed', () => {
    expect(stripUrls('go to https://app.test/a/b?c and http://evil.test/x or www.app.test/z', 'https://app.test')).toBe('go to https://app.test and [link removed] or [link removed]');
    expect(stripUrls('see www.other.test/page', 'https://app.test')).toBe('see [link removed]');
  });

  it('addresses never leak through markdown, other schemes, bare hosts or escapes (review)', () => {
    const o = 'https://app.test';
    const leaks = [
      'Open https://corp.example/reports/q3_customer_list_2026',
      'https://**evil**.com/secret',
      'https://*evil*.com/a',
      'ftp://files.corp.example/x',
      'file:///etc/passwd',
      '//evil.com/secret',
      'https:evil.com/secret',
      'intranet.corp.example/admin/users/42',
      'jira.corp.example/browse/FIN-1234',
      'xhttps://evil.com/s',
      'see_https://evil.com/s',
      'https\\://evil.com/t',
      'q3\\_list at https://corp.example/a\\_b\\_c',
      '[docs](https://evil.com/p)',
      'javascript:alert(1)',
    ];
    const secrets = /corp\.example|evil\.com|etc\/passwd|evil|alert/;
    for (const text of leaks) {
      const g = { ...guide, description: text, title: text, steps: [{ ...guide.steps[1]!, title: text, note: text }] };
      for (const out of [howtoMarkdown([g]), howtoHtml([g])]) expect(out, text).not.toMatch(secrets);
    }
    expect(stripUrls('Help: https://app.test/help_page_1?q=1', o)).toBe('Help: https://app.test');
  });

  it('Markdown: raw HTML, entities and line starts cannot change the document (review)', () => {
    const g = {
      ...guide,
      title: '# Fake',
      description: '<img src=x>\n# Heading\n1. Fake step\n> quote\n---\n| a | b |\n&#104;ello `code`',
      steps: [{ ...guide.steps[1]!, title: '- not a bullet', note: '## not a heading\n2) nope' }],
    };
    const md = howtoMarkdown([g]);
    expect(md).toContain('# \\# Fake\n');
    expect(md).toContain('\\<img src=x\\>');
    expect(md).toContain('\n\\# Heading\n');
    expect(md).toContain('\n1\\. Fake step\n');
    expect(md).toContain('\n\\> quote\n');
    expect(md).toContain('\n\\---\n');
    expect(md).toContain('\\| a \\| b \\|');
    expect(md).toContain('\\&#104;ello \\`code\\`');
    expect(md).toContain('1. \\- not a bullet');
    expect(md).toContain('   \\## not a heading\n   2\\) nope');
    expect(md.match(/^#{1,2} /gm)).toEqual(['# ']);
  });

  it('the review lists what the how-to holds, with the pack keys, so the same removals apply', () => {
    const strings = howtoStrings([guide]);
    expect(strings.map((s) => s.kind)).toEqual(['guide-title', 'description', 'site', 'step-title', 'note', 'step-title', 'note']);
    expect(strings.find((s) => s.kind === 'site')?.value).toBe('https://app.test');
    const packKeys = new Set(packStrings([guide]).map((s) => s.key));
    for (const s of strings.filter((x) => x.removable)) expect(packKeys.has(s.key)).toBe(true);
    const drop = new Set(['G1|S2|note', 'G1||description']);
    const md = exportText([guide], drop, 'markdown');
    expect(md).not.toContain('ada@example.com');
    expect(md).not.toContain('finance');
    expect(applyRemovals([guide], drop)[0]!.steps[1]!.note).toBeUndefined();
    expect(guide.steps[1]!.note).toBe('Mail ada@example.com'); // the stored guide is not changed
  });

  it('flags text that looks like data with the recorder filter, a few words at a time', () => {
    expect(looksLikeData({ kind: 'note', value: 'Mail ada@example.com about it' })).toBe(true);
    expect(looksLikeData({ kind: 'step-title', value: 'Enter **$1,200.00**' })).toBe(true);
    expect(looksLikeData({ kind: 'note', value: 'Pick invoice INV-2039 from the list' })).toBe(true);
    expect(looksLikeData({ kind: 'note', value: 'A long but harmless note that explains where the Save button is and what happens next when you press it.' })).toBe(false);
    expect(looksLikeData({ kind: 'step-title', value: 'Click **Save**' })).toBe(false);
    expect(looksLikeData({ kind: 'selector', value: 'INV-2039' })).toBe(false); // only text kinds
    // A single long token (an API key) is data, even though no 4-word chunk fits in 80 characters (review).
    expect(looksLikeData({ kind: 'note', value: `Use key sk_live_${'a1B2c3D4'.repeat(11)} here` })).toBe(true);
  });
});

describe('messages (D105, D106)', () => {
  const content = { id: 'x', url: 'https://app.test/', origin: 'https://app.test', tab: { id: 1 } };
  it('run.replay is a content message with a bounded step id', () => {
    expect(CONTENT_ALLOWED.has('run.replay')).toBe(true);
    expect(EXTENSION_ALLOWED.has('run.replay')).toBe(false);
    expect(parseMessage({ type: 'run.replay', payload: { stepId: 'S1' } }, content, 'x').ok).toBe(true);
    expect(parseMessage({ type: 'run.replay', payload: { stepId: 'x'.repeat(65) } }, content, 'x').ok).toBe(false);
    expect(parseMessage({ type: 'run.replay', payload: {} }, content, 'x').ok).toBe(false);
  });
});

describe('Replay voice in the service worker (D106)', () => {
  let session: ReturnType<typeof memArea>;
  let local: ReturnType<typeof memArea>;
  let spoken: string[];
  beforeEach(async () => {
    session = memArea();
    local = memArea();
    spoken = [];
    vi.stubGlobal('chrome', {
      storage: { local, session },
      tabs: { get: async () => ({ id: 5, url: 'https://app.test/payroll/run', active: true, windowId: 1 }), sendMessage: async () => undefined },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      tts: { speak: (t: string) => spoken.push(t), stop: () => undefined, getVoices: (cb: (v: unknown[]) => void) => cb([{ voiceName: 'Local', lang: 'en-US', remote: false }]) },
      offscreen: undefined,
      runtime: { getContexts: async () => [] },
    });
    await session.set({ 'run:5': startRun(guide) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const ctx = (origin = 'https://app.test') => ({ kind: 'content', tabId: 5, frameId: 0, sender: { origin, tab: { id: 5 } } }) as never;

  it('reads the current step again, even with "Read each step aloud" off, but not when muted', async () => {
    const { runHandlers, REPLAY_MIN_MS } = await import('../../src/background/runs');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(10_000);
    await local.set({ voiceSettings: { autoPlay: false } });
    expect(await runHandlers['run.replay']!({ stepId: 'S1' }, ctx())).toEqual({ ok: true });
    expect(spoken).toEqual(['VOICE-ONLY']);
    // Throttled: a page cannot keep the voice busy.
    expect(await runHandlers['run.replay']!({ stepId: 'S1' }, ctx())).toEqual({ ok: false });
    vi.setSystemTime(10_000 + REPLAY_MIN_MS + 1);
    await local.set({ voiceSettings: { muted: true } });
    await runHandlers['run.replay']!({ stepId: 'S1' }, ctx());
    expect(spoken).toHaveLength(1);
  });

  it('refuses another step, another tab or another site', async () => {
    const { runHandlers } = await import('../../src/background/runs');
    expect(await runHandlers['run.replay']!({ stepId: 'S2' }, ctx())).toEqual({ ok: false });
    expect(await runHandlers['run.replay']!({ stepId: 'S1' }, ctx('https://evil.test'))).toEqual({ ok: false });
    expect(await runHandlers['run.replay']!({ stepId: 'S1' }, { kind: 'content', tabId: 9, frameId: 0, sender: { origin: 'https://app.test' } } as never)).toEqual({ ok: false });
    expect(spoken).toEqual([]);
  });
});

describe('recording shortcut (D105)', () => {
  let session: ReturnType<typeof memArea>;
  let opened: unknown[];
  beforeEach(() => {
    session = memArea();
    opened = [];
    vi.stubGlobal('chrome', {
      storage: { local: memArea(), session },
      tabs: { get: async () => ({ id: 3, url: 'https://app.test/start', windowId: 2 }), sendMessage: async () => undefined, query: async () => [] },
      permissions: { contains: async () => true },
      action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
      sidePanel: { open: async (o: unknown) => void opened.push(o) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts in the tab, then stops and saves, telling the panel each time', async () => {
    const { toggleRecording, onShortcut } = await import('../../src/background/shortcuts');
    const tab = { id: 3, windowId: 2 } as chrome.tabs.Tab;
    expect(await toggleRecording(tab)).toMatchObject({ kind: 'started', tabId: 3 });
    expect((await session.get('recording')).recording).toMatchObject({ title: 'Untitled guide', tabIds: [3] });
    const stop = await toggleRecording(tab);
    expect(stop).toMatchObject({ kind: 'stopped', title: 'Untitled guide', count: 0 });
    expect((await session.get('shortcut:last'))['shortcut:last']).toEqual(stop);
    expect((await session.get('recording')).recording).toBeUndefined();
    // The command opens the side panel at once (while the key press is a user gesture).
    expect(onShortcut('toggle-recording', tab)).toBe(true);
    expect(opened).toEqual([{ windowId: 2 }]);
    expect(onShortcut('next-step', tab)).toBe(false);
    await vi.waitFor(async () => expect((await session.get('recording')).recording).toBeDefined());
  });

  it('a quick double press is start then stop, never two starts; outcomes name the window (review)', async () => {
    const { toggleRecording } = await import('../../src/background/shortcuts');
    const tab = { id: 3, windowId: 2 } as chrome.tabs.Tab;
    const [a, b] = await Promise.all([toggleRecording(tab), toggleRecording(tab)]);
    expect(a).toMatchObject({ kind: 'started', windowId: 2 });
    expect(b).toMatchObject({ kind: 'stopped', windowId: 2 });
  });

  it('a site Waymark is not allowed on is refused with the reason', async () => {
    vi.stubGlobal('chrome', { ...(globalThis as unknown as { chrome: object }).chrome, permissions: { contains: async () => false } });
    const { toggleRecording } = await import('../../src/background/shortcuts');
    const out = await toggleRecording({ id: 3, windowId: 2 } as chrome.tabs.Tab);
    expect(out).toMatchObject({ kind: 'error', message: 'Allow Waymark on this site first.' });
    expect((await toggleRecording(undefined)).kind).toBe('error');
  });
});
