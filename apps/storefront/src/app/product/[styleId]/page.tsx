import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductDetail, SITE_URL } from '@/lib/api';
import { Container } from '@/components/ui/Container';
import { ProductDetailInteractive } from '@/components/pdp/ProductDetailInteractive';
import { PincodeChecker } from '@/components/pdp/PincodeChecker';
import { ReviewsSection } from '@/components/pdp/ReviewsSection';
import { CrossSellStrip } from '@/components/pdp/CrossSellStrip';
import { Breadcrumbs } from '@/components/pdp/Breadcrumbs';
import { safeJsonLd } from '@/lib/json-ld';

// Server-rendered/indexable per specs/26-seo.md's architectural requirement -
// no client-side data fetching for the initial render.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ styleId: string }>;
}): Promise<Metadata> {
  const { styleId } = await params;
  const product = await getProductDetail(styleId);
  if (!product) return { title: 'Product not found' };
  return {
    title: product.name,
    description: `${product.name} by ${product.brandName}. ${product.fabric ?? ''}`.trim(),
    openGraph: { title: product.name, images: product.media[0] ? [product.media[0].url] : [] },
    // M27 (specs/26-seo.md): a single canonical URL per style ID - this
    // codebase has no query-param faceted/filtered PDP variants, so no
    // duplicate-content ambiguity exists to resolve beyond this.
    alternates: { canonical: `${SITE_URL}/product/${styleId}` },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ styleId: string }> }) {
  const { styleId } = await params;
  const product = await getProductDetail(styleId);
  if (!product) notFound();

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    brand: { '@type': 'Brand', name: product.brandName },
    image: product.media.map((m) => m.url),
    description: [product.fabric, product.fit, product.occasion].filter(Boolean).join(', '),
    sku: product.styleCode,
    ...(product.ratingSummary.reviewCount > 0 && product.ratingSummary.averageRating !== null
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingSummary.averageRating,
            reviewCount: product.ratingSummary.reviewCount,
          },
        }
      : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: product.currency,
      price: product.sellingPrice,
      availability: product.variants.some((v) => v.inStock)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };

  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    { name: product.categoryName, href: `/category/${product.categorySlug}` },
    { name: product.name, href: `/product/${product.id}` },
  ];

  const breadcrumbStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.href}`,
    })),
  };

  return (
    <>
      {/* schema.org JSON-LD - staff-curated data (product name/brand/category
          are free text), so this is escaped via safeJsonLd (M31, 5D) rather
          than trusted as though it were a hard-coded constant. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbStructuredData) }} />
      <Container className="py-6 sm:py-8 lg:py-10">
        <Breadcrumbs items={breadcrumbItems} />
        <ProductDetailInteractive product={product} />
        <PincodeChecker />
        <ReviewsSection
          styleId={product.id}
          ratingSummary={product.ratingSummary}
          initialReviews={product.reviews}
        />
      </Container>
      <CrossSellStrip items={product.crossSell} />
      {/* Reserves space for the mobile sticky Add-to-Bag bar so it never
          permanently covers the footer at max scroll - the bar itself
          has no scroll position of its own to "clear", since page
          content scrolling can only push it out of the way where there
          is real content/space left below to reveal. */}
      <div className="h-24 md:hidden" aria-hidden="true" />
    </>
  );
}
