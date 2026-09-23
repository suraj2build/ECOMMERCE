import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductDetail } from '@/lib/api';
import { Container } from '@/components/ui/Container';
import { ProductDetailInteractive } from '@/components/pdp/ProductDetailInteractive';
import { PincodeChecker } from '@/components/pdp/PincodeChecker';
import { ReviewsSection } from '@/components/pdp/ReviewsSection';
import { CrossSellStrip } from '@/components/pdp/CrossSellStrip';

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

  return (
    <>
      {/* schema.org JSON-LD, server-generated from our own data only - not user input. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <Container className="py-8">
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
