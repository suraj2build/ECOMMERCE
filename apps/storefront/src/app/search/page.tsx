import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { absoluteUrl, pageRedirect, requestedPage } from '@/lib/seo';
import { PlpView } from '@/vanya/views/PlpView';
import { loadListing, one, parseListing } from '@/vanya/bridge/listing';

type Params = Record<string, string | string[] | undefined>;

// Search results are never indexed (LR-002); crawlers may follow the links.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const q = one((await searchParams).q);
  return { title: q ? `Search: ${q}` : 'Shop all', robots: { index: false, follow: true }, alternates: { canonical: absoluteUrl('/search') } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const query = parseListing(raw);
  const page = requestedPage(one(raw.page));
  const { result, categoryFacets, colourFacets } = await loadListing({ query, page });
  // LR-007: a page past the live last page goes to the last populated page.
  if (!result.unavailable) {
    const target = pageRedirect('/search', raw, page, result.totalPages, one(raw.page));
    if (target) redirect(target);
  }
  const department = query.gender === 'women' ? "Women's Atelier" : query.gender === 'men' ? "Men's Atelier" : 'All Departments';
  return (
    <PlpView
      title={query.q ? `Search: “${query.q}”` : 'Shop all'}
      eyebrow={department}
      description={query.q ? 'Styles matching your search, with live prices and sizes.' : 'Every published style, with live prices and sizes.'}
      basePath="/search"
      query={query}
      result={result}
      categoryFacets={categoryFacets}
      colourFacets={colourFacets}
      listName={query.q ? `Search: ${query.q}` : 'Shop all'}
      searchTerm={query.q}
    />
  );
}
