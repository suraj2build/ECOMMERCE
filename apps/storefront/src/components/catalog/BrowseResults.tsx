import Link from 'next/link';
import type { StorefrontSearchResult } from '@/lib/api';
import { VanyaProductCard } from './VanyaProductCard';
import { TrackListView } from '../consent/TrackListView';

type Query = Record<string, string | undefined>;

function pageHref(basePath: string, query: Query, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}

function facets(result: StorefrontSearchResult, key: string) {
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
  return (
    <>
      <TrackListView
        listName={title}
        searchTerm={basePath === '/search' ? query.q : undefined}
        items={result.hits.map((hit) => ({ styleCode: hit.styleCode, name: hit.name, price: hit.sellingPrice }))}
      />
      <section className="border-b border-border bg-canvas">
        <div className="mx-auto max-w-container px-gutter pb-8 pt-10 md:pb-12 md:pt-14">
          {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>}
          <div className="mt-2 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <h1 className="font-display text-4xl leading-none tracking-[-0.035em] text-ink md:text-6xl">{title}</h1>
              {description && <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p>}
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-muted">{result.totalHits} styles</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-container px-gutter py-6 md:py-8">
        <form action={basePath} method="get" className="grid gap-2 rounded-[20px] border border-border bg-surface p-3 shadow-subtle sm:grid-cols-2 lg:grid-cols-6">
          {query.gender && <input type="hidden" name="gender" value={query.gender} />}
          <label className="lg:col-span-2">
            <span className="sr-only">Search within products</span>
            <input name="q" defaultValue={query.q ?? ''} placeholder="Search within" className="min-h-[44px] w-full rounded-full border border-border bg-canvas px-4 text-sm text-ink" />
          </label>
          <Filter name="brand" label="All brands" value={query.brand} options={facets(result, 'brandName')} />
          <Filter name="color" label="All colours" value={query.color} options={facets(result, 'colours')} />
          <Filter name="size" label="All sizes" value={query.size} options={facets(result, 'sizes')} />
          <label>
            <span className="sr-only">Sort products</span>
            <select name="sort" defaultValue={query.sort ?? 'relevance'} className="min-h-[44px] w-full rounded-full border border-border bg-canvas px-3 text-xs text-ink">
              <option value="relevance">Recommended</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            <button type="submit" className="min-h-[44px] rounded-full bg-accent px-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-ink">Apply filters</button>
            <Link href={basePath} className="inline-flex min-h-[44px] items-center rounded-full px-5 text-xs text-ink underline underline-offset-4">Clear</Link>
          </div>
        </form>

        {result.unavailable ? (
          <Empty title="Search is temporarily unavailable" body="Please try again shortly." />
        ) : result.hits.length === 0 ? (
          <Empty title="No styles found" body="Try clearing a filter or using a broader search." />
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-10 pt-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {result.hits.map((product) => <li key={product.id}><VanyaProductCard product={product} /></li>)}
          </ul>
        )}

        {result.totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-4 border-t border-border pt-8">
            {result.page > 1 && <Link href={pageHref(basePath, query, result.page - 1)} className="min-h-[44px] rounded-full border border-border px-5 py-3 text-xs text-ink">Previous</Link>}
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Page {result.page} of {result.totalPages}</span>
            {result.page < result.totalPages && <Link href={pageHref(basePath, query, result.page + 1)} className="min-h-[44px] rounded-full border border-border px-5 py-3 text-xs text-ink">Next</Link>}
          </nav>
        )}
      </div>
    </>
  );
}

function Filter({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, number][] }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ''} className="min-h-[44px] w-full rounded-full border border-border bg-canvas px-3 text-xs text-ink">
        <option value="">{label}</option>
        {options.map(([option, count]) => <option key={option} value={option}>{option} ({count})</option>)}
      </select>
    </label>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-20 text-center">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
    </div>
  );
}
