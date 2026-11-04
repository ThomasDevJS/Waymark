import { describe, expect, it } from 'vitest';
import { isDataLike, isGeneratedToken, isStateClass, safeLabel } from '../../src/core/fingerprint/filters';

describe('isGeneratedToken', () => {
  it.each(['css-1x9f2k', 'css-1x9f2k-Button', 'sc-bdVaJa', 'jss12', ':r0:', ':R1a2:', '«r3»', '_r_5_', 'ember123', 'Button_primary__3xK9z', 'item-123456', '3f2a9c1e7b', '550e8400-e29b-41d4-a716-446655440000', '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'x7f3k2a'])(
    'flags %s',
    (t) => expect(isGeneratedToken(t)).toBe(true),
  );
  it.each(['btn', 'btn-primary', 'nav-link', 'save-button', 'col-md-6', 'mt-4', 'first-name', 'email', 'search', 'v2', 'card', 'form-field', 'export-csv', 'primary-cta'])(
    'keeps %s',
    (t) => expect(isGeneratedToken(t)).toBe(false),
  );
  // Review L1: camelCase identifiers are words, not hashes.
  it.each(['addToCart', 'firstNameInput', 'deleteRowButton', 'goToTop', 'getHTMLElement', 'saveAndContinue', 'btn-addToCart', 'Save and continue'])(
    'keeps camelCase %s',
    (t) => expect(isGeneratedToken(t)).toBe(false),
  );
  it.each(['bdVaJa', 'iDuHsS', 'xKq3Fz', 'VaJaBo', 'item-123456', 'a8F3kL92', 'css-1x9f2k', 'sc-AxjAm', 'jss12', ':r0:', 'ember123', '550e8400-e29b-41d4-a716-446655440000'])(
    'still flags hash %s',
    (t) => expect(isGeneratedToken(t)).toBe(true),
  );
  it('applies profile ignore patterns', () => {
    expect(isGeneratedToken('foo-bar', [/^foo-/])).toBe(true);
  });
  it('flags state classes', () => {
    expect(isStateClass('is-active')).toBe(true);
    expect(isStateClass('active')).toBe(true);
    expect(isStateClass('btn')).toBe(false);
  });
});

describe('isDataLike', () => {
  it.each([
    'ada@example.com',
    '+1 (555) 123-4567',
    '$12.50',
    '12,50 €',
    '1,234,567',
    '2026-11-04',
    '04/11/2026',
    'Nov 4',
    '10:30',
    'Order 10234',
    'INV-2039',
    '#123',
    'a8f3kl92x7',
    '45%',
    'x'.repeat(81),
  ])('flags %s', (t) => expect(isDataLike(t)).toBe(true));
  it.each(['Save', 'New order', 'Step 2 of 3', 'Read the docs', 'Q3 report', 'Search orders', 'First name', 'Get started'])('keeps %s', (t) =>
    expect(isDataLike(t)).toBe(false),
  );
  it('safeLabel trims and drops data', () => {
    expect(safeLabel('  Save   changes ')).toBe('Save changes');
    expect(safeLabel('ada@example.com')).toBeUndefined();
    expect(safeLabel('')).toBeUndefined();
  });
});
