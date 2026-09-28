import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/api';

/**
 * SEO (M27, specs/26-seo.md). Account/checkout/order pages are
 * customer-authenticated and carry no indexable public content -
 * disallowed so a crawler never wastes crawl budget on pages it can
 * never actually render for an anonymous visitor.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/checkout', '/orders', '/bag'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
