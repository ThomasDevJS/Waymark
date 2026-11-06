/** D155: embedded sites a frame reports, cleaned and stored per tab; frame injection matching. */
import { describe, expect, it } from 'vitest';
import { childFrameOrigins, cleanEmbedOrigins, embedOrigins, frameOrigin, MAX_EMBED_FRAMES, MAX_EMBED_ORIGINS, withReport, type EmbedMap } from '../../src/core/frames/embeds';
import { isSiteOrigin } from '../../src/core/model/schema';
import { originMatchesPattern } from '../../src/core/permissions/registration';

describe('embedded sites (D155)', () => {
  it('a frame address gives its http(s) origin only', () => {
    expect(frameOrigin('https://1504077899-atari-embeds.googleusercontent.com/embeds/x/inner.html?secret=1#t', 'https://sites.google.com/view/a')).toBe('https://1504077899-atari-embeds.googleusercontent.com');
    expect(frameOrigin('/same/page.html', 'https://sites.google.com/view/a')).toBe('https://sites.google.com');
    for (const src of ['about:blank', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://a.test/x', 'chrome-extension://abc/x.html']) expect(frameOrigin(src, 'https://a.test/'), src).toBeNull();
  });

  it('lists direct child frames of other sites, in open shadow roots too, not srcdoc or the own site', () => {
    const host = document.createElement('div');
    const sr = host.attachShadow({ mode: 'open' });
    const inShadow = document.createElement('iframe');
    inShadow.setAttribute('src', 'https://app.example/x');
    sr.append(inShadow);
    const own = document.createElement('iframe');
    own.setAttribute('src', `${location.origin}/frame.html`);
    const other = document.createElement('iframe');
    other.setAttribute('src', 'https://embed.example/inner?q=1');
    const srcdoc = document.createElement('iframe');
    srcdoc.setAttribute('srcdoc', '<p>x</p>');
    document.body.append(host, own, other, srcdoc);
    try {
      expect(childFrameOrigins(document)).toEqual(['https://app.example', 'https://embed.example']);
    } finally {
      host.remove();
      own.remove();
      other.remove();
      srcdoc.remove();
    }
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
    expect(originMatchesPattern('https://a.test', 'https://*/*')).toBe(false);
  });
});
