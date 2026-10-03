import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrowseResults } from '@/components/catalog/BrowseResults';
import { searchStorefront } from '@/lib/api';
import { absoluteUrl, pageRedirect, requestedPage } from '@/lib/seo';

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

// Search results are never indexed (LR-002); crawlers may follow the links.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const q = one((await searchParams).q);
  return { title: q ? `Search: ${q}` : 'Shop all', robots: { index: false, follow: true }, alternates: { canonical: absoluteUrl('/search') } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const query = {
    q: one(raw.q), brand: one(raw.brand), color: one(raw.color), size: one(raw.size),
    sort: one(raw.sort), page: one(raw.page),
    gender: ['men', 'women'].includes(one(raw.gender) ?? '') ? one(raw.gender) : undefined,
  };
  const page = requestedPage(query.page);
  const result = await searchStorefront({
    q: query.q, brand: query.brand, color: query.color, size: query.size, gender: query.gender,
    sort: (query.sort as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | undefined) ?? 'relevance',
    page, pageSize: 24,
  });
  // LR-007: a page past the live last page goes to the last populated page.
  if (!result.unavailable) {
    const target = pageRedirect('/search', raw, page, result.totalPages, query.page);
    if (target) redirect(target);
  }
  return <BrowseResults title={query.q ? `Search: “${query.q}”` : 'Shop all'} eyebrow="Discover VANYA" basePath="/search" result={result} query={query} />;
}
