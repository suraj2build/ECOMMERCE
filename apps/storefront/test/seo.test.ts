import { afterEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import { hasFilterParams, pageRedirect, requestedPage } from '@/lib/seo';

const original = process.env.SITE_INDEXING;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_INDEXING;
  else process.env.SITE_INDEXING = original;
  delete process.env.DEPLOYMENT_STAGE;
});

describe('robots (LR-002)', () => {
  it('blocks every crawler when indexing is not explicitly enabled', () => {
    delete process.env.SITE_INDEXING;
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    process.env.SITE_INDEXING = 'true'; // only the exact value opts in
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('never lets a preview deployment be indexed, even with indexing switched on (LR-010)', () => {
    process.env.SITE_INDEXING = 'enabled';
    process.env.DEPLOYMENT_STAGE = 'preview';
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('allows the public site, keeps private pages out and lists the sitemap when enabled', () => {
    process.env.SITE_INDEXING = 'enabled';
    const result = robots();
    const rules = result.rules as { allow: string; disallow: string[] };
    expect(rules.allow).toBe('/');
    for (const path of ['/account', '/bag', '/checkout', '/orders', '/wishlist', '/search', '/api/']) {
      expect(rules.disallow).toContain(path);
    }
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe('listing page validation (LR-007)', () => {
  it('keeps every populated page, including the last one', () => {
    expect(pageRedirect('/search', { q: 'kurta', page: '42' }, 42, 42, '42')).toBeNull();
    expect(pageRedirect('/search', { q: 'kurta' }, 1, 42, undefined)).toBeNull();
  });

  it('sends a page past the live last page to the last page, keeping filters', () => {
    expect(pageRedirect('/search', { q: 'kurta', size: ['S', 'M'], page: '50' }, 50, 42, '50')).toBe('/search?q=kurta&size=S&size=M&page=42');
  });

  it('sends an empty result or malformed page number to the first page', () => {
    expect(pageRedirect('/category/women', { page: '3' }, 3, 0, '3')).toBe('/category/women');
    expect(pageRedirect('/category/women', { page: 'abc' }, requestedPage('abc'), 5, 'abc')).toBe('/category/women');
    expect(pageRedirect('/category/women', { page: '02' }, requestedPage('02'), 5, '02')).toBe('/category/women?page=2');
  });

  it('treats only filter and sort parameters as filtered variants', () => {
    expect(hasFilterParams({ page: '2' })).toBe(false);
    expect(hasFilterParams({ sort: 'price_asc' })).toBe(true);
    expect(hasFilterParams({ size: [] })).toBe(false);
  });
});
