import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SearchIndexService, STYLES_INDEX_UID, type StyleSearchDocument } from './index-service.js';

const searchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  gender: z.string().optional(),
  markdown: z.enum(['true', 'false']).optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFilter(params: z.infer<typeof searchQuerySchema>): string[] {
  const filters: string[] = [];
  if (params.category) filters.push(`categorySlug = ${quote(params.category)}`);
  if (params.brand) filters.push(`brandName = ${quote(params.brand)}`);
  if (params.gender) filters.push(`gender = ${quote(params.gender)}`);
  if (params.markdown !== undefined) filters.push(`isMarkdown = ${params.markdown}`);
  if (params.gender) {
    const normalized = params.gender.toLowerCase();
    const titleCase = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    const upper = normalized.toUpperCase();
    filters.push(`(gender IN [${quote(normalized)}, ${quote(titleCase)}, ${quote(upper)}] OR department IN [${quote(normalized)}, ${quote(titleCase)}, ${quote(upper)}])`);
  }
  if (params.markdown !== undefined) filters.push(`isMarkdown = ${params.markdown}`);
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
    case 'price_asc': return ['sellingPrice:asc'];
    case 'price_desc': return ['sellingPrice:desc'];
    case 'newest': return ['publishedAt:desc'];
    default: return undefined;
  }
}

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new SearchIndexService(fastify);
  const pinAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:search:pin')];
  const reindexAuth = [fastify.requireStaffAuth, fastify.requirePermission('search:reindex')];

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

  fastify.post('/search/reindex', { preHandler: reindexAuth }, async (_request, reply) => {
    reply.status(200).send(await service.reindexAll());
  });
};

export default searchRoutes;
