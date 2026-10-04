import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { loadEnv } from '@fcp/config';

declare module 'fastify' {
  interface FastifyInstance {
    storefrontCache: StorefrontCacheService;
  }
}

const REVALIDATE_TIMEOUT_MS = 2_000;

/**
 * Tells the storefront to drop cached pages and catalogue reads after a
 * change that alters what the public storefront shows. Without this a
 * product page requested before publication stays a cached 404 for up to
 * 30 seconds after publish, an unpublished product stays visible on its
 * page for the same time, and listings (home, category, search,
 * collections) keep showing it, or its old price, until their own cache
 * entries expire - and the first request after a quiet spell still gets
 * the stale copy while Next refreshes it in the background.
 *
 * Two storefront endpoints, both behind STOREFRONT_REVALIDATE_SECRET:
 *  - /api/revalidate/product (STOREFRONT_REVALIDATE_URL itself): one
 *    product page;
 *  - /api/revalidate/catalog (resolved next to it): every cached
 *    catalogue read and the pages rendered from them.
 *
 * Best-effort, like SearchIndexService: the catalog write has already
 * committed, so a slow or failing storefront is logged and never fails
 * the staff request. The cache windows (30-60 seconds) remain the upper
 * bound when a call is lost. Not configured (no URL): no call.
 *
 * Stock-only changes (sales, reservations, receipts, adjustments) do not
 * call this: listings never show stock, and a product page's availability
 * refreshes within its 30-second window; the cart and checkout always read
 * live stock.
 *
 * Each storefront instance keeps its own cache, so with more than one
 * instance these calls reach only the instance the URL routes to unless
 * the instances share a cache (see DEPLOYMENT.md).
 */
export class StorefrontCacheService {
  constructor(private readonly log: FastifyBaseLogger) {}

  /** A product's page and every listing it can appear in. */
  async invalidateProduct(styleId: string): Promise<void> {
    await Promise.all([this.call('product', { styleId }), this.invalidateCatalog()]);
  }

  /** Every cached catalogue read: after a search reindex, which is also the
   * runbook step after a database restore or reseed. */
  async invalidateCatalog(): Promise<void> {
    await this.call('catalog');
  }

  private async call(target: 'product' | 'catalog', body?: { styleId: string }): Promise<void> {
    const env = loadEnv();
    if (!env.STOREFRONT_REVALIDATE_URL || !env.STOREFRONT_REVALIDATE_SECRET) return;
    // Relative resolution keeps any path prefix in front of /api/revalidate/.
    const url = target === 'product' ? env.STOREFRONT_REVALIDATE_URL : new URL('catalog', env.STOREFRONT_REVALIDATE_URL).toString();
    const context = { target, ...(body ?? {}) };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.STOREFRONT_REVALIDATE_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });
      if (!res.ok) this.log.warn({ ...context, status: res.status }, 'storefront cache revalidation was refused');
    } catch (err) {
      this.log.warn({ ...context, err: err instanceof Error ? err.message : String(err) }, 'storefront cache revalidation failed');
    }
  }
}

/**
 * For staff changes that alter public catalogue content beyond one product
 * (collections, badges, CMS pages and menus, Watch & Shop, search pins and
 * reindex): `reply.send(await afterChange(service.change(...)))` purges the
 * storefront's catalogue cache once the change has succeeded and before the
 * response goes out. A failed change throws past it and purges nothing.
 */
export function purgeCatalogAfter(fastify: FastifyInstance) {
  return async <T>(change: Promise<T>): Promise<T> => {
    const result = await change;
    await fastify.storefrontCache.invalidateCatalog();
    return result;
  };
}
