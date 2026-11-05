import { describe, expect, it } from 'vitest';
import { GuideSchema } from '../../src/core/model/schema';
import { createRouter } from '../../src/core/messaging/router';
import { classifySender, CONTENT_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const panel = { id: ID, url: `chrome-extension://${ID}/sidepanel.html`, origin: `chrome-extension://${ID}` };
const content = { id: ID, url: 'https://app.example.com/x', origin: 'https://app.example.com', tab: { id: 3 }, frameId: 0 };

describe('sender classification', () => {
  it('classifies extension pages and content scripts', () => {
    expect(classifySender(panel, ID)).toBe('extension');
    expect(classifySender({ ...panel, tab: { id: 1 } }, ID)).toBe('extension'); // options page in a tab
    expect(classifySender(content, ID)).toBe('content');
  });
  it('rejects other extensions and senders without a tab', () => {
    expect(classifySender({ ...content, id: 'other' }, ID)).toBeNull();
    expect(classifySender({ id: ID, url: 'https://x.test' }, ID)).toBeNull();
    // a page that pretends to be an extension URL but has a web origin
    expect(classifySender({ id: ID, url: `chrome-extension://${ID}/x`, origin: 'https://evil.test' }, ID)).toBeNull();
  });
});

describe('allowlists', () => {
  it('content scripts may send only their allowlisted types', () => {
    expect([...CONTENT_ALLOWED].sort()).toEqual(['deeplink.check', 'frame.claim', 'frame.nonce', 'frame.path', 'guide.forPage', 'launcher.start', 'pick.abort', 'pick.result', 'rec.step', 'route.report', 'run.advance', 'run.match', 'run.mute', 'run.problem', 'run.replay']);
    expect(parseMessage({ type: 'route.report', payload: { url: 'https://a/', via: 'load' } }, content, ID)).toMatchObject({ ok: true, kind: 'content' });
    expect(parseMessage({ type: 'site.list', payload: {} }, content, ID)).toEqual({ ok: false, error: 'site.list not allowed from content' });
    expect(parseMessage({ type: 'tab.current', payload: {} }, content, ID)).toMatchObject({ ok: false });
  });
  it('extension pages cannot send content-only reports', () => {
    expect(parseMessage({ type: 'frame.claim', payload: { nonce: 'x' } }, panel, ID)).toMatchObject({ ok: false });
    expect(parseMessage({ type: 'site.list', payload: {} }, panel, ID)).toMatchObject({ ok: true, kind: 'extension' });
  });
  it('validates payloads and rejects unknown types', () => {
    expect(parseMessage({ type: 'route.report', payload: { url: 1 } }, content, ID)).toEqual({ ok: false, error: 'invalid payload for route.report' });
    expect(parseMessage({ type: 'route.report', payload: { url: 'x'.repeat(5000), via: 'load' } }, content, ID)).toMatchObject({ ok: false });
    expect(parseMessage({ type: 'toString', payload: {} }, content, ID)).toEqual({ ok: false, error: 'unknown type' });
    expect(parseMessage(null, content, ID)).toEqual({ ok: false, error: 'bad message' });
  });
});

describe('router errors (D49)', () => {
  it('turns a schema failure into one sentence, never a Zod issue dump', async () => {
    const route = createRouter({ 'guide.list': () => { GuideSchema.parse({ id: 'x' }); return { guides: [] }; } }, 'ext');
    const reply = await new Promise<{ ok: boolean; error?: string }>((resolve) => route({ type: 'guide.list', payload: {} }, { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' } as never, resolve));
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/^Waymark could not use this data \(\w+ is not valid\)\.$/);
  });
  it('keeps handler sentences as they are', async () => {
    const route = createRouter({ 'guide.list': () => { throw new Error('Guide not found.'); } }, 'ext');
    const reply = await new Promise<{ ok: boolean; error?: string }>((resolve) => route({ type: 'guide.list', payload: {} }, { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' } as never, resolve));
    expect(reply.error).toBe('Guide not found.');
  });
});

describe('record sizes (D53)', () => {
  const ext = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' };
  it('caps the entries of records extension pages send', () => {
    const many = (n: number, v: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, v]));
    expect(parseMessage({ type: 'pack.import', payload: { text: '{}', choices: many(10_000, 'keep') } }, ext, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'pack.import', payload: { text: '{}', choices: many(10_001, 'keep') } }, ext, 'ext').ok).toBe(false);
    expect(parseMessage({ type: 'voice.settings.set', payload: { patch: { voices: many(200, 'v') } } }, ext, 'ext').ok).toBe(true);
    expect(parseMessage({ type: 'voice.settings.set', payload: { patch: { voices: many(201, 'v') } } }, ext, 'ext').ok).toBe(false);
  });
});
