/**
 * Server-side fetch wrapper for commerce-api's public storefront read
 * routes. Every function here calls an UNAUTHENTICATED, publish-gated
 * endpoint - see services/commerce-api/src/modules/catalog/routes.ts
 * (/storefront/*) and modules/content/routes.ts (/content/watch-and-shop/*).
 * This file is a thin read client, never a second source of truth: it
 * has no local cache/state of its own beyond Next.js's own request-scoped
 * fetch cache.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// M27 (specs/26-seo.md): the absolute origin used for canonical URLs,
// sitemap.xml entries, and robots.txt's sitemap reference - a real
// deployment sets this to its real public domain.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export interface PublicStyleSummary {
  id: string;
  styleCode: string;
  name: string;
  brandName: string;
  thumbnailUrl: string | null;
  mrp: string;
  sellingPrice: string;
  isMarkdown: boolean;
  publishedAt: string | null;
}

export interface PublicCollectionSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  styleThumbnails: string[];
}

export interface ShoppableMediaTagSummary {
  id: string;
  styleId: string;
  colourId: string | null;
  sizeId: string | null;
  sortOrder: number;
  style: { id: string; name: string; styleCode: string };
  colour: { id: string; name: string } | null;
  size: { id: string; label: string } | null;
}

export interface ShoppableMediaSummary {
  id: string;
  title: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  creatorAttribution: string | null;
  tags: ShoppableMediaTagSummary[];
}

async function apiGet<T>(path: string, revalidateSeconds: number): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate: revalidateSeconds } });
  if (!res.ok) {
    throw new Error(`commerce-api request failed: GET ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ProductVariant {
  skuId: string;
  skuCode: string;
  colourId: string;
  colourName: string;
  colourCode: string;
  hexSwatch: string | null;
  sizeId: string;
  sizeLabel: string;
  availableQuantity: number;
  inStock: boolean;
}

export interface ProductMediaItem {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  colourId: string | null;
  altText: string | null;
  isSwatch: boolean;
  modelInfo: Record<string, unknown> | null;
}

export interface SizeChartData {
  id: string;
  name: string;
  version: number;
  entries: { sizeLabel: string; measurements: Record<string, unknown> }[];
}

export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  customerName: string;
}

export interface CrossSellItem {
  id: string;
  styleCode: string;
  name: string;
  brandName: string;
  thumbnailUrl: string | null;
  mrp: number;
  sellingPrice: number;
  source: 'MANUAL' | 'RULE';
}

export interface ProductDetail {
  id: string;
  styleCode: string;
  name: string;
  brandName: string;
  categoryName: string;
  categorySlug: string;
  department: string | null;
  gender: string | null;
  fabric: string | null;
  fit: string | null;
  pattern: string | null;
  occasion: string | null;
  washCare: string | null;
  countryOfOrigin: string | null;
  mrp: number;
  sellingPrice: number;
  currency: string;
  isMarkdown: boolean;
  badges: { type: string }[];
  media: ProductMediaItem[];
  variants: ProductVariant[];
  sizeChart: SizeChartData | null;
  ratingSummary: { averageRating: number | null; reviewCount: number };
  reviews: ProductReview[];
  reviewsTotal: number;
  crossSell: CrossSellItem[];
  publishedAt: string | null;
}

/** Returns null on a 404 (unpublished/unknown style) so the page can call notFound() itself. */
export async function getProductDetail(styleId: string): Promise<ProductDetail | null> {
  const res = await fetch(`${API_URL}/api/v1/storefront/products/${styleId}`, { next: { revalidate: 30 } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`commerce-api request failed: GET /storefront/products/${styleId} -> ${res.status}`);
  }
  return res.json() as Promise<ProductDetail>;
}

export async function getProductDetailLive(styleId: string): Promise<ProductDetail> {
  const res = await fetch(`${API_URL}/api/v1/storefront/products/${styleId}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Could not load product (${res.status})`);
  }
  return res.json() as Promise<ProductDetail>;
}

export async function recordWatchAndShopEvent(
  mediaId: string,
  eventType: 'VIEW' | 'TAG_TAP' | 'ADD_TO_BAG',
  sessionRef?: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/content/watch-and-shop/${mediaId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, sessionRef }),
  });
  if (!res.ok) throw new Error(`Could not record Watch & Shop event (${res.status})`);
}

export interface ServiceabilityResult {
  pincode: string;
  known: boolean;
  isServiceable: boolean;
  codAvailable: boolean;
  city: string | null;
  state: string | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
}

/** Client-side call (interactive PIN check on the PDP) - never cached, always the live answer. */
export async function checkServiceability(pincode: string): Promise<ServiceabilityResult> {
  const res = await fetch(`${API_URL}/api/v1/storefront/serviceability?pincode=${encodeURIComponent(pincode)}`);
  if (!res.ok) {
    throw new Error(`commerce-api request failed: GET /storefront/serviceability -> ${res.status}`);
  }
  return res.json() as Promise<ServiceabilityResult>;
}

export async function submitReview(
  styleId: string,
  token: string,
  input: { rating: number; title?: string; body: string },
): Promise<ProductReview> {
  const res = await fetch(`${API_URL}/api/v1/storefront/products/${styleId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Review submission failed (${res.status})`);
  }
  return res.json() as Promise<ProductReview>;
}

export async function getPublicStyles(take = 12, skip = 0): Promise<PublicStyleSummary[]> {
  return apiGet<PublicStyleSummary[]>(`/api/v1/storefront/styles?take=${take}&skip=${skip}`, 60);
}

export async function getPublicCollections(): Promise<PublicCollectionSummary[]> {
  return apiGet<PublicCollectionSummary[]>('/api/v1/storefront/collections', 60);
}

export interface PublicCollectionDetail extends PublicCollectionSummary {
  styles: PublicStyleSummary[];
}

export async function getPublicCollection(slug: string): Promise<PublicCollectionDetail | null> {
  const res = await fetch(`${API_URL}/api/v1/storefront/collections/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`commerce-api request failed: GET /storefront/collections/${slug} -> ${res.status}`);
  }
  return res.json() as Promise<PublicCollectionDetail>;
}

export interface StorefrontSearchHit {
  id: string;
  styleCode: string;
  name: string;
  brandName: string;
  categoryName: string;
  categorySlug: string;
  gender: string | null;
  colours: string[];
  sizes: string[];
  mrp: number;
  sellingPrice: number;
  currency: string;
  isMarkdown: boolean;
  availableQuantity: number;
  inStock: boolean;
  publishedAt: number;
  thumbnailUrl: string | null;
}

export interface StorefrontSearchResult {
  hits: StorefrontSearchHit[];
  page: number;
  pageSize: number;
  totalHits: number;
  totalPages: number;
  facetDistribution: Record<string, Record<string, number>>;
  unavailable?: boolean;
}

export async function searchStorefront(params: {
  q?: string;
  category?: string;
  brand?: string;
  gender?: string;
  markdown?: boolean;
  color?: string;
  size?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  pageSize?: number;
} = {}): Promise<StorefrontSearchResult> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  if (params.brand) query.set('brand', params.brand);
  if (params.gender) query.set('gender', params.gender);
  if (params.markdown !== undefined) query.set('markdown', String(params.markdown));
  if (params.color) query.set('color', params.color);
  if (params.size) query.set('size', params.size);
  if (params.priceMin !== undefined) query.set('priceMin', String(params.priceMin));
  if (params.priceMax !== undefined) query.set('priceMax', String(params.priceMax));
  if (params.sort) query.set('sort', params.sort);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  return apiGet<StorefrontSearchResult>(`/api/v1/storefront/search?${query.toString()}`, 30);
}

export async function searchStorefrontLive(params: {
  q?: string;
  gender?: string;
  pageSize?: number;
} = {}): Promise<StorefrontSearchResult> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.gender) query.set('gender', params.gender);
  query.set('pageSize', String(params.pageSize ?? 8));
  const res = await fetch(`${API_URL}/api/v1/storefront/search?${query.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json() as Promise<StorefrontSearchResult>;
}

// M27 (specs/26-seo.md): sitemap.xml must stay current as products
// publish/unpublish, so it pages through the SAME public/publish-gated
// `getPublicStyles` read every other public page uses (never a second,
// divergent "all styles" query) rather than duplicating catalog logic.
// SITEMAP_MAX_STYLES bounds worst-case generation cost - an engineering
// default (50 pages x 60 = 3000 published SKUs), not a business limit.
const SITEMAP_PAGE_SIZE = 60;
const SITEMAP_MAX_STYLES = 3000;

// Deliberately bypasses the shared `apiGet` cache (used by
// `getPublicStyles` for ordinary page rendering, where a short cache is
// the right tradeoff): a sitemap that silently omits a just-published
// product for up to a whole cache window is a real correctness gap
// against "kept current with publish state," not an acceptable
// performance/freshness tradeoff.
async function fetchStylesPageUncached(take: number, skip: number): Promise<PublicStyleSummary[]> {
  const res = await fetch(`${API_URL}/api/v1/storefront/styles?take=${take}&skip=${skip}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`commerce-api request failed: GET /api/v1/storefront/styles -> ${res.status}`);
  return res.json() as Promise<PublicStyleSummary[]>;
}

export async function getAllPublicStylesForSitemap(): Promise<PublicStyleSummary[]> {
  const all: PublicStyleSummary[] = [];
  let skip = 0;
  while (all.length < SITEMAP_MAX_STYLES) {
    const page = await fetchStylesPageUncached(SITEMAP_PAGE_SIZE, skip);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < SITEMAP_PAGE_SIZE) break;
    skip += SITEMAP_PAGE_SIZE;
  }
  return all;
}

export async function getWatchAndShopFeed(): Promise<ShoppableMediaSummary[]> {
  return apiGet<ShoppableMediaSummary[]>('/api/v1/content/watch-and-shop/feed', 30);
}
