/**
 * Server-only lookups for pages that must disappear when their record does:
 * a deactivated category, an unpublished collection, an unpublished legal
 * page. Next's fetch cache never stores a 404, so a cached 200 would keep
 * being served after the record went away; unstable_cache stores the null
 * too, so either change shows within the same 60-second window. Errors are
 * not cached (the previous value keeps serving).
 */
import { unstable_cache } from 'next/cache';
import type { LegalPageContent, PublicCategory, PublicCollectionDetail } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const REVALIDATE_SECONDS = 60;

async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`commerce-api request failed: GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const getPublicCategory = unstable_cache(
  (slug: string) => getOrNull<PublicCategory>(`/api/v1/storefront/categories/${encodeURIComponent(slug)}`),
  ['storefront-category'],
  { revalidate: REVALIDATE_SECONDS },
);

export const getPublicCollection = unstable_cache(
  (slug: string) => getOrNull<PublicCollectionDetail>(`/api/v1/storefront/collections/${encodeURIComponent(slug)}`),
  ['storefront-collection'],
  { revalidate: REVALIDATE_SECONDS },
);

/** Approved legal text published by staff through the CMS (LR-001); null
 * until a page is published, so the storefront never shows unapproved
 * wording. */
export const getLegalPage = unstable_cache(
  (kind: 'privacy' | 'terms') => getOrNull<LegalPageContent>(`/api/v1/storefront/cms/landing-pages/legal-${kind}`),
  ['storefront-legal-page'],
  { revalidate: REVALIDATE_SECONDS },
);
