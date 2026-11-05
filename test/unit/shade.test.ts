/**
 * The highlight shade (D144–D146): precedence, the closed set of levels, guide files with and
 * without the field, settings, and what reaches content scripts (only the resolved level).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuideSchema, type Guide } from '../../src/core/model/schema';
import { runView, startRun } from '../../src/core/player/run';
import { DEFAULT_SHADE, isShade, resolveShade, withGuideShade } from '../../src/core/player/shade';
import { PlayerSettingsSchema } from '../../src/core/player/settings';
import { duplicateGuide, makePack, parsePack } from '../../src/core/sharing/pack';
import { parseMessage } from '../../src/core/messaging/protocol';

const guide = (extra: Record<string, unknown> = {}): Guide =>
  ({
    id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'Pay a bill', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/',
    matchUrls: [], steps: [{ id: 's1', kind: 'note', title: 'Hello', url: { kind: 'prefix', value: '/' }, advance: 'next' }], version: 1, source: 'local', updatedAt: '',
    ...extra,
  }) as Guide;

afterEach(() => vi.unstubAllGlobals());

describe('precedence (D145)', () => {
  it('the learner’s own shade wins over the guide’s', () => {
    expect(resolveShade('lighter', 'darker')).toBe('lighter');
    expect(resolveShade('darker', 'lighter')).toBe('darker');
    expect(resolveShade('medium', 'darker')).toBe('medium');
  });
  it('“Follow each guide” uses the guide’s shade, else the default', () => {
    expect(resolveShade('guide', 'darker')).toBe('darker');
    expect(resolveShade('guide', undefined)).toBe(DEFAULT_SHADE);
    expect(DEFAULT_SHADE).toBe('medium');
  });
  it('anything outside the closed set counts as not set: never a free number', () => {
    for (const bad of [0.9, '0.9', 'black', '', null, {}, 'GUIDE']) {
      expect(isShade(bad)).toBe(false);
      expect(resolveShade(bad, bad)).toBe('medium');
    }
  });
});

describe('guide files (D146)', () => {
  it('an old guide without a shade still parses, and a pack of it round-trips unchanged', () => {
    const old = guide();
    expect(GuideSchema.parse(old)).toEqual(old);
    const r = parsePack(JSON.stringify(makePack([old])));
    expect(r.ok && r.pack.guides[0]).toEqual(old);
    expect(r.ok && 'shade' in r.pack.guides[0]!).toBe(false);
  });
  it('the per-guide shade round-trips through a guide file', () => {
    const g = guide({ shade: 'darker' });
    const r = parsePack(JSON.stringify(makePack([g])));
    expect(r.ok && r.pack.guides[0]!.shade).toBe('darker');
  });
  it('a shade this version does not know (a newer Waymark) imports the guide without it', () => {
    const r = parsePack(JSON.stringify(makePack([guide({ shade: 'pitch-black' })])));
    expect(r.ok).toBe(true);
    expect(r.ok && r.pack.guides[0]!.shade).toBeUndefined();
    expect(GuideSchema.parse(guide({ shade: 0.95 })).shade).toBeUndefined();
  });
});

describe('compatibility and copies (D146, review)', () => {
  it('unknown guide and pack keys are dropped, not rejected: what an older Waymark does with shade', async () => {
    const { GuidePackSchema } = await import('../../src/core/model/schema');
    const g = GuideSchema.parse({ ...guide(), futureKey: 1 });
    expect('futureKey' in g).toBe(false);
    const p = GuidePackSchema.parse({ ...makePack([{ ...guide(), futureKey: 1 } as Guide]), extra: true });
    expect('extra' in p).toBe(false);
    expect('futureKey' in p.guides[0]!).toBe(false);
  });
  it('the editor’s Default removes the field; a level sets it; Medium is the default, so it is not stored', () => {
    expect(withGuideShade(guide({ shade: 'darker' }), '')).not.toHaveProperty('shade');
    expect(withGuideShade(guide(), 'lighter').shade).toBe('lighter');
    expect(withGuideShade(guide({ shade: 'darker' }), 'medium')).not.toHaveProperty('shade');
    expect(withGuideShade(guide(), 'black')).not.toHaveProperty('shade');
  });
  it('Duplicate keeps the guide’s shade', () => {
    expect(duplicateGuide(guide({ shade: 'darker' })).shade).toBe('darker');
  });
});

describe('settings and messages (D144)', () => {
  it('defaults to following each guide; an unknown stored value falls back to it', () => {
    expect(PlayerSettingsSchema.parse({}).shade).toBe('guide');
    expect(PlayerSettingsSchema.parse({ shade: 'neon' }).shade).toBe('guide');
    expect(PlayerSettingsSchema.parse({ shade: 'lighter' }).shade).toBe('lighter');
  });
  it('player.settings.* are for extension pages only, and take only a named shade', () => {
    const ID = 'abcdefghijklmnopabcdefghijklmnop';
    const panel = { id: ID, url: `chrome-extension://${ID}/options.html`, origin: `chrome-extension://${ID}` };
    const content = { id: ID, url: 'https://app.test/x', origin: 'https://app.test', tab: { id: 3 }, frameId: 0 };
    expect(parseMessage({ type: 'player.settings.set', payload: { patch: { shade: 'darker' } } }, panel, ID)).toMatchObject({ ok: true });
    expect(parseMessage({ type: 'player.settings.set', payload: { patch: { shade: 0.9 } } }, panel, ID)).toMatchObject({ ok: false });
    expect(parseMessage({ type: 'player.settings.set', payload: { patch: { shade: 'lighter' } } }, content, ID)).toMatchObject({ ok: false });
    expect(parseMessage({ type: 'player.settings.get', payload: {} }, content, ID)).toMatchObject({ ok: false });
  });
});

describe('what content scripts get (D145)', () => {
  async function view(local: Record<string, unknown>, g: Guide, url: string) {
    const run = startRun(g);
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: async (k: string) => (k === 'run:5' ? { [k]: run } : {}) },
        local: { get: async (k: string) => ({ [k]: local[k] }) },
      },
    });
    const { viewFor } = await import('../../src/background/runs');
    return viewFor(5, url);
  }

  it('the run view carries only the resolved level, never the settings or the guide’s own field', async () => {
    const v = await view({ playerSettings: { shade: 'guide' } }, guide({ shade: 'darker' }), 'https://app.test/');
    expect(v.shade).toBe('darker');
    // Exactly the run view's own fields plus muted and shade: no settings object, nothing else (review).
    expect(Object.keys(v).sort()).toEqual([...new Set([...Object.keys(runView(startRun(guide({ shade: 'darker' })))), 'muted', 'shade'])].sort());
    expect(JSON.stringify(v)).not.toContain('"guide"');
    const mine = await view({ playerSettings: { shade: 'lighter' } }, guide({ shade: 'darker' }), 'https://app.test/');
    expect(mine.shade).toBe('lighter');
  });
  it('on another site the view says Medium, whatever the guide or the learner picked', async () => {
    const v = await view({}, guide({ shade: 'darker' }), 'https://other.test/');
    expect(v.shade).toBe('medium');
    const mine = await view({ playerSettings: { shade: 'darker' } }, guide({ shade: 'lighter' }), 'https://other.test/');
    expect(mine.shade).toBe('medium');
  });
});
