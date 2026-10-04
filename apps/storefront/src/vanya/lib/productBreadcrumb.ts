import type { ProductDetail } from '@/lib/api';

export interface ProductBreadcrumbItem {
  label: string;
  href: string;
}

/**
 * Single source of truth for a product's breadcrumb trail (Home / department /
 * category / product name) — shared by the visible PDP breadcrumb
 * (vanya/views/PdpView.tsx) and the BreadcrumbList JSON-LD
 * (app/product/[styleId]/page.tsx) so the two can never drift apart.
 */
export function buildProductBreadcrumb(
  detail: Pick<ProductDetail, 'id' | 'name' | 'categoryName' | 'categorySlug' | 'gender'>,
): ProductBreadcrumbItem[] {
  const genderLabel = detail.gender && detail.gender !== 'unisex' ? detail.gender : null;
  return [
    { label: 'Home', href: '/' },
    ...(genderLabel
      ? [{ label: genderLabel.charAt(0).toUpperCase() + genderLabel.slice(1), href: `/category/${genderLabel}` }]
      : []),
    {
      label: detail.categoryName,
      href: `/category/${detail.categorySlug}${genderLabel ? `?gender=${genderLabel}` : ''}`,
    },
    { label: detail.name, href: `/product/${detail.id}` },
  ];
}
