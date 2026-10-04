import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProductDetail, searchStorefront, SITE_URL } from '@/lib/api';
import { PdpView } from '@/vanya/views/PdpView';
import { safeJsonLd } from '@/lib/json-ld';
import { sharing } from '@/lib/seo';

// Cache the public render on demand using the existing 30-second product
// snapshot lifetime. An empty build-time list admits every future style;
// it never imposes a catalog-size cutoff. The client refreshes live stock
// and price, while checkout always validates them independently.
export const revalidate = 30;
export function generateStaticParams() { return []; }

// Server-rendered/indexable per specs/26-seo.md's architectural requirement -
// no client-side data fetching for the initial render.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ styleId: string }>;
}): Promise<Metadata> {
  const { styleId } = await params;
  const product = await getProductDetail(styleId);
  if (!product) return { title: 'Product not found', robots: { index: false, follow: false } };
  const description = `${product.name} by ${product.brandName}. ${product.fabric ?? ''}`.trim();
  return {
    title: product.name,
    description,
    ...sharing(`${product.name} | VANYA`, description, `/product/${styleId}`, product.media.find((m) => m.type === 'IMAGE')?.url),
    // M27 (specs/26-seo.md): a single canonical URL per style ID - this
    // codebase has no query-param faceted/filtered PDP variants, so no
    // duplicate-content ambiguity exists to resolve beyond this.
    alternates: { canonical: `${SITE_URL}/product/${styleId}` },
  };
}

/** schema.org ProductGroup: one Product per SKU with its own offer and stock
 * (LR-002). Only real data: ratings from approved reviews, the resolved
 * return policy, shipping only once the business confirms the rates, and
 * no GTIN/MPN (none is stored). */
function productStructuredData(product: NonNullable<Awaited<ReturnType<typeof getProductDetail>>>) {
  const url = `${SITE_URL}/product/${product.id}`;
  const returns = product.policies?.returns;
  const shipping = product.policies?.shipping;
  const returnPolicy = returns
    ? returns.returnable
      ? { '@type': 'MerchantReturnPolicy', applicableCountry: 'IN', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: returns.windowDays }
      : { '@type': 'MerchantReturnPolicy', applicableCountry: 'IN', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' }
    : undefined;
  const shippingDetails = shipping?.confirmed
    ? {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IN' },
        shippingRate: { '@type': 'MonetaryAmount', value: product.sellingPrice >= shipping.freeAboveAmount ? 0 : shipping.flatAmount, currency: shipping.currency },
      }
    : undefined;
  const imageFor = (colourId: string) => product.media.find((m) => m.colourId === colourId && m.type === 'IMAGE')?.url ?? product.media[0]?.url;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: product.name,
    url,
    productGroupID: product.styleCode,
    brand: { '@type': 'Brand', name: product.brandName },
    image: product.media.filter((m) => m.type === 'IMAGE').map((m) => m.url),
    description: [product.fabric, product.fit, product.occasion].filter(Boolean).join(', ') || product.name,
    variesBy: ['https://schema.org/color', 'https://schema.org/size'],
    ...(product.ratingSummary.reviewCount > 0 && product.ratingSummary.averageRating !== null
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.ratingSummary.averageRating, reviewCount: product.ratingSummary.reviewCount } }
      : {}),
    hasVariant: product.variants.map((variant) => ({
      '@type': 'Product',
      sku: variant.skuCode,
      name: `${product.name} — ${variant.colourName}, ${variant.sizeLabel}`,
      color: variant.colourName,
      size: variant.sizeLabel,
      image: imageFor(variant.colourId),
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: product.currency,
        price: product.sellingPrice,
        itemCondition: 'https://schema.org/NewCondition',
        availability: variant.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        ...(returnPolicy ? { hasMerchantReturnPolicy: returnPolicy } : {}),
        ...(shippingDetails ? { shippingDetails } : {}),
      },
    })),
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ styleId: string }> }) {
  const { styleId } = await params;
  const product = await getProductDetail(styleId);
  if (!product) notFound();

  const structuredData = productStructuredData(product);
  const gender = product.gender?.toLowerCase();
  const department = gender === 'men' || gender === 'women' ? gender : null;

  // "You may also like": live styles from the same category and department.
  const similar = (await searchStorefront({ category: product.categorySlug, gender: department ?? undefined, pageSize: 5 }).catch(() => null))
    ?.hits.filter((hit) => hit.id !== product.id) ?? [];

  // Matches the visible breadcrumb trail in the design (Home / department / category / product).
  const breadcrumbItems = [
    { name: 'Home', href: '/' },
    ...(department ? [{ name: department === 'men' ? 'Men' : 'Women', href: `/category/${department}` }] : []),
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
      <PdpView initial={product} similar={similar} />
    </>
  );
}
