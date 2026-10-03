import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BrowseResults } from '@/components/catalog/BrowseResults';
import { searchStorefront } from '@/lib/api';
import { getPublicCategory } from '@/lib/lookups';
import { hasFilterParams, listingRobots, pageRedirect, requestedPage, sharing, absoluteUrl } from '@/lib/seo';

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const SPECIAL: Record<string, { title: string; description: string; gender?: string; markdown?: boolean; sort?: 'newest' }> = {
  women: { title: 'Women', description: 'Modern Indian womenswear with timeless roots.', gender: 'women' },
  men: { title: 'Men', description: 'Modern Indian menswear shaped by craft and ease.', gender: 'men' },
  new: { title: 'New In', description: 'The latest published styles, newest first.', sort: 'newest' },
  sale: { title: 'Sale', description: 'Current markdowns from the live VANYA catalog.', markdown: true },
};

/** A preset, a real category, or null for an unknown slug (a 404, LR-002). */
async function resolveCategory(slug: string) {
  const preset = SPECIAL[slug];
  if (preset) return { title: preset.title, description: preset.description, preset };
  const category = await getPublicCategory(slug);
  if (!category) return null;
  return { title: category.name, description: `Shop ${category.name} at VANYA: modern Indian clothing with live prices and stock.`, preset: undefined };
}

function searchFor(slug: string, preset: (typeof SPECIAL)[string] | undefined, raw: Params, page: number) {
  return searchStorefront({
    q: one(raw.q),
    category: preset ? undefined : slug,
    gender: preset?.gender ?? (['men', 'women'].includes(one(raw.gender) ?? '') ? one(raw.gender) : undefined),
    markdown: preset?.markdown,
    brand: one(raw.brand),
    color: one(raw.color),
    size: one(raw.size),
    sort: (one(raw.sort) as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | undefined) ?? preset?.sort ?? 'relevance',
    page,
    pageSize: 24,
  });
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const raw = await searchParams;
  const resolved = await resolveCategory(slug);
  if (!resolved) return { title: 'Not found', robots: { index: false, follow: false } };
  const page = requestedPage(one(raw.page));
  const path = `/category/${slug}`;
  const firstHit = (await searchFor(slug, resolved.preset, {}, 1).catch(() => null))?.hits.find((hit) => hit.thumbnailUrl);
  return {
    title: page > 1 ? `${resolved.title} — page ${page}` : resolved.title,
    description: resolved.description,
    // Pagination alone stays indexable with a self canonical; filters do not (LR-002).
    alternates: { canonical: absoluteUrl(page > 1 && !hasFilterParams(raw) ? `${path}?page=${page}` : path) },
    robots: listingRobots(hasFilterParams(raw)),
    ...sharing(`${resolved.title} | VANYA`, resolved.description, path, firstHit?.thumbnailUrl),
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params;
  const raw = await searchParams;
  const resolved = await resolveCategory(slug);
  if (!resolved) notFound();
  const page = requestedPage(one(raw.page));
  const result = await searchFor(slug, resolved.preset, raw, page);
  // LR-007: a page past the live last page goes to the last populated page.
  if (!result.unavailable) {
    const target = pageRedirect(`/category/${slug}`, raw, page, result.totalPages, one(raw.page));
    if (target) redirect(target);
  }
  const query = { q: one(raw.q), brand: one(raw.brand), color: one(raw.color), size: one(raw.size), sort: one(raw.sort), page: one(raw.page), gender: resolved.preset?.gender ?? (['men', 'women'].includes(one(raw.gender) ?? '') ? one(raw.gender) : undefined) };
  return <BrowseResults title={resolved.title} eyebrow="VANYA edit" description={resolved.preset?.description} basePath={`/category/${slug}`} result={result} query={query} />;
}
