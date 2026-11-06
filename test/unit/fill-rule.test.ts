/** D203: the start page opened for the learner, its ids taken from the page they are on. */
import { describe, expect, it } from 'vitest';
import { fillRule } from '../../src/core/url/fill';

const O = 'https://cloud.samsara.test';

describe('fillRule (D203)', () => {
  it('fills a stand-in from the same place in the current address (Thomas: /o/:id/fleet/list)', () => {
    expect(fillRule('/o/:id/fleet/list', O, `${O}/o/12345/dashboard?x=1`)).toBe(`${O}/o/12345/fleet/list`);
    expect(fillRule('/o/:org/fleet/:vehicle/edit', O, `${O}/o/7/fleet/99/view`)).toBe(`${O}/o/7/fleet/99/edit`);
  });
  it('a rule without stand-ins needs no current page match beyond the site', () => {
    expect(fillRule('/fleet/list', O, `${O}/anything`)).toBe(`${O}/fleet/list`);
    expect(fillRule('/#/settings', O, `${O}/x`)).toBe(`${O}/#/settings`);
  });
  it('never guesses: another site, a different fixed part, a missing segment, no current page', () => {
    expect(fillRule('/o/:id/fleet/list', O, 'https://other.test/o/12345/x')).toBeNull();
    expect(fillRule('/o/:id/fleet/list', O, `${O}/settings/12345/x`)).toBeNull(); // "o" ≠ "settings"
    expect(fillRule('/o/:id/fleet/list', O, `${O}/o`)).toBeNull();
    expect(fillRule('/o/:id/fleet/list', O, `${O}/o/`)).toBeNull();
    expect(fillRule('/o/:id/fleet/list', O, null)).toBeNull();
    expect(fillRule('/o/:id', O, 'not a url')).toBeNull();
    expect(fillRule('/x#/item/:id', O, `${O}/x`)).toBeNull(); // a stand-in outside the path
  });
});
