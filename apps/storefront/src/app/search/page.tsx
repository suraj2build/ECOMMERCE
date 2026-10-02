import { BrowseResults } from '@/components/catalog/BrowseResults';
import { searchStorefront } from '@/lib/api';

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const numberOrUndefined = (value: string | undefined) => value && Number.isFinite(Number(value)) ? Number(value) : undefined;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const query = {
    q: one(raw.q),
    brand: one(raw.brand),
    color: one(raw.color),
    size: one(raw.size),
    sort: one(raw.sort),
    page: one(raw.page),
  };
  const result = await searchStorefront({
    q: query.q,
    brand: query.brand,
    color: query.color,
    size: query.size,
    sort: (query.sort as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | undefined) ?? 'relevance',
    page: numberOrUndefined(query.page) ?? 1,
    pageSize: 24,
  });

  return <BrowseResults title={query.q ? `Search: “${query.q}”` : 'Discover VANYA'} eyebrow="Search" basePath="/search" result={result} query={query} />;
}
