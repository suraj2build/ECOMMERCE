import type { FastifyBaseLogger } from 'fastify';
import { loadEnv } from '@fcp/config';

declare module 'fastify' {
  interface FastifyInstance {
    storefrontCache: StorefrontCacheService;
  }
}

const REVALIDATE_TIMEOUT_MS = 2_000;

/**
 * Tells the storefront to drop its cached render of one product page
 * after a change that alters what the public page shows: publish,
 * unpublish, archive, media or price. Without this a page requested
 * before publication stays a cached 404 for up to 30 seconds after
 * publish, and an unpublished product stays visible for the same time.
 *
 * Best-effort, like SearchIndexService: the catalog write has already
 * committed, so a slow or failing storefront is logged and never fails
 * the staff request. The page's own 30-second revalidation remains the
 * upper bound when a call is lost. Not configured (no URL): no call.
 *
 * Each storefront instance keeps its own page cache, so with more than
 * one instance this call reaches only the instance the URL routes to
 * unless the instances share a cache (see DEPLOYMENT.md).
 */
export class StorefrontCacheService {
  constructor(private readonly log: FastifyBaseLogger) {}

  async invalidateProduct(styleId: string): Promise<void> {
    const env = loadEnv();
    if (!env.STOREFRONT_REVALIDATE_URL || !env.STOREFRONT_REVALIDATE_SECRET) return;
    try {
      const res = await fetch(env.STOREFRONT_REVALIDATE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.STOREFRONT_REVALIDATE_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ styleId }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });
      if (!res.ok) this.log.warn({ styleId, status: res.status }, 'storefront product page revalidation was refused');
    } catch (err) {
      this.log.warn({ styleId, err: err instanceof Error ? err.message : String(err) }, 'storefront product page revalidation failed');
    }
  }
}
