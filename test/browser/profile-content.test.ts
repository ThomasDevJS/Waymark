/**
 * Review fixes of D213 in a real browser: the recorder starts only once the site's profile is in
 * (a click before it is never recorded without the profile), and the panel's "For this page"
 * reads the address with the site's profile, as the badge and the launcher do.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { startRecordingClient } from '../../src/content/recording';
import { Library } from '../../src/entrypoints/sidepanel/Library';
import { destroyOverlay } from '../../src/content/overlay/host';
import type { RecordingView } from '../../src/core/recorder/session';
import type { GuideIndexEntry } from '../../src/core/storage/guides';

let sent: { type: string; payload: unknown }[];
let releaseProfile: () => void;
let local: Record<string, unknown>;

const marker = (n: string) => document.documentElement.getAttribute(`data-waymark-test-${n}`);
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  sent = [];
  local = {};
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  releaseProfile = release;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext',
      sendMessage: async (m: { type: string; payload: unknown }) => {
        sent.push(m);
        if (m.type === 'profile.get') {
          await gate;
          return { ok: true, data: { profile: { origin: location.origin, stableAttributes: ['data-automation-id'], ignorePatterns: [], hashRouting: false, keepQueryKeys: [] } } };
        }
        if (m.type === 'recorder.settings.get') return { ok: true, data: { hover: false } };
        if (m.type === 'guide.list') return { ok: true, data: { guides: [entry] } };
        if (m.type === 'completions.list') return { ok: true, data: { completed: {} } };
        if (m.type === 'allow.pending') return { ok: true, data: { origins: [] } };
        if (m.type === 'trash.list') return { ok: true, data: { items: [] } };
        if (m.type === 'stats.summary') return { ok: true, data: { counts: {} } };
        return { ok: true, data: { ok: true } };
      },
      onMessage: { addListener() {}, removeListener() {} },
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    storage: {
      onChanged: { addListener() {}, removeListener() {} },
      session: { get: async () => ({}), remove: async () => undefined },
      local: { get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in local).map((x) => [x, local[x]])), set: async () => undefined },
    },
  };
});
afterEach(() => destroyOverlay());

const entry: GuideIndexEntry = {
  id: 'G1', revisionId: 'R1', title: 'Hash orders', tags: [], startUrl: 'https://app.test/', updatedAt: '', appOrigins: ['https://app.test'],
  matchUrls: [{ kind: 'pattern', value: '/orders' }], source: 'local', steps: 1, stepTitles: 'Click',
};

describe('the recorder waits for the site profile (D213 review)', () => {
  it('a click before the profile is in records nothing; after it, the stable attribute is the test id', async () => {
    const root = document.createElement('div');
    const b = document.createElement('button');
    b.textContent = 'Save';
    b.setAttribute('data-automation-id', 'save-order');
    root.append(b);
    document.body.append(root);
    const client = startRecordingClient(() => []);
    const view = { active: true, paused: false } as RecordingView;
    client.apply(view);
    expect(marker('recording')).toBe('starting');
    await userEvent.click(b);
    await tick(500);
    expect(sent.filter((m) => m.type === 'rec.step')).toHaveLength(0);
    releaseProfile();
    await tick();
    expect(marker('recording')).toBe('on');
    await userEvent.click(b);
    await tick(800);
    const steps = sent.filter((m) => m.type === 'rec.step').map((m) => (m.payload as { step: { target?: { testId?: unknown } } }).step);
    expect(steps.at(-1)?.target?.testId).toEqual({ attr: 'data-automation-id', value: 'save-order' });
    client.dispose();
    root.remove();
  });
});

describe('the panel’s "For this page" with the site profile (D213 review)', () => {
  it('lists a guide for a hash-routed page when the site’s profile says hash routing', async () => {
    local.siteProfiles = { 'https://app.test': { origin: 'https://app.test', stableAttributes: [], ignorePatterns: [], hashRouting: true, keepQueryKeys: [] } };
    const root = document.createElement('div');
    document.body.append(root);
    render(h(Library, { tabId: 1, tabUrl: 'https://app.test/index.html#/orders', onEdit: () => undefined, onStart: () => undefined }), root);
    await tick(150);
    expect(root.querySelector('[aria-labelledby="for-page-label"]')?.textContent).toContain('Hash orders');
    render(null, root);
    root.remove();
  });
});
