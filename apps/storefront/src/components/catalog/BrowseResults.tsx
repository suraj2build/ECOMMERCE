import Link from 'next/link';
import type { StorefrontSearchResult } from '@/lib/api';
import { VanyaProductCard } from './VanyaProductCard';

type Query = Record<string, string | undefined>;

function pageHref(basePath: string, query: Query, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value && key !== 'page') params.set(key, value);
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function facetValues(result: StorefrontSearchResult, key: string) {
  return Object.entries(result.facetDistribution[key] ?? {}).sort((a, b) => b[1] - a[1]);
}

export function BrowseResults({
  title,
  eyebrow,
  description,
  basePath,
  result,
  query,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  basePath: string;
  result: StorefrontSearchResult;
  query: Query;
}) {
  const brands = facetValues(result, 'brandName');
  const colours = facetValues(result, 'colours');
  const sizes = facetValues(result, 'sizes');

  return (
    <>
      <section className="border-b border-border bg-[var(--color-bg)]">
        <div className="mx-auto max-w-[1440px] px-gutter pb-8 pt-10 md:pb-12 md:pt-14">
          {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">{eyebrow}</p> : null}
          <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="font-display text-4xl leading-none tracking-[-0.02em] text-[#181716] md:text-6xl">{title}</h1>
              {description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p> : null}
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-muted">{result.totalHits} styles</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-gutter py-6 md:py-8">
        <form action={basePath} method="get" className="grid gap-2 rounded-[18px] border border-[#e8e1d7] bg-white p-3 sm:grid-cols-2 lg:grid-cols-6 lg:p-4">
          <label className="lg:col-span-2">
            <span className="sr-only">Search within products</span>
            <input name="q" defaultValue={query.q ?? ''} placeholder="Search within this edit" className="min-h-[44px] w-full rounded-full border border-[#ded6ca] bg-[#faf8f5] px-4 text-sm text-ink outline-none focus:border-[#181716]" />
          </label>
          <label>
            <span className="sr-only">Brand</span>
            <select name="brand" defaultValue={query.brand ?? ''} className="min-h-[44px] w-full rounded-full border border-[#ded6ca] bg-white px-3 text-xs text-ink">
              <option value="">All brands</option>
              {brands.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Colour</span>
            <select name="color" defaultValue={query.color ?? ''} className="min-h-[44px] w-full rounded-full border border-[#ded6ca] bg-white px-3 text-xs text-ink">
              <option value="">All colours</option>
              {colours.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Size</span>
            <select name="size" defaultValue={query.size ?? ''} className="min-h-[44px] w-full rounded-full border border-[#ded6ca] bg-white px-3 text-xs text-ink">
              <option value="">All sizes</option>
              {sizes.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort products</span>
            <select name="sort" defaultValue={query.sort ?? 'relevance'} className="min-h-[44px] w-full rounded-full border border-[#ded6ca] bg-white px-3 text-xs text-ink">
              <option value="relevance">Recommended</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            <button type="submit" className="min-h-[42px] rounded-full bg-[#181716] px-6 text-xs font-medium uppercase tracking-[0.12em] text-white">Apply filters</button>
            <Link href={basePath} className="inline-flex min-h-[42px] items-center rounded-full px-5 text-xs uppercase tracking-[0.10em] text-ink underline underline-offset-4">Clear</Link>
          </div>
        </form>

        {result.unavailable ? (
          <div className="py-20 text-center"><h2 className="font-display text-2xl">Search is temporarily unavailable</h2><p className="mt-2 text-sm text-ink-muted">Please try again shortly.</p></div>
        ) : result.hits.length === 0 ? (
          <div className="py-20 text-center"><h2 className="font-display text-2xl">No styles found</h2><p className="mt-2 text-sm text-ink-muted">Try clearing a filter or using a broader search.</p></div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 gap-y-8 pt-8 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {result.hits.map((product) => <li key={product.id}><VanyaProductCard product={product} /></li>)}
          </ul>
        )}

        {result.totalPages > 1 ? (
          <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-3 border-t border-border pt-8">
            {result.page > 1 ? <Link href={pageHref(basePath, query, result.page - 1)} className="rounded-full border border-border px-5 py-3 text-xs uppercase tracking-[0.1em]">Previous</Link> : null}
            <span className="px-2 text-[10px] uppercase tracking-[0.14em] text-ink-muted">Page {result.page} of {result.totalPages}</span>
            {result.page < result.totalPages ? <Link href={pageHref(basePath, query, result.page + 1)} className="rounded-full border border-border px-5 py-3 text-xs uppercase tracking-[0.1em]">Next</Link> : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
