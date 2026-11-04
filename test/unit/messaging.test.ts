import { describe, expect, it } from 'vitest';
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
    expect([...CONTENT_ALLOWED].sort()).toEqual(['frame.claim', 'frame.nonce', 'frame.path', 'guide.forPage', 'rec.step', 'route.report', 'run.advance', 'run.match', 'run.mute', 'run.problem']);
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
