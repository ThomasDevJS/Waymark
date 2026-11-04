/** D48: content scripts on another site learn only that a run exists, not which guide. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Guide } from '../../src/core/model/schema';
import { startRun } from '../../src/core/player/run';

const guide: Guide = {
  id: 'g1', schemaVersion: 1, revisionId: 'r1', title: 'Payroll at Acme', lang: 'en', tags: [],
  appOrigins: ['https://app.test', 'https://internal-hr.test'], startUrl: 'https://app.test/', matchUrls: [],
  steps: [{ id: 's1', kind: 'note', title: 'Hello', note: 'Secret', url: { kind: 'prefix', value: '/' }, advance: 'next' }],
  version: 1, source: 'local', updatedAt: '',
};

afterEach(() => vi.unstubAllGlobals());

describe('run view off the guide sites (D48)', () => {
  it('carries no guide id, title, sites or step', async () => {
    const run = startRun(guide);
    vi.stubGlobal('chrome', {
      storage: {
        session: { get: async (k: string) => (k === 'run:5' ? { [k]: run } : {}) },
        local: { get: async () => ({}) },
      },
    });
    const { viewFor } = await import('../../src/background/runs');
    const off = await viewFor(5, 'https://other.example/page');
    expect(off.active).toBe(true);
    expect(JSON.stringify(off)).not.toMatch(/Acme|internal-hr|g1|Secret|Hello/);
    const on = await viewFor(5, 'https://app.test/');
    expect(on.guideTitle).toBe('Payroll at Acme');
    expect(on.step?.id).toBe('s1');
  });
});
