import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ContentService } from './service.js';

const createSchema = z.object({
  title: z.string().min(1),
  mediaUrl: z.string().min(1),
  thumbnailUrl: z.string().optional(),
  creatorAttribution: z.string().optional(),
  campaignRef: z.string().optional(),
  merchandisingPosition: z.number().int().nonnegative().optional(),
});

const tagSchema = z.object({
  styleId: z.string().uuid(),
  colourId: z.string().uuid().optional(),
  sizeId: z.string().uuid().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const transitionSchema = z.object({
  toState: z.enum(['DRAFT', 'PENDING_MODERATION', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'REJECTED']),
  scheduledPublishAt: z.coerce.date().optional(),
  moderationNote: z.string().optional(),
});

const eventSchema = z.object({
  eventType: z.enum(['VIEW', 'TAG_TAP', 'ADD_TO_BAG']),
  customerId: z.string().uuid().optional(),
  sessionRef: z.string().optional(),
});

const contentRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ContentService(fastify);
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('content:manage')];
  const moderateAuth = [fastify.requireStaffAuth, fastify.requirePermission('content:moderate')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('content:read')];

  fastify.post('/content/shoppable-media', { preHandler: manageAuth }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    reply.status(201).send(await service.createShoppableMedia(body, request.staffUser!.id));
  });

  fastify.get('/content/shoppable-media', { preHandler: readAuth }, async (request, reply) => {
    const { state } = z
      .object({
        state: z
          .enum(['DRAFT', 'PENDING_MODERATION', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'REJECTED'])
          .optional(),
      })
      .parse(request.query);
    reply.status(200).send(await service.listAllForStaff(state));
  });

  fastify.get('/content/shoppable-media/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await service.getById(id));
  });

  fastify.post(
    '/content/shoppable-media/:id/tags',
    { preHandler: manageAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = tagSchema.parse(request.body);
      reply.status(201).send(await service.addTag(id, body, request.staffUser!.id));
    },
  );

  fastify.delete('/content/shoppable-media/tags/:tagId', { preHandler: manageAuth }, async (request, reply) => {
    const { tagId } = z.object({ tagId: z.string().uuid() }).parse(request.params);
    await service.removeTag(tagId, request.staffUser!.id);
    reply.status(204).send();
  });

  fastify.post(
    '/content/shoppable-media/:id/transition',
    { preHandler: moderateAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = transitionSchema.parse(request.body);
      reply
        .status(200)
        .send(
          await service.transition(id, body.toState, request.staffUser!.id, {
            scheduledPublishAt: body.scheduledPublishAt,
            moderationNote: body.moderationNote,
          }),
        );
    },
  );

  fastify.post(
    '/content/shoppable-media/promote-scheduled',
    { preHandler: moderateAuth },
    async (_request, reply) => {
      const promoted = await service.promoteDueScheduledMedia();
      reply.status(200).send({ promoted });
    },
  );

  // Public storefront feed - no staff auth (this is the customer-facing
  // Home/Watch & Shop read path). Only ever returns PUBLISHED (or
  // due-SCHEDULED) media - see ContentService.getPublicFeed.
  fastify.get('/content/watch-and-shop/feed', async (_request, reply) => {
    reply.status(200).send(await service.getPublicFeed());
  });

  fastify.post('/content/watch-and-shop/:id/events', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = eventSchema.parse(request.body);
    reply
      .status(201)
      .send(await service.recordEvent(id, body.eventType, { customerId: body.customerId, sessionRef: body.sessionRef }));
  });
};

export default contentRoutes;
