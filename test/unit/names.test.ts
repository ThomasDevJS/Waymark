import { describe, expect, it } from 'vitest';
import { languageName, siteLabel } from '../../src/core/text/names';

describe('names people read (D123)', () => {
  it('shows a site as its host, keeping a non-default port', () => {
    expect(siteLabel('https://app.example.com')).toBe('app.example.com');
    expect(siteLabel('http://127.0.0.1:8093')).toBe('127.0.0.1:8093');
    expect(siteLabel('https://app.example.com:443')).toBe('app.example.com');
    expect(siteLabel('not a url')).toBe('not a url');
  });
  it('names languages, and falls back to the code', () => {
    expect(languageName('en', 'en')).toBe('English (en)');
    expect(languageName('de', 'en')).toBe('German (de)');
    expect(languageName('zz-unknown-tag-x', 'en')).toBe('zz-unknown-tag-x');
  });
});
