import { describe, expect, it } from 'vitest';
import { lastStepAnnouncement } from '../../src/entrypoints/sidepanel/Recorder';
import type { Step } from '../../src/core/model/schema';

const step = (title: string, flags?: Step['flags']): Step => ({ id: title, kind: 'click', title, url: { kind: 'prefix', value: '/' }, advance: 'action', ...(flags ? { flags } : {}) });

describe('recorder announcement (D91)', () => {
  it('reads the newest step without markdown, with its warnings by name', () => {
    expect(lastStepAnnouncement([])).toBe('');
    expect(lastStepAnnouncement([step('Click **Orders**')])).toBe('Step 1: Click Orders');
    expect(lastStepAnnouncement([step('a'), step('Click the *chart*', ['canvas', 'low-confidence'])])).toBe('Step 2: Click the chart. Warning: Drawing area, Hard to find');
  });
});
