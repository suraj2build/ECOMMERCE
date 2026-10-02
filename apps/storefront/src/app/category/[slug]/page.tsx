import { BrowseResults } from '@/components/catalog/BrowseResults';
import { searchStorefront } from '@/lib/api';

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const pageNum = (value: string | undefined) => value && Number.isFinite(Number(value)) ? Number(value) : 1;

const SPECIAL: Record<string, { title: string; description: string; gender?: string; markdown?: boolean; sort?: 'newest' }> = {
  women: { title: 'Women', description: 'Modern Indian womenswear with timeless roots.', gender: 'women' },
  men: { title: 'Men', description: 'Modern Indian menswear shaped by craft and ease.', gender: 'men' },
  new: { title: 'New In', description: 'The latest published styles, newest first.', sort: 'newest' },
  sale: { title: 'Sale', description: 'Current markdowns from the live VANYA catalog.', markdown: true },
};

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params;
  const raw = await searchParams;
  const preset = SPECIAL[slug];
  const query = { q: one(raw.q), brand: one(raw.brand), color: one(raw.color), size: one(raw.size), sort: one(raw.sort), page: one(raw.page), gender: preset?.gender ?? (['men', 'women'].includes(one(raw.gender) ?? '') ? one(raw.gender) : undefined) };
  const result = await searchStorefront({
    q: query.q,
    category: preset ? undefined : slug,
    gender: query.gender,
    markdown: preset?.markdown,
    brand: query.brand,
    color: query.color,
    size: query.size,
    sort: (query.sort as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | undefined) ?? preset?.sort ?? 'relevance',
    page: pageNum(query.page),
    pageSize: 24,
  });
  const title = preset?.title ?? result.hits[0]?.categoryName ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <BrowseResults title={title} eyebrow="VANYA edit" description={preset?.description} basePath={`/category/${slug}`} result={result} query={query} />;
}
