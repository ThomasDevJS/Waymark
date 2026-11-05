/** Realistic guide libraries for the performance harness (spec: 1 to 1.5 KB per step). */
import type { Guide, Step } from '../../src/core/model/schema';

const pad = (n: number, w = 4) => String(n).padStart(w, '0');
/** A 26-character id-like string (same shape as a ULID). */
export const fakeId = (prefix: string, n: number) => (prefix + pad(n, 8)).padEnd(26, '0').slice(0, 26);

export function makeStep(g: number, s: number): Step {
  return {
    id: fakeId(`S${pad(g)}`, s),
    kind: s % 7 === 0 ? 'input' : 'click',
    title: `Click **Save changes ${s}** in the settings panel`,
    note: s % 5 === 0 ? 'Use this when the customer asks for a refund. *Check the order first.*' : undefined,
    url: { kind: 'pattern', value: `/app/section-${s % 9}/:id/edit` },
    advance: 'action',
    target: {
      instance: 'unique',
      matchCount: 1,
      testId: { attr: 'data-testid', value: `settings-save-${s}` },
      tag: 'button',
      role: 'button',
      accessibleName: `Save changes ${s}`,
      text: `Save changes ${s}`,
      cssPath: `main.app-shell > section.settings-panel[aria-label="Account settings"] > div.form-row:nth-of-type(${s % 12}) > div.actions > button.btn.btn-primary`,
      xpath: `/html[1]/body[1]/div[1]/main[1]/section[2]/div[${s % 12}]/div[3]/button[1]`,
      ancestors: [
        { tag: 'main', role: 'main' },
        { tag: 'section', role: 'region', label: 'Account settings' },
        { tag: 'form', role: 'form', label: 'Profile' },
      ],
      shadowPath: [],
      framePath: [],
      rect: { x: 812, y: 640 + s, w: 120, h: 36, vw: 1440, vh: 900 },
      hrefPath: undefined,
      name: `save-${s}`,
    },
  } as Step;
}

/** `count` guides of `steps` steps over `origins` sites. */
export function makeGuides(count: number, steps: number, origins = 20): Guide[] {
  return Array.from({ length: count }, (_, g) => {
    const origin = `https://app${g % origins}.example.com`;
    return {
      id: fakeId('G', g),
      schemaVersion: 1,
      revisionId: fakeId('R', g),
      title: `How to update billing settings ${g}`,
      description: `Walkthrough number ${g} for the support team.`,
      lang: 'en',
      tags: ['billing', `team-${g % 7}`],
      appOrigins: [origin],
      startUrl: `${origin}/app/section-${g % 9}`,
      matchUrls: [{ kind: 'prefix', value: `/app/section-${g % 9}` }],
      steps: Array.from({ length: steps }, (_, s) => makeStep(g, s)),
      version: 1,
      source: g % 4 === 0 ? 'library' : 'local',
      updatedAt: '2026-11-04T00:00:00.000Z',
    } satisfies Guide;
  });
}

/** In-memory chrome.storage area that copies on get and set, like the real one. */
export function memArea() {
  const m = new Map<string, unknown>();
  return {
    m,
    async get(k: string | string[] | null) {
      const keys = k === null ? [...m.keys()] : [k].flat();
      const out: Record<string, unknown> = {};
      for (const key of keys) if (m.has(key)) out[key] = structuredClone(m.get(key));
      return out;
    },
    async set(o: Record<string, unknown>) {
      for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v));
    },
    async remove(k: string | string[]) {
      for (const key of [k].flat()) m.delete(key);
    },
  };
}
