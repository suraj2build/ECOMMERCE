import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@fcp/shared';
import { RefundService } from './service.js';
import { StoreCreditService } from './store-credit-service.js';
import { resolveCartIdentity } from '../cart/identity.js';

const processRefundSchema = z.object({
  orderId: z.string().uuid(),
  orderLineId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
});

/**
 * Refunds & store-credit routes (M20). `payment:refund` (pre-existing
 * FINANCE permission, seeded for exactly this purpose) gates every
 * staff-side mutating and read action; storefront routes are
 * ownership-checked via the same guest-or-customer identity pattern as
 * every other storefront order/return route (`resolveCartIdentity`).
 */
const refundRoutes: FastifyPluginAsync = async (fastify) => {
  const refunds = new RefundService(fastify);
  const storeCredit = new StoreCreditService(fastify);

  const refundAuth = [fastify.requireStaffAuth, fastify.requirePermission('payment:refund')];
  const identityAuth = { preHandler: fastify.tryCustomerAuth };

  // --- Staff ---

  fastify.post('/refunds', { preHandler: refundAuth }, async (request, reply) => {
    const body = processRefundSchema.parse(request.body);
    reply.status(201).send(await refunds.processRefundForOrderLine(body.orderId, body.orderLineId, request.staffUser!.id, body.idempotencyKey));
  });

  fastify.post('/refunds/:id/retry', { preHandler: refundAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await refunds.retryRefund(id));
  });

  fastify.post('/refunds/reconcile', { preHandler: refundAuth }, async (_request, reply) => {
    reply.status(200).send(await refunds.reconcilePendingRefunds());
  });

  fastify.get('/refunds/:id', { preHandler: refundAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await refunds.getRefund(id));
  });

  fastify.get('/orders/:orderId/refunds', { preHandler: refundAuth }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await refunds.listRefundsForOrder(orderId));
  });

  // --- Storefront (customer/guest self-service, read-only) ---

  fastify.get('/storefront/store-credit', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await storeCredit.getBalanceForIdentity(identity));
  });

  fastify.get('/storefront/orders/:orderId/refunds', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(request.params);
    const order = await fastify.prisma.order.findUnique({ where: { id: orderId } });
    const owns =
      !!order &&
      ((identity.customerId && order.customerId === identity.customerId) || (identity.guestSessionId && order.guestSessionId === identity.guestSessionId));
    if (!owns) throw new NotFoundError('Order', orderId);
    reply.status(200).send(await refunds.listRefundsForOrder(orderId));
  });
};

export default refundRoutes;
