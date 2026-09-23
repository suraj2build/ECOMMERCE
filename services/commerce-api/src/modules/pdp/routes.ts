import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PdpService } from './service.js';
import { ReviewService } from './review-service.js';
import { ServiceabilityService } from './serviceability-service.js';
import { CrossSellService } from './cross-sell-service.js';

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().optional(),
  body: z.string().min(1),
});

const pincodeSchema = z.object({
  pincode: z.string().regex(/^[0-9]{6}$/),
  city: z.string().min(1),
  state: z.string().min(1),
  isServiceable: z.boolean().optional(),
  codAvailable: z.boolean().optional(),
  estimatedDaysMin: z.number().int().nonnegative().optional(),
  estimatedDaysMax: z.number().int().nonnegative().optional(),
});

const crossSellSchema = z.object({
  relatedStyleId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const pdpRoutes: FastifyPluginAsync = async (fastify) => {
  const pdpService = new PdpService(fastify);
  const reviewService = new ReviewService(fastify);
  const serviceabilityService = new ServiceabilityService(fastify);
  const crossSellService = new CrossSellService(fastify);

  const moderateAuth = [fastify.requireStaffAuth, fastify.requirePermission('review:moderate')];
  const pincodeAuth = [fastify.requireStaffAuth, fastify.requirePermission('pincode:manage')];
  const crossSellAuth = [fastify.requireStaffAuth, fastify.requirePermission('catalog:cross_sell:manage')];

  // --- Public storefront reads (no auth) ---

  fastify.get('/storefront/products/:styleId', async (request, reply) => {
    const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await pdpService.getProductDetail(styleId));
  });

  fastify.get('/storefront/serviceability', async (request, reply) => {
    const { pincode } = z.object({ pincode: z.string().regex(/^[0-9]{6}$/) }).parse(request.query);
    reply.status(200).send(await serviceabilityService.checkServiceability(pincode));
  });

  // --- Customer-authenticated write ---

  fastify.post(
    '/storefront/products/:styleId/reviews',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const { styleId } = z.object({ styleId: z.string().uuid() }).parse(request.params);
      const body = reviewSchema.parse(request.body);
      const review = await reviewService.submitReview(request.customer!.id, { styleId, ...body });
      reply.status(201).send(review);
    },
  );

  // --- Staff moderation / configuration ---

  fastify.post('/pdp/reviews/:id/hide', { preHandler: moderateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await reviewService.hideReview(id, request.staffUser!.id));
  });

  fastify.post('/pdp/reviews/:id/unhide', { preHandler: moderateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await reviewService.unhideReview(id, request.staffUser!.id));
  });

  fastify.post('/pdp/pincodes', { preHandler: pincodeAuth }, async (request, reply) => {
    const body = pincodeSchema.parse(request.body);
    reply.status(200).send(await serviceabilityService.upsertPincode(body, request.staffUser!.id));
  });

  fastify.get('/pdp/pincodes', { preHandler: pincodeAuth }, async (request, reply) => {
    const { take, skip } = z
      .object({ take: z.coerce.number().int().positive().max(200).optional(), skip: z.coerce.number().int().nonnegative().optional() })
      .parse(request.query);
    reply.status(200).send(await serviceabilityService.listPincodes({ take, skip }));
  });

  fastify.post('/catalog/styles/:id/cross-sell', { preHandler: crossSellAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = crossSellSchema.parse(request.body);
    reply
      .status(201)
      .send(await crossSellService.addOverride(id, body.relatedStyleId, request.staffUser!.id, body.sortOrder));
  });

  fastify.delete(
    '/catalog/styles/:id/cross-sell/:relatedStyleId',
    { preHandler: crossSellAuth },
    async (request, reply) => {
      const { id, relatedStyleId } = z
        .object({ id: z.string().uuid(), relatedStyleId: z.string().uuid() })
        .parse(request.params);
      await crossSellService.removeOverride(id, relatedStyleId, request.staffUser!.id);
      reply.status(204).send();
    },
  );
};

export default pdpRoutes;
