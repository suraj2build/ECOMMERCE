import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ExchangeService } from './service.js';
import { resolveCartIdentity } from '../cart/identity.js';

const initiateExchangeSchema = z.object({
  orderId: z.string().uuid(),
  orderLineId: z.string().uuid(),
  replacementSkuId: z.string().uuid(),
  reason: z.string().min(1).max(2000),
  method: z.enum(['PICKUP', 'DROP_OFF']),
  idempotencyKey: z.string().min(1).max(200),
});
const cancelExchangeSchema = z.object({ reason: z.string().max(2000).optional() });
const idempotencyKeySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });
const qcSchema = z.object({
  qcResult: z.enum(['PASS', 'FAIL']),
  disposition: z.enum(['RESTOCK_SELLABLE', 'RESTOCK_DAMAGED', 'WRITE_OFF', 'RETURN_TO_SUPPLIER']),
  notes: z.string().max(2000).optional(),
});

/**
 * Exchange routes (M21, specs/20-exchanges.md). Mirrors returns/routes.ts's
 * own staff/storefront split and RBAC granularity exactly
 * (exchange:initiate/receive/qc alongside exchange:read).
 */
const exchangeRoutes: FastifyPluginAsync = async (fastify) => {
  const exchanges = new ExchangeService(fastify);

  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('exchange:read')];
  const initiateAuth = [fastify.requireStaffAuth, fastify.requirePermission('exchange:initiate')];
  const receiveAuth = [fastify.requireStaffAuth, fastify.requirePermission('exchange:receive')];
  const qcAuth = [fastify.requireStaffAuth, fastify.requirePermission('exchange:qc')];
  const identityAuth = { preHandler: fastify.tryCustomerAuth };

  // --- Storefront (customer/guest self-service) ---

  fastify.post('/storefront/exchanges', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = initiateExchangeSchema.parse(request.body);
    reply.status(201).send(
      await exchanges.initiateExchangeForCustomer(
        { orderId: body.orderId, orderLineId: body.orderLineId, replacementSkuId: body.replacementSkuId, reason: body.reason, method: body.method },
        identity,
        body.idempotencyKey,
      ),
    );
  });

  fastify.get('/storefront/exchanges', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await exchanges.listExchangesForCustomer(identity));
  });

  fastify.get('/storefront/exchanges/:id', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await exchanges.getExchangeForCustomer(id, identity));
  });

  fastify.post('/storefront/exchanges/:id/cancel', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = cancelExchangeSchema.parse(request.body ?? {});
    reply.status(200).send(await exchanges.cancelExchange(id, null, identity, body.reason));
  });

  fastify.post('/storefront/exchanges/:id/pay', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await exchanges.getExchangeForCustomer(id, identity); // ownership check
    reply.status(200).send(await exchanges.initiatePriceDifferencePayment(id));
  });

  // --- Staff ---

  fastify.post('/exchanges', { preHandler: initiateAuth }, async (request, reply) => {
    const body = initiateExchangeSchema.parse(request.body);
    reply.status(201).send(
      await exchanges.initiateExchangeForStaff(
        { orderId: body.orderId, orderLineId: body.orderLineId, replacementSkuId: body.replacementSkuId, reason: body.reason, method: body.method },
        request.staffUser!.id,
        body.idempotencyKey,
      ),
    );
  });

  fastify.get('/exchanges/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await exchanges.getExchange(id));
  });

  fastify.get('/orders/:orderId/exchanges', { preHandler: readAuth }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await exchanges.listExchangesForOrder(orderId));
  });

  fastify.get('/exchanges', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({ status: z.enum(['REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED', 'COMPLETED', 'QC_FAILED', 'REPLACEMENT_UNAVAILABLE', 'CANCELLED']).optional() })
      .parse(request.query);
    reply.status(200).send(await exchanges.listPendingWarehouseWork(query.status));
  });

  fastify.post('/exchanges/:id/cancel', { preHandler: initiateAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = cancelExchangeSchema.parse(request.body ?? {});
    reply.status(200).send(await exchanges.cancelExchange(id, request.staffUser!.id, null, body.reason));
  });

  fastify.post('/exchanges/:id/pickup', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = idempotencyKeySchema.parse(request.body);
    reply.status(200).send(await exchanges.schedulePickup(id, request.staffUser!.id, body.idempotencyKey));
  });

  fastify.post('/exchanges/:id/pickup/complete', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await exchanges.markPickedUp(id, request.staffUser!.id));
  });

  fastify.post('/exchanges/:id/receive', { preHandler: receiveAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await exchanges.markReceived(id, request.staffUser!.id));
  });

  fastify.post('/exchanges/:id/qc', { preHandler: qcAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = qcSchema.parse(request.body);
    reply.status(200).send(await exchanges.recordQcAndDisposition(id, request.staffUser!.id, body));
  });
};

export default exchangeRoutes;
