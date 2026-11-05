/**
 * When the HD voice is offered (D140–D143): asked once, only for English, only on a capable
 * device, only when "Read each step aloud" is on and HD isn't installed. Also: the size the
 * offer names matches the files, the bundled sample is small and shipped, and voice.stop is an
 * extension-page message only.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMessage } from '../../src/core/messaging/protocol';
import { runView, startRun } from '../../src/core/player/run';
import type { Guide } from '../../src/core/model/schema';
import { HD_FILES, HD_TOTAL_BYTES, mb } from '../../src/core/voice/hd';
import { deviceLooksCapable, hdOfferBlocked, shouldOfferHd, type HdOfferInput } from '../../src/core/voice/offer';

const base: HdOfferInput = { uiLang: 'en-GB', cores: 8, memoryGb: 8, contentLang: 'en', hd: 'off', autoPlay: true, muted: false, answered: undefined };
const offer = (patch: Partial<HdOfferInput>) => shouldOfferHd({ ...base, ...patch });

describe('hd offer gating', () => {
  it('shows on a capable English browser, HD off, read-aloud on, not asked yet', () => {
    expect(hdOfferBlocked(base)).toBeNull();
    expect(offer({ uiLang: 'en' })).toBe(true);
    expect(offer({ contentLang: 'en-US' })).toBe(true);
  });

  it('language: only an English browser, and only for English text', () => {
    expect(hdOfferBlocked({ ...base, uiLang: 'fr-FR' })).toBe('not-english');
    expect(offer({ uiLang: 'de' })).toBe(false);
    // An unknown browser language is not English (primaryLang would default to "en").
    expect(offer({ uiLang: undefined })).toBe(false);
    expect(offer({ uiLang: '' })).toBe(false);
    expect(offer({ contentLang: 'es' })).toBe(false);
  });

  it('capability: at least 4 cores and, where known, 4 GB of memory', () => {
    expect(hdOfferBlocked({ ...base, cores: 2 })).toBe('device');
    expect(offer({ cores: 3 })).toBe(false);
    expect(offer({ cores: 4, memoryGb: 4 })).toBe(true);
    expect(offer({ memoryGb: 2 })).toBe(false);
    expect(offer({ memoryGb: undefined })).toBe(true); // browsers without navigator.deviceMemory
    expect(offer({ cores: undefined })).toBe(false);
    expect(deviceLooksCapable(Number.NaN, 8)).toBe(false);
  });

  it('asked once: either answer hides it for good', () => {
    expect(hdOfferBlocked({ ...base, answered: 'later' })).toBe('answered');
    expect(offer({ answered: 'download' })).toBe(false);
  });

  it('never when HD is installed, downloading, too slow or failed', () => {
    for (const hd of ['ready', 'downloading', 'checking', 'slow', 'error'] as const) expect(hdOfferBlocked({ ...base, hd })).toBe('installed');
  });

  it('never when "Read each step aloud" is off or the voice is muted', () => {
    expect(hdOfferBlocked({ ...base, autoPlay: false })).toBe('read-aloud-off');
    expect(hdOfferBlocked({ ...base, muted: true })).toBe('muted');
  });
});

describe('hd offer facts', () => {
  it('the size the offer and Settings name is every file the download fetches', () => {
    expect(HD_TOTAL_BYTES).toBe(HD_FILES.reduce((n, f) => n + f.size, 0));
    expect(mb(HD_TOTAL_BYTES)).toBe('170 MB');
  });

  it('the sample is bundled (public/), small, and an Ogg file', () => {
    const file = join(process.cwd(), 'public/hd-sample.ogg');
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(40_000);
    expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('OggS');
  });

  it('voice.stop is for extension pages only: a page can never stop speech through it', () => {
    const ID = 'abcdefghijklmnopabcdefghijklmnop';
    const panel = { id: ID, url: `chrome-extension://${ID}/sidepanel.html`, origin: `chrome-extension://${ID}` };
    const content = { id: ID, url: 'https://app.example.com/x', origin: 'https://app.example.com', tab: { id: 3 }, frameId: 0 };
    expect(parseMessage({ type: 'voice.stop', payload: {} }, panel, ID)).toMatchObject({ ok: true });
    expect(parseMessage({ type: 'voice.stop', payload: {} }, content, ID)).toMatchObject({ ok: false });
  });
});

describe('the panel learns the guide language from the run view', () => {
  it('runView passes the guide lang, so a French guide never gets the offer in the panel', () => {
    const guide: Guide = {
      id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'Demo', lang: 'fr', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/',
      matchUrls: [], steps: [{ id: 'a', kind: 'note', title: 'Bonjour', url: { kind: 'pattern', value: '/' }, advance: 'next' }], version: 1, source: 'local', updatedAt: '',
    };
    const view = runView(startRun(guide));
    expect(view.lang).toBe('fr');
    expect(shouldOfferHd({ ...base, contentLang: view.lang ?? 'en' })).toBe(false);
  });
});
