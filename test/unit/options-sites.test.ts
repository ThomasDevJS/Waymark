import { describe, expect, it } from 'vitest';
import { sitePatternLabel } from '../../src/entrypoints/options/Options';
import { grantedSitePatterns } from '../../src/core/permissions/registration';

describe('Settings: Sites (D92)', () => {
  it('lists guide sites without the HD voice download hosts, and shows them without the /*', () => {
    const list = grantedSitePatterns(['https://app.example.com/*', 'https://huggingface.co/*', 'http://127.0.0.1/*']);
    expect(list.map(sitePatternLabel)).toEqual(['http://127.0.0.1', 'https://app.example.com']);
  });
});
