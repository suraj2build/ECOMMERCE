import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SearchIndexService, STYLES_INDEX_UID, type StyleSearchDocument } from './index-service.js';

const searchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  color: z.string().optional(), // comma-separated
  size: z.string().optional(), // comma-separated
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});

/** Wraps a facet value in a quoted, escaped Meilisearch filter literal. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFilter(params: z.infer<typeof searchQuerySchema>): string[] {
  const filters: string[] = [];
  if (params.category) filters.push(`categorySlug = ${quote(params.category)}`);
  if (params.brand) filters.push(`brandName = ${quote(params.brand)}`);
  if (params.color) {
    const values = params.color.split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length) filters.push(`colours IN [${values.map(quote).join(', ')}]`);
  }
  if (params.size) {
    const values = params.size.split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length) filters.push(`sizes IN [${values.map(quote).join(', ')}]`);
  }
  if (params.priceMin !== undefined) filters.push(`sellingPrice >= ${params.priceMin}`);
  if (params.priceMax !== undefined) filters.push(`sellingPrice <= ${params.priceMax}`);
  return filters;
}

function buildSort(sort: z.infer<typeof searchQuerySchema>['sort']): string[] | undefined {
  switch (sort) {
    case 'price_asc':
      return ['sellingPrice:asc'];
    case 'price_desc':
      return ['sellingPrice:desc'];
    case 'newest':
      return ['publishedAt:desc'];
    default:
      return undefined; // relevance - let the index's own ranking rules decide
  }
}

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new SearchIndexService(fastify);
  const pinAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:search:pin')];
  const reindexAuth = [fastify.requireStaffAuth, fastify.requirePermission('search:reindex')];

  /**
   * Public search/PLP endpoint (SRCH-001/002). Never authoritative for
   * price/inventory availability itself - PDP/cart re-resolve those from
   * PostgreSQL at add-to-bag/checkout time. This is a read of the derived
   * Meilisearch index only.
   */
  fastify.get('/storefront/search', async (request, reply) => {
    const params = searchQuerySchema.parse(request.query);
    const filter = buildFilter(params);
    const sort = buildSort(params.sort);

    try {
      const results = await fastify.meilisearch.index<StyleSearchDocument>(STYLES_INDEX_UID).search(params.q ?? '', {
        filter: filter.length ? filter : undefined,
        sort,
        facets: ['brandName', 'categorySlug', 'colours', 'sizes'],
        page: params.page,
        hitsPerPage: params.pageSize,
      });

      reply.status(200).send({
        hits: results.hits,
        page: results.page,
        pageSize: results.hitsPerPage,
        totalHits: results.totalHits,
        totalPages: results.totalPages,
        facetDistribution: results.facetDistribution ?? {},
      });
    } catch (err) {
      // A Meilisearch outage degrades search - the customer gets an
      // explicit "temporarily unavailable" empty result rather than a
      // 500, and never a silently-wrong result set.
      fastify.log.error({ err }, 'storefront search failed');
      reply.status(200).send({
        hits: [],
        page: params.page,
        pageSize: params.pageSize,
        totalHits: 0,
        totalPages: 0,
        facetDistribution: {},
        unavailable: true,
      });
    }
  });

  fastify.post('/catalog/styles/:id/pin', { preHandler: pinAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.setPinned(id, true, request.staffUser!.id);
    reply.status(200).send({ styleId: id, searchPinned: true });
  });

  fastify.post('/catalog/styles/:id/unpin', { preHandler: pinAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.setPinned(id, false, request.staffUser!.id);
    reply.status(200).send({ styleId: id, searchPinned: false });
  });

  /** Operational recovery tool - full rebuild from PostgreSQL, never the primary indexing path. */
  fastify.post('/search/reindex', { preHandler: reindexAuth }, async (_request, reply) => {
    reply.status(200).send(await service.reindexAll());
  });
};

export default searchRoutes;
