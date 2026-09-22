import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CatalogService } from './service.js';

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

  fastify.post('/catalog/prices', { preHandler: priceWriteAuth }, async (request, reply) => {
    const body = priceSchema.parse(request.body);
    reply.status(201).send(await service.setBasePrice(body, request.staffUser!.id));
  });

  fastify.post('/catalog/prices/markdown', { preHandler: priceApproveAuth }, async (request, reply) => {
    const body = priceSchema.parse(request.body);
    reply.status(201).send(await service.setMarkdownPrice(body, request.staffUser!.id));
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
    reply.status(201).send(await service.createCollection(body, request.staffUser!.id));
  });

  fastify.post(
    '/catalog/collections/:id/styles',
    { preHandler: collectionAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.body);
      reply.status(201).send(await service.addStyleToCollection(id, styleId, request.staffUser!.id));
    },
  );

  fastify.delete(
    '/catalog/collections/:id/styles/:styleId',
    { preHandler: collectionAuth },
    async (request, reply) => {
      const { id, styleId } = z
        .object({ id: z.string().uuid(), styleId: z.string().uuid() })
        .parse(request.params);
      await service.removeStyleFromCollection(id, styleId, request.staffUser!.id);
      reply.status(204).send();
    },
  );

  fastify.post(
    '/catalog/collections/:id/publish',
    { preHandler: publishAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.setCollectionActive(id, true, request.staffUser!.id));
    },
  );

  fastify.post(
    '/catalog/collections/:id/unpublish',
    { preHandler: publishAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await service.setCollectionActive(id, false, request.staffUser!.id));
    },
  );

  fastify.post('/catalog/badges', { preHandler: collectionAuth }, async (request, reply) => {
    const body = badgeSchema.parse(request.body);
    reply.status(201).send(await service.setBadge(body, request.staffUser!.id));
  });

  fastify.delete('/catalog/badges/:id', { preHandler: collectionAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.removeBadge(id, request.staffUser!.id);
    reply.status(204).send();
  });

  fastify.get('/catalog/badges/:styleId', { preHandler: readAuth }, async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.listBadges(styleId));
  });
};

export default catalogRoutes;
