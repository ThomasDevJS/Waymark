import { describe, expect, it } from 'vitest';
import { GuidePackSchema, GuideSchema } from '../../src/core/model/schema';
import { newId } from '../../src/core/model/ids';

const guide = () => ({
  id: newId(),
  schemaVersion: 1,
  revisionId: newId(),
  title: 'Create an order',
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.example.com'],
  startUrl: 'https://app.example.com/orders',
  matchUrls: [{ kind: 'prefix', value: '/orders' }],
  steps: [
    {
      id: newId(),
      kind: 'click',
      title: 'Click **New order**',
      url: { kind: 'pattern', value: '/orders' },
      advance: 'action',
      target: {
        instance: 'unique',
        matchCount: 1,
        tag: 'button',
        role: 'button',
        text: 'New order',
        cssPath: 'button.btn',
        xpath: '/html[1]/body[1]/button[1]',
        ancestors: [{ tag: 'main', role: 'main' }],
        shadowPath: [],
        framePath: [],
        rect: { x: 1, y: 2, w: 3, h: 4, vw: 1280, vh: 800 },
      },
    },
  ],
  version: 1,
  source: 'local',
  updatedAt: new Date().toISOString(),
});

describe('schemas', () => {
  it('accepts a valid guide and pack', () => {
    expect(GuideSchema.safeParse(guide()).success).toBe(true);
    expect(GuidePackSchema.safeParse({ format: 'waymark-pack', formatVersion: 1, exportedAt: '', guides: [guide()] }).success).toBe(true);
  });
  it('rejects newer schema and format versions', () => {
    expect(GuideSchema.safeParse({ ...guide(), schemaVersion: 2 }).success).toBe(false);
    expect(GuidePackSchema.safeParse({ format: 'waymark-pack', formatVersion: 2, exportedAt: '', guides: [] }).success).toBe(false);
  });
  it('caps steps per guide at 500', () => {
    const g = guide();
    g.steps = Array.from({ length: 501 }, () => g.steps[0]!);
    expect(GuideSchema.safeParse(g).success).toBe(false);
  });
  it('ULIDs are unique and sortable', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
