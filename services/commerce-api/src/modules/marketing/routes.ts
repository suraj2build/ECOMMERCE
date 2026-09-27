import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MarketingService } from './service.js';

const createSegmentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  minLifetimeOrderCount: z.number().int().positive().optional(),
  minLifetimeSpend: z.number().positive().optional(),
  loyaltyTierId: z.string().uuid().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'PUSH']),
  messageType: z.enum(['OFFERS_AND_PROMOTIONS', 'PRODUCT_RECOMMENDATIONS', 'NEWSLETTER']),
  subject: z.string().max(200).optional(),
  content: z.string().min(1).max(5000),
  segmentId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
});

/**
 * Marketing routes (M25, specs/24-marketing.md). Minimal staff API
 * surface only, gated by `campaign:manage`/`campaign:read` - not a full
 * marketing admin console. Segment/campaign preview endpoints return
 * recipient COUNTS only, never a raw customer list, per this
 * milestone's own data-minimization requirement.
 */
const marketingRoutes: FastifyPluginAsync = async (fastify) => {
  const marketing = new MarketingService(fastify);
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('campaign:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('campaign:read')];

  fastify.post('/marketing/segments', { preHandler: manageAuth }, async (request, reply) => {
    const body = createSegmentSchema.parse(request.body);
    reply.status(201).send(await marketing.createSegment(body, request.staffUser!.id));
  });

  fastify.get('/marketing/segments', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await marketing.listSegments());
  });

  fastify.get('/marketing/segments/:id/recipient-count', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send({ recipientCount: await marketing.previewRecipientCount(id) });
  });

  fastify.post('/marketing/campaigns', { preHandler: manageAuth }, async (request, reply) => {
    const body = createCampaignSchema.parse(request.body);
    reply.status(201).send(await marketing.createCampaign(body, request.staffUser!.id));
  });

  fastify.get('/marketing/campaigns', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await marketing.listCampaigns());
  });

  fastify.get('/marketing/campaigns/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await marketing.getCampaign(id));
  });

  fastify.post('/marketing/campaigns/:id/send', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await marketing.sendCampaign(id, request.staffUser!.id));
  });

  fastify.post('/marketing/campaigns/:id/cancel', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await marketing.cancelCampaign(id, request.staffUser!.id));
  });

  // The automatic due-campaign sweep (Blocker 3, M25 certification
  // repair) - staff-gated, idempotent, callable, the same shape as
  // `POST /loyalty/sweep/expire`. A future scheduler calls this same
  // route on a timer; this build does not add a scheduler itself.
  fastify.post('/marketing/sweep/send-due', { preHandler: manageAuth }, async (request, reply) => {
    reply.status(200).send(await marketing.processDueCampaigns(request.staffUser!.id));
  });
};

export default marketingRoutes;
