/**
 * Indexing rules (LR-002, specs/26-seo.md). Server-only: read at request
 * time so one build can serve a noindexed preview and an indexed production.
 */
import type { Metadata } from 'next';
import { SITE_URL } from './api';

/** Production must opt in explicitly; previews and staging never get indexed. */
export function indexingEnabled(): boolean {
  return process.env.SITE_INDEXING === 'enabled';
}

/** Paths a crawler must never index (customer-only or transient). */
export const PRIVATE_PATHS = ['/account', '/bag', '/checkout', '/orders', '/wishlist', '/search', '/api/'];

/** Query parameters that turn a listing into a filtered/sorted variant. */
const FILTER_PARAMS = ['q', 'brand', 'color', 'size', 'sort', 'gender', 'priceMin', 'priceMax', 'markdown'];

export function hasFilterParams(params: Record<string, string | string[] | undefined>): boolean {
  return FILTER_PARAMS.some((key) => {
    const value = params[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '' : path}`;
}

/** Robots meta for a listing: filtered or sorted variants are noindex, follow. */
export function listingRobots(filtered: boolean): Metadata['robots'] {
  return filtered ? { index: false, follow: true } : undefined;
}

/** Shared Open Graph/Twitter block so every public page has a sharing preview. */
export function sharing(title: string, description: string, path: string, image?: string | null): Pick<Metadata, 'openGraph' | 'twitter'> {
  const images = image ? [{ url: image }] : undefined;
  return {
    openGraph: { title, description, url: absoluteUrl(path), siteName: 'VANYA', locale: 'en_IN', type: 'website', images },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, images: image ? [image] : undefined },
  };
}

/** Page number from a query value; invalid values fall back to 1. */
export function requestedPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** LR-007: where to send a request for a page past the live last page.
 * Returns null when the requested page is valid. */
export function pageRedirect(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  requested: number,
  totalPages: number,
  rawPage: string | undefined,
): string | null {
  const target = totalPages === 0 ? 1 : Math.min(requested, totalPages);
  const malformed = rawPage !== undefined && String(requested) !== rawPage;
  if (target === requested && !malformed) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  if (target > 1) query.set('page', String(target));
  const search = query.toString();
  return search ? `${basePath}?${search}` : basePath;
}
