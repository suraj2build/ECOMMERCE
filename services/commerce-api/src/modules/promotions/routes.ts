import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PromotionService } from './service.js';

const createPromotionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  promotionTypeKey: z.string().min(1),
  isCoupon: z.boolean(),
  couponCode: z.string().min(3).max(50).optional(),
  discountType: z.enum(['PERCENTAGE', 'FLAT_AMOUNT']),
  discountValue: z.number().positive(),
  maxDiscountAmount: z.number().positive().optional(),
  minCartValue: z.number().nonnegative().optional(),
  stackGroup: z.string().max(100).optional(),
  priority: z.number().int().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  usageLimitTotal: z.number().int().positive().optional(),
  usageLimitPerCustomer: z.number().int().positive().optional(),
  loyaltyCompatible: z.boolean().optional(),
  storeCreditCompatible: z.boolean().optional(),
});

const setActiveSchema = z.object({ isActive: z.boolean() });

/**
 * Promotions routes (M24, specs/23-promotions.md). Minimal staff API
 * surface only, gated by `promotion:manage`/`promotion:read` - not a
 * full merchandising admin console. Customer-facing evaluation happens
 * entirely inside checkout (`CheckoutService.previewCheckout`/
 * `startCheckout`) - there is deliberately no standalone "apply coupon"
 * storefront route, since a coupon's real validity (stacking,
 * concurrency-safe usage caps) can only be authoritatively resolved at
 * the same server-computed pricing step checkout already performs.
 */
const promotionsRoutes: FastifyPluginAsync = async (fastify) => {
  const promotions = new PromotionService(fastify);
  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('promotion:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('promotion:read')];

  fastify.post('/promotions', { preHandler: manageAuth }, async (request, reply) => {
    const body = createPromotionSchema.parse(request.body);
    reply.status(201).send(await promotions.createPromotion(body, request.staffUser!.id));
  });

  fastify.get('/promotions', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await promotions.listPromotions());
  });

  fastify.get('/promotions/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await promotions.getPromotion(id));
  });

  fastify.patch('/promotions/:id/active', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = setActiveSchema.parse(request.body);
    reply.status(200).send(await promotions.setActive(id, body.isActive, request.staffUser!.id));
  });
};

export default promotionsRoutes;
