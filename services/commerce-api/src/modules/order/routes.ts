import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrderService } from './service.js';
import { resolveCartIdentity } from '../cart/identity.js';

const assignFulfilmentSchema = z.object({ lineIds: z.array(z.string().uuid()).min(1) });
const shipSchema = z.object({ carrierName: z.string().optional(), trackingRef: z.string().optional() });
const reasonSchema = z.object({ reason: z.string().min(1) });
const resolveExceptionSchema = z.object({ resolution: z.enum(['REINSTATE', 'CANCEL']), reason: z.string().min(1) });

/**
 * Order routes (M15): staff-facing fulfilment/cancellation/exception/RTO
 * actions, plus storefront read routes for a customer's own order
 * history (ORD-001: "Full order history MUST be retained and queryable
 * for the customer's account"). No public "create order" route - orders
 * are only ever created in-process (OrderService.createOrderFromCheckoutSession),
 * never accepted directly from a client.
 */
const orderRoutes: FastifyPluginAsync = async (fastify) => {
  const orderService = new OrderService(fastify);

  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('order:read')];
  const fulfilAuth = [fastify.requireStaffAuth, fastify.requirePermission('order:fulfil')];
  const cancelAuth = [fastify.requireStaffAuth, fastify.requirePermission('order:cancel')];
  const exceptionAuth = [fastify.requireStaffAuth, fastify.requirePermission('order:exception:manage')];
  const rtoAuth = [fastify.requireStaffAuth, fastify.requirePermission('order:rto')];
  // invoice:create - same permission FINANCE already holds for the M08
  // HTTP invoice-issuance entry point; retrying a failed invoice is the
  // same operation, just re-triggered (independent-review finding #2).
  const invoiceRetryAuth = [fastify.requireStaffAuth, fastify.requirePermission('invoice:create')];
  const identityAuth = { preHandler: fastify.tryCustomerAuth };

  // --- Storefront (customer/guest) ---

  fastify.get('/storefront/orders', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await orderService.listOrdersForCustomer(identity));
  });

  fastify.get('/storefront/orders/:id', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await orderService.getOrderForCustomer(id, identity));
  });

  // --- Staff ---

  fastify.get('/orders', { preHandler: readAuth }, async (request, reply) => {
    const query = z
      .object({
        status: z.enum(['CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'RTO', 'EXCEPTION']).optional(),
        // Lets Finance/operators find orders whose required invoice failed
        // to generate (independent-review finding #2 - "operators can
        // identify invoice-generation failures").
        invoiceStatus: z.enum(['PENDING', 'ISSUED', 'FAILED']).optional(),
        take: z.coerce.number().int().positive().max(200).optional(),
        skip: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    reply.status(200).send(await orderService.listOrders(query));
  });

  fastify.get('/orders/:id', { preHandler: readAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await orderService.getOrder(id));
  });

  fastify.post('/orders/:id/fulfilments', { preHandler: fulfilAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = assignFulfilmentSchema.parse(request.body);
    reply.status(201).send(await orderService.assignLinesToFulfilment(id, body.lineIds, request.staffUser!.id));
  });

  fastify.post('/orders/fulfilments/:fulfilmentId/pack', { preHandler: fulfilAuth }, async (request, reply) => {
    const { fulfilmentId } = z.object({ fulfilmentId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await orderService.markFulfilmentPacked(fulfilmentId, request.staffUser!.id));
  });

  fastify.post('/orders/fulfilments/:fulfilmentId/ship', { preHandler: fulfilAuth }, async (request, reply) => {
    const { fulfilmentId } = z.object({ fulfilmentId: z.string().uuid() }).parse(request.params);
    const body = shipSchema.parse(request.body ?? {});
    reply.status(200).send(await orderService.markFulfilmentShipped(fulfilmentId, request.staffUser!.id, body));
  });

  fastify.post('/orders/fulfilments/:fulfilmentId/deliver', { preHandler: fulfilAuth }, async (request, reply) => {
    const { fulfilmentId } = z.object({ fulfilmentId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await orderService.markFulfilmentDelivered(fulfilmentId, request.staffUser!.id));
  });

  fastify.post('/orders/:id/lines/:lineId/cancel', { preHandler: cancelAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const body = reasonSchema.parse(request.body);
    reply.status(200).send(await orderService.cancelOrderLine(id, lineId, request.staffUser!.id, body.reason));
  });

  fastify.post('/orders/:id/lines/:lineId/exception', { preHandler: exceptionAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const body = reasonSchema.parse(request.body);
    reply.status(200).send(await orderService.flagException(id, lineId, request.staffUser!.id, body.reason));
  });

  fastify.post('/orders/:id/lines/:lineId/exception/resolve', { preHandler: exceptionAuth }, async (request, reply) => {
    const { id, lineId } = z.object({ id: z.string().uuid(), lineId: z.string().uuid() }).parse(request.params);
    const body = resolveExceptionSchema.parse(request.body);
    reply
      .status(200)
      .send(await orderService.resolveException(id, lineId, request.staffUser!.id, body.resolution, body.reason));
  });

  fastify.post('/orders/:id/rto', { preHandler: rtoAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = reasonSchema.parse(request.body);
    reply.status(200).send(await orderService.markRTO(id, request.staffUser!.id, body.reason));
  });

  // Durable invoice-recovery retry (independent-review finding #2):
  // manually re-triggers issuance for one order whose invoice previously
  // failed. Fully idempotent - see OrderService.retryOrderInvoice.
  fastify.post('/orders/:id/retry-invoice', { preHandler: invoiceRetryAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await orderService.retryOrderInvoice(id);
    reply.status(200).send(await orderService.getOrder(id));
  });
};

export default orderRoutes;
