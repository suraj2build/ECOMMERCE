/**
 * Server side of the design's listing (views/PlpView.tsx): reads the filters
 * from the URL, runs the real search, and builds the filter options from the
 * same index. Category and colour options are counted without their own
 * filter applied, so choosing one keeps the others available (multi-select).
 */
import { getStorefrontCategories, searchStorefront, type StorefrontSearchResult } from '@/lib/api';
import type { Facet, ListingQuery, ListingSort } from '../views/PlpView';

type Params = Record<string, string | string[] | undefined>;
const SORTS: ListingSort[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating'];

/** A list parameter, from `a,b` or repeated `?x=a&x=b` (a no-script form). */
function list(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];
}

export function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListing(raw: Params, fixed: { gender?: string; sort?: ListingSort } = {}): ListingQuery {
  const gender = fixed.gender ?? one(raw.gender);
  const sort = one(raw.sort) as ListingSort | undefined;
  return {
    q: one(raw.q)?.trim() || undefined,
    gender: gender === 'men' || gender === 'women' ? gender : undefined,
    categories: list(raw.category),
    colours: list(raw.color),
    inStock: one(raw.inStock) === 'true',
    sort: sort && SORTS.includes(sort) ? sort : fixed.sort ?? 'relevance',
  };
}

export async function loadListing(options: {
  query: ListingQuery;
  page: number;
  markdown?: boolean;
}): Promise<{ result: StorefrontSearchResult; categoryFacets: Facet[]; colourFacets: Facet[] }> {
  const { query, page, markdown } = options;
  const shared = { q: query.q, gender: query.gender, markdown, inStock: query.inStock || undefined };
  const category = query.categories.join(',') || undefined;
  const [result, withoutColour, withoutCategory, names] = await Promise.all([
    searchStorefront({ ...shared, category, color: query.colours.join(',') || undefined, sort: query.sort, page, pageSize: 24 }),
    // Filter options, each counted without its own choices applied.
    searchStorefront({ ...shared, category, pageSize: 60 }).catch(() => null),
    searchStorefront({ ...shared, pageSize: 1 }).catch(() => null),
    getStorefrontCategories(),
  ]);
  const hex = new Map<string, string>();
  for (const hit of [...(withoutColour?.hits ?? []), ...result.hits]) {
    for (const swatch of hit.swatches ?? []) if (swatch.hex && !hex.has(swatch.name)) hex.set(swatch.name, swatch.hex);
  }
  const counts = (source: StorefrontSearchResult, key: string) =>
    Object.entries(source.facetDistribution[key] ?? {}).filter(([, count]) => count > 0);

  const categoryFacets: Facet[] = counts(withoutCategory ?? result, 'categorySlug')
    .map(([slug, count]) => ({ value: slug, label: names.find((c) => c.slug === slug)?.name ?? slug, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const colourFacets: Facet[] = counts(withoutColour ?? result, 'colours')
    .map(([name, count]) => ({ value: name, label: name, count, hex: hex.get(name) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { result, categoryFacets, colourFacets };
}
