import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CatalogService } from './service.js';
import { purgeCatalogAfter } from '../pdp/storefront-cache.js';

const priceSchema = z.object({
  styleId: z.string().uuid(),
  colourId: z.string().uuid().optional(),
  mrp: z.number().positive(),
  sellingPrice: z.number().positive(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
});

const collectionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
});

const badgeSchema = z.object({
  styleId: z.string().uuid(),
  badgeType: z.enum(['NEW_ARRIVAL', 'BESTSELLER', 'SALE', 'MARKDOWN']),
  source: z.enum(['RULE', 'MANUAL']).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new CatalogService(fastify);
  const priceWriteAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:price:write')];
  const priceApproveAuth = [
    fastify.requireStaffAuth,
    fastify.requirePermission('catalog:price:write'),
    fastify.requirePermission('catalog:price:approve'),
  ];
  const publishAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:publish')];
  const collectionAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:collection:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('product:read')];
  const afterChange = purgeCatalogAfter(fastify);

  fastify.post('/catalog/prices', { preHandler: priceWriteAuth }, async (request, reply) => {
    const body = priceSchema.parse(request.body);
    const result = await service.setBasePrice(body, request.staffUser!.id);
    await fastify.searchIndex.indexStyle(body.styleId); // M10: price affects sort/facet/eligibility
    await fastify.storefrontCache.invalidateProduct(body.styleId);
    reply.status(201).send(result);
  });

  fastify.post('/catalog/prices/markdown', { preHandler: priceApproveAuth }, async (request, reply) => {
    const body = priceSchema.parse(request.body);
    const result = await service.setMarkdownPrice(body, request.staffUser!.id);
    await fastify.searchIndex.indexStyle(body.styleId); // M10
    await fastify.storefrontCache.invalidateProduct(body.styleId);
    reply.status(201).send(result);
  });

  fastify.get('/catalog/prices/:styleId', { preHandler: readAuth }, async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.listPrices(styleId));
  });

  fastify.get('/catalog/entries/:styleId', { preHandler: readAuth }, async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getCatalogEntry(styleId));
  });

  fastify.post('/catalog/collections', { preHandler: collectionAuth }, async (request, reply) => {
    const body = collectionSchema.parse(request.body);
    reply.status(201).send(await afterChange(service.createCollection(body, request.staffUser!.id)));
  });

  fastify.post(
    '/catalog/collections/:id/styles',
    { preHandler: collectionAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.body);
      reply.status(201).send(await afterChange(service.addStyleToCollection(id, styleId, request.staffUser!.id)));
    },
  );

  fastify.delete(
    '/catalog/collections/:id/styles/:styleId',
    { preHandler: collectionAuth },
    async (request, reply) => {
      const { id, styleId } = z
        .object({ id: z.string().uuid(), styleId: z.string().uuid() })
        .parse(request.params);
      await afterChange(service.removeStyleFromCollection(id, styleId, request.staffUser!.id));
      reply.status(204).send();
    },
  );

  fastify.post(
    '/catalog/collections/:id/publish',
    { preHandler: publishAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await afterChange(service.setCollectionActive(id, true, request.staffUser!.id)));
    },
  );

  fastify.post(
    '/catalog/collections/:id/unpublish',
    { preHandler: publishAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await afterChange(service.setCollectionActive(id, false, request.staffUser!.id)));
    },
  );

  fastify.post('/catalog/badges', { preHandler: collectionAuth }, async (request, reply) => {
    const body = badgeSchema.parse(request.body);
    // Badges show on listing cards, which read them from the search index.
    const badge = await afterChange(service.setBadge(body, request.staffUser!.id).then(async (created) => {
      await fastify.searchIndex.indexStyle(created.styleId);
      return created;
    }));
    reply.status(201).send(badge);
  });

  fastify.delete('/catalog/badges/:id', { preHandler: collectionAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await afterChange(service.removeBadge(id, request.staffUser!.id).then((removed) => fastify.searchIndex.indexStyle(removed.styleId)));
    reply.status(204).send();
  });

  fastify.get('/catalog/badges/:styleId', { preHandler: readAuth }, async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.listBadges(styleId));
  });

  // Public (unauthenticated) storefront read routes - never exposes a
  // draft/unpublished style or an entry with no active price. See
  // CatalogService.listPublicStyles/listPublicCollections.
  fastify.get('/storefront/styles', async (request, reply) => {
    const { take, skip } = z
      .object({
        take: z.coerce.number().int().positive().max(60).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listPublicStyles({ take, skip }));
  });

  fastify.get('/storefront/collections', async (request, reply) => {
    const { take, skip } = z
      .object({
        take: z.coerce.number().int().positive().max(60).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listPublicCollections({ take, skip }));
  });

  // LR-002: category pages answer a real 404 for an unknown slug, and the
  // sitemap lists every category that has storefront-visible products.
  fastify.get('/storefront/categories/:slug', async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(request.params);
    const category = await service.getPublicCategory(slug);
    if (!category) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
      return;
    }
    reply.status(200).send(category);
  });

  fastify.get('/storefront/seo/products', async (request, reply) => {
    const { take, skip } = z
      .object({ take: z.coerce.number().int().positive().max(10_000).default(10_000), skip: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query);
    reply.status(200).send(await service.listPublicStyleIdsForSitemap({ take, skip }));
  });

  fastify.get('/storefront/seo/categories', async (_request, reply) => {
    reply.status(200).send(await service.listPublicCategoriesWithProducts());
  });

  fastify.get('/storefront/collections/:slug', async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(request.params);
    const collection = await service.getPublicCollection(slug);
    if (!collection) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Collection not found' } });
      return;
    }
    reply.status(200).send(collection);
  });

};

export default catalogRoutes;
