import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ChannelService } from './service.js';

const createChannelSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  providerName: z.string().min(1).max(100),
  config: z.record(z.unknown()).optional(),
});

/**
 * Channel publishing routes (M26, specs/25-social-channel-publishing.md).
 * Minimal staff API surface - adapter/contract architecture only, no
 * concrete marketplace integration - gated by `channel:manage`/
 * `channel:read`, mirroring the marketing module's own route shape.
 */
const channelRoutes: FastifyPluginAsync = async (fastify) => {
  const channels = new ChannelService(fastify);
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('channel:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('channel:read')];

  fastify.post('/channels', { preHandler: manageAuth }, async (request, reply) => {
    const body = createChannelSchema.parse(request.body);
    reply.status(201).send(await channels.createChannel(body, request.staffUser!.id));
  });

  fastify.get('/channels', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await channels.listChannels());
  });

  fastify.get('/channels/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.getChannel(id));
  });

  fastify.get('/channels/:id/listings', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.listListings(id));
  });

  // Read-only feed preview - proves the field-mapping contract for a
  // given SKU without publishing anything (acceptance test requirement:
  // "produces a correctly-mapped feed from core catalog data").
  fastify.get('/channels/:id/preview/:skuId', { preHandler: readAuth }, async (request, reply) => {
    const { id, skuId } = z.object({ id: z.string().uuid(), skuId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.previewFeedItem(id, skuId));
  });

  fastify.post('/channels/:id/skus/:skuId/publish', { preHandler: manageAuth }, async (request, reply) => {
    const { id, skuId } = z.object({ id: z.string().uuid(), skuId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.publishSku(id, skuId, request.staffUser!.id));
  });

  fastify.post('/channels/:id/skus/:skuId/unpublish', { preHandler: manageAuth }, async (request, reply) => {
    const { id, skuId } = z.object({ id: z.string().uuid(), skuId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.unpublishSku(id, skuId, request.staffUser!.id));
  });

  fastify.get('/channels/listings/:listingId/attempts', { preHandler: readAuth }, async (request, reply) => {
    const { listingId } = z.object({ listingId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await channels.listAttempts(listingId));
  });
};

export default channelRoutes;
