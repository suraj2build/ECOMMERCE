import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/api';
import { indexingEnabled, PRIVATE_PATHS } from '@/lib/seo';

// Read at request time: the same build serves noindexed previews and an
// indexed production (LR-002).
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
