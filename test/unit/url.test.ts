import { describe, expect, it } from 'vitest';
import { linkPath, matchPath, normalizePath, originToMatchPattern, routedPath, stepUrlRule, urlMatches } from '../../src/core/url/url';

describe('URL rules', () => {
  it('turns key-like segments into parameters', () => {
    expect(normalizePath('/orders/123')).toBe('/orders/:id');
    expect(normalizePath('/orders/123/edit/')).toBe('/orders/:id/edit');
    expect(normalizePath('/u/550e8400-e29b-41d4-a716-446655440000')).toBe('/u/:id');
    expect(normalizePath('/doc/5f3a9c1e7b2d')).toBe('/doc/:id');
    expect(normalizePath('/post/my-post-12345')).toBe('/post/:id');
    expect(normalizePath('/settings/profile')).toBe('/settings/profile');
    expect(normalizePath('/api/v2/items')).toBe('/api/v2/items');
    expect(normalizePath('/')).toBe('/');
  });
  it('ignores query strings unless kept by the profile', () => {
    const u = new URL('https://a.test/orders?page=2&tab=open');
    expect(routedPath(u)).toBe('/orders');
    expect(routedPath(u, { keepQueryKeys: ['tab'] })).toBe('/orders?tab=open');
  });
  it('uses the #/ part for hash-routed apps', () => {
    const u = new URL('https://a.test/app/#/orders/42?x=1');
    expect(routedPath(u, { hashRouting: true })).toBe('/orders/:id');
    expect(routedPath(u)).toBe('/app');
  });
  it('matches patterns and prefixes', () => {
    expect(matchPath({ kind: 'pattern', value: '/orders/:id/edit' }, '/orders/:id/edit')).toBe(true);
    expect(matchPath({ kind: 'pattern', value: '/orders/:id/edit' }, '/orders/x/edit')).toBe(true);
    expect(matchPath({ kind: 'pattern', value: '/orders/:id' }, '/orders/:id/edit')).toBe(false);
    expect(matchPath({ kind: 'prefix', value: '/orders' }, '/orders/:id/edit')).toBe(true);
  });
  it('requires the origin to be in appOrigins', () => {
    const rule = stepUrlRule('https://app.example.com/orders/123/edit');
    expect(rule).toEqual({ kind: 'pattern', value: '/orders/:id/edit' });
    expect(urlMatches(rule, 'https://app.example.com/orders/9/edit', ['https://app.example.com'])).toBe(true);
    expect(urlMatches(rule, 'https://evil.example.com/orders/9/edit', ['https://app.example.com'])).toBe(false);
  });
  it('normalizes link paths', () => {
    expect(linkPath('/orders/10234?x=1', 'https://a.test/')).toBe('/orders/:id');
    expect(linkPath('https://docs.example.com/guide', 'https://a.test/')).toBe('https://docs.example.com/guide');
    expect(linkPath('javascript:void(0)', 'https://a.test/')).toBeUndefined();
    expect(originToMatchPattern('http://127.0.0.1:4173')).toBe('http://127.0.0.1/*');
  });
});
