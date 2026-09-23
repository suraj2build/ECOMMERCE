import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CheckoutService } from './service.js';
import { ShippingService } from './shipping-service.js';
import { resolveCartIdentity } from '../cart/identity.js';

const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  // Matches whatever convention GstRegistration.stateCode already uses
  // (e.g. 'DL') - it's compared for plain equality by the tax engine,
  // never parsed, so this only guards against an empty/garbage value.
  stateCode: z.string().min(2).max(4),
  pincode: z.string().regex(/^[0-9]{6}$/),
});

const previewSchema = z.object({ shippingAddress: addressSchema });

const startCheckoutSchema = z.object({
  contactName: z.string().min(1),
  contactMobile: z.string().regex(/^[0-9]{10}$/, 'contactMobile must be a 10-digit number'),
  contactEmail: z.string().email().optional(),
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  paymentMethod: z.enum(['PREPAID', 'COD']),
  idempotencyKey: z.string().min(1),
});

const shippingRuleSchema = z.object({
  type: z.enum(['FLAT', 'FREE_ABOVE_THRESHOLD']),
  flatAmount: z.number().nonnegative().optional(),
  freeAboveThreshold: z.number().nonnegative().optional(),
});

/**
 * Checkout storefront routes (M13). Same guest-or-customer identity
 * pattern as Cart/Wishlist (M12) - checkout is reachable without an
 * account (CHK-001).
 */
const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  const checkoutService = new CheckoutService(fastify);
  const shippingService = new ShippingService(fastify);

  const identityAuth = { preHandler: fastify.tryCustomerAuth };
  const shippingAuth = [fastify.requireStaffAuth, fastify.requirePermission('shipping:manage')];

  fastify.post('/storefront/checkout/preview', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = previewSchema.parse(request.body);
    reply.status(200).send(await checkoutService.previewCheckout(identity, body.shippingAddress));
  });

  fastify.post('/storefront/checkout', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = startCheckoutSchema.parse(request.body);
    reply.status(201).send(await checkoutService.startCheckout(identity, body));
  });

  fastify.get('/storefront/checkout/:id', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await checkoutService.getCheckoutSession(id, identity));
  });

  // --- Staff configuration (CHK-003) ---

  fastify.get('/checkout/shipping-rule', { preHandler: shippingAuth }, async (_request, reply) => {
    reply.status(200).send(await shippingService.getActiveRule());
  });

  fastify.post('/checkout/shipping-rule', { preHandler: shippingAuth }, async (request, reply) => {
    const body = shippingRuleSchema.parse(request.body);
    reply.status(200).send(await shippingService.upsertRule(body, request.staffUser!.id));
  });
};

export default checkoutRoutes;
