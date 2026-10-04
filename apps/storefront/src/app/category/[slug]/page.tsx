import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PlpView } from '@/vanya/views/PlpView';
import { loadListing, one, parseListing } from '@/vanya/bridge/listing';
import { searchStorefront } from '@/lib/api';
import { getPublicCategory } from '@/lib/lookups';
import { hasFilterParams, listingRobots, pageRedirect, requestedPage, sharing, absoluteUrl } from '@/lib/seo';

type Params = Record<string, string | string[] | undefined>;

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

function listingQuery(slug: string, preset: (typeof SPECIAL)[string] | undefined, raw: Params) {
  const query = parseListing(raw, { gender: preset?.gender, sort: preset?.sort });
  return preset ? query : { ...query, categories: [slug] };
}

function searchFor(slug: string, preset: (typeof SPECIAL)[string] | undefined, raw: Params, page: number) {
  return loadListing({ query: listingQuery(slug, preset, raw), page, markdown: preset?.markdown });
}

const DESIGN_DESCRIPTION = 'Sculpted drapes, raw wild silks, and natural handwoven textiles. Designed with ease for contemporary living.';

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const raw = await searchParams;
  const resolved = await resolveCategory(slug);
  if (!resolved) return { title: 'Not found', robots: { index: false, follow: false } };
  const page = requestedPage(one(raw.page));
  const path = `/category/${slug}`;
  const firstHit = (await searchStorefront({ category: resolved.preset ? undefined : slug, gender: resolved.preset?.gender, markdown: resolved.preset?.markdown, pageSize: 4 }).catch(() => null))?.hits.find((hit) => hit.thumbnailUrl);
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
  const { result, categoryFacets, colourFacets } = await searchFor(slug, resolved.preset, raw, page);
  // LR-007: a page past the live last page goes to the last populated page.
  if (!result.unavailable) {
    const target = pageRedirect(`/category/${slug}`, raw, page, result.totalPages, one(raw.page));
    if (target) redirect(target);
  }
  const query = listingQuery(slug, resolved.preset, raw);
  const gender = query.gender;
  const departmentTitle = gender === 'men' ? "Men's Collection" : gender === 'women' ? "Women's Collection" : resolved.title;
  const title = resolved.preset?.gender
    ? query.categories.length === 1 ? categoryFacets.find((f) => f.value === query.categories[0])?.label ?? departmentTitle : departmentTitle
    : resolved.title;
  // Breadcrumb mirrors the title logic above: a bare department root (no
  // single category selected) shows as "Home / Men" with Men as the current
  // crumb; a specific category (reached either via /category/men?category=X
  // or directly via /category/X?gender=men) adds it as a third crumb.
  const genderLabel = gender === 'men' ? 'Men' : gender === 'women' ? 'Women' : null;
  const isDepartmentRootOnly = resolved.preset?.gender ? query.categories.length !== 1 : false;
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    ...(genderLabel ? [{ label: genderLabel, href: isDepartmentRootOnly ? undefined : `/category/${gender}` }] : []),
    ...(isDepartmentRootOnly ? [] : [{ label: title }]),
  ];
  return (
    <PlpView
      title={title}
      eyebrow={gender === 'women' ? "Dedicated Women's Atelier" : gender === 'men' ? "Dedicated Men's Atelier" : 'VANYA Edit'}
      description={resolved.preset && !resolved.preset.gender ? resolved.preset.description : DESIGN_DESCRIPTION}
      breadcrumbItems={breadcrumbItems}
      basePath={`/category/${slug}`}
      routeCategory={resolved.preset ? undefined : slug}
      query={query}
      result={result}
      categoryFacets={categoryFacets}
      colourFacets={colourFacets}
      listName={resolved.title}
    />
  );
}
