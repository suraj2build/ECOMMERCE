import { BrowseResults } from '@/components/catalog/BrowseResults';
import { searchStorefront } from '@/lib/api';

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const pageNumber = (value: string | undefined) => value && Number.isFinite(Number(value)) ? Number(value) : 1;

const SPECIAL = {
  women: { title: 'Women', description: 'Timeless tradition, shaped for today.', gender: 'women' },
  men: { title: 'Men', description: 'Tradition tailored for a modern world.', gender: 'men' },
  new: { title: 'New In', description: 'The latest published styles, newest first.', sort: 'newest' as const },
  sale: { title: 'Sale', description: 'Current markdowns from the live catalog.', markdown: true },
};

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Params>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const preset = SPECIAL[slug as keyof typeof SPECIAL];
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
    category: preset ? undefined : slug,
    gender: preset && 'gender' in preset ? preset.gender : undefined,
    markdown: preset && 'markdown' in preset ? preset.markdown : undefined,
    brand: query.brand,
    color: query.color,
    size: query.size,
    sort: (query.sort as 'relevance' | 'price_asc' | 'price_desc' | 'newest' | undefined) ?? (preset && 'sort' in preset ? preset.sort : 'relevance'),
    page: pageNumber(query.page),
    pageSize: 24,
  });

  const title = preset?.title ?? result.hits[0]?.categoryName ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const description = preset?.description;
  return <BrowseResults title={title} description={description} eyebrow="VANYA edit" basePath={`/category/${slug}`} result={result} query={query} />;
}
