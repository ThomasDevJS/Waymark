/** D155: embedded sites a frame reports, cleaned and stored per tab; frame injection matching. */
import { describe, expect, it } from 'vitest';
import { cleanEmbedOrigins, embedOrigins, frameOrigin, googleSitesNotice, isGoogleSitesWrapper, MAX_EMBED_FRAMES, MAX_EMBED_ORIGINS, reportsSince, withReport, type EmbedMap } from '../../src/core/frames/embeds';
import { isSiteOrigin } from '../../src/core/model/schema';
import { originMatchesPattern } from '../../src/core/permissions/registration';

describe('embedded sites (D155)', () => {
  it('a frame address gives its http(s) origin only', () => {
    expect(frameOrigin('https://1504077899-atari-embeds.googleusercontent.com/embeds/x/inner.html?secret=1#t', 'https://sites.google.com/view/a')).toBe('https://1504077899-atari-embeds.googleusercontent.com');
    expect(frameOrigin('/same/page.html', 'https://sites.google.com/view/a')).toBe('https://sites.google.com');
    for (const src of ['about:blank', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://a.test/x', 'chrome-extension://abc/x.html']) expect(frameOrigin(src, 'https://a.test/'), src).toBeNull();
  });

  it('a report is cleaned: real site origins only, no wildcards, deduplicated, capped', () => {
    const bad = ['https://*.googleusercontent.com', 'https://a.test/path', 'javascript:1', 'chrome://settings', 'null', 'https://a.test'];
    expect(cleanEmbedOrigins(bad, isSiteOrigin)).toEqual(['https://a.test']);
    const many = Array.from({ length: 40 }, (_, i) => `https://s${String(i).padStart(2, '0')}.test`);
    expect(cleanEmbedOrigins(many, isSiteOrigin)).toHaveLength(MAX_EMBED_ORIGINS);
  });

  it('stores per frame, writes only on change, drops a frame with nothing embedded, keeps the newest frames', () => {
    let map: EmbedMap = {};
    map = withReport(map, 0, ['https://w1.test'], 1)!;
    expect(withReport(map, 0, ['https://w1.test'], 2)).toBeNull(); // unchanged: no write
    map = withReport(map, 7, ['https://app.test'], 3)!;
    expect(embedOrigins(map)).toEqual(['https://app.test', 'https://w1.test']);
    map = withReport(map, 7, [], 4)!;
    expect(embedOrigins(map)).toEqual(['https://w1.test']);
    for (let i = 0; i < MAX_EMBED_FRAMES + 10; i++) map = withReport(map, 100 + i, [`https://f${i}.test`], 10 + i) ?? map;
    expect(Object.keys(map)).toHaveLength(MAX_EMBED_FRAMES);
    expect(map['0']).toBeUndefined(); // the oldest went first
  });

  it('frame injection matches a frame to a granted pattern by scheme and host, any port', () => {
    expect(originMatchesPattern('http://127.0.0.2:4173', 'http://127.0.0.2/*')).toBe(true);
    expect(originMatchesPattern('https://a.test', 'http://a.test/*')).toBe(false);
    expect(originMatchesPattern('https://b.a.test', 'https://a.test/*')).toBe(false);
    expect(originMatchesPattern('null', 'https://a.test/*')).toBe(false);
    expect(originMatchesPattern('chrome-extension://abc', '*://*/*')).toBe(false);
  });

  it('also matches the patterns Chrome’s own site access grants (review of D155)', () => {
    expect(originMatchesPattern('https://a.test', 'https://*/*')).toBe(true); // "On all sites"
    expect(originMatchesPattern('http://a.test', 'https://*/*')).toBe(false);
    expect(originMatchesPattern('http://a.test:8080', '*://a.test/*')).toBe(true);
    expect(originMatchesPattern('https://a.test', '*://a.test/*')).toBe(true);
    expect(originMatchesPattern('https://x.y.a.test', 'https://*.a.test/*')).toBe(true);
    expect(originMatchesPattern('https://a.test', 'https://*.a.test/*')).toBe(true);
    expect(originMatchesPattern('https://evil-a.test', 'https://*.a.test/*')).toBe(false);
    expect(originMatchesPattern('https://a.test', '<all_urls>')).toBe(false);
  });

  it('a new top page drops the reports of the pages before it, not its own frames’ (review of D155)', () => {
    const map: EmbedMap = { '0': { origins: ['https://w.test'], at: 100 }, '5': { origins: ['https://app.test'], at: 205 }, '9': { origins: ['https://old.test'], at: 150 } };
    expect(Object.keys(reportsSince(map, 200)!)).toEqual(['5']);
    expect(reportsSince(map, 50)).toBeNull();
  });
});

describe('Google Sites wording (D201)', () => {
  const w1 = 'https://1504077899-atari-embeds.googleusercontent.com';
  const w2 = 'https://2203344556-atari-embeds.googleusercontent.com';
  it('recognises only Google Sites embed wrappers', () => {
    expect(isGoogleSitesWrapper(w1)).toBe(true);
    for (const o of [
      'https://atari-embeds.googleusercontent.com',
      'http://1504077899-atari-embeds.googleusercontent.com',
      'https://1504077899-atari-embeds.googleusercontent.com.evil.test',
      'https://x.1504077899-atari-embeds.googleusercontent.com',
      'https://lh3.googleusercontent.com',
      'https://1504077899-atari-embeds.evil.test',
    ])
      expect(isGoogleSitesWrapper(o), o).toBe(false);
  });
  it('“updated” on a Google Site whose earlier wrapper was allowed; “first” before that; nothing elsewhere', () => {
    expect(googleSitesNotice('https://sites.google.com', [w2], [w1, 'https://app.test'])).toBe('updated');
    expect(googleSitesNotice('https://sites.google.com', [w1], ['https://app.test'])).toBe('first');
    expect(googleSitesNotice('https://sites.google.com', ['https://app.test'], [w1])).toBeNull();
    expect(googleSitesNotice('https://example.com', [w2], [w1])).toBeNull();
    expect(googleSitesNotice(null, [w2], [w1])).toBeNull();
  });
});

