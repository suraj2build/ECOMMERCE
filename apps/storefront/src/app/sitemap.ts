import type { MetadataRoute } from 'next';
import { getAllPublicStylesForSitemap, SITE_URL } from '@/lib/api';

/**
 * SEO (M27, specs/26-seo.md): kept current as products publish/unpublish
 * by paging through the SAME publish-gated `/storefront/styles` read
 * every other public page uses - a draft/unpublished style can never
 * appear here, since the underlying query never returns one. Only real,
 * resolvable routes are listed - this codebase has no dedicated
 * category/collection browsing page (an honest scope boundary, the same
 * kind M19's photo-upload and M25's PUSH gaps each recorded), so no
 * collection URL is fabricated here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const styles = await getAllPublicStylesForSitemap().catch(() => []);

  const staticEntries: MetadataRoute.Sitemap = [{ url: SITE_URL, changeFrequency: 'daily', priority: 1 }];

  const productEntries: MetadataRoute.Sitemap = styles.map((style) => ({
    url: `${SITE_URL}/product/${style.id}`,
    lastModified: style.publishedAt ?? undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...staticEntries, ...productEntries];
}
