import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ShippingService } from './service.js';

const createShipmentSchema = z.object({ idempotencyKey: z.string().min(1).max(200) });

/**
 * Shipping / Tracking routes (M17). Staff shipment-creation/read routes
 * require `shipping:manage` (same permission model as `warehouse:*` -
 * see packages/shared/src/permissions.ts). The carrier webhook is
 * public/unauthenticated by design - protected by HMAC signature
 * verification instead (mirrors modules/payment/routes.ts exactly,
 * including reuse of the same global raw-body-preserving content-type
 * parser registered once in app.ts).
 *
 * Object-level authorization (IDOR/BOLA, same discipline as M16
 * modules/warehouse/routes.ts): every route resolves a Shipment
 * strictly by its own id; a staff member without `shipping:manage`
 * is rejected by requirePermission before ever reaching the service
 * layer, regardless of which id they guess.
 */
const shippingRoutes: FastifyPluginAsync = async (fastify) => {
  const shippingService = new ShippingService(fastify);

  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('shipping:manage')];

  fastify.post(
    '/orders/fulfilments/:fulfilmentId/shipment',
    { preHandler: manageAuth },
    async (request, reply) => {
      const { fulfilmentId } = z.object({ fulfilmentId: z.string().uuid() }).parse(request.params);
      const body = createShipmentSchema.parse(request.body);
      reply
        .status(201)
        .send(await shippingService.createShipment(fulfilmentId, request.staffUser!.id, body.idempotencyKey));
    },
  );

  fastify.get('/shipments/:id', { preHandler: manageAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await shippingService.getShipment(id));
  });

  fastify.get('/orders/:orderId/shipments', { preHandler: manageAuth }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await shippingService.listShipmentsForOrder(orderId));
  });

  // SHIP-003 polling fallback - callable directly by an operator/future
  // scheduler (no cron scheduler exists in this codebase yet, same
  // "callable directly" shape as InventoryService.expireStaleReservations).
  fastify.post('/shipments/poll', { preHandler: manageAuth }, async (_request, reply) => {
    reply.status(200).send(await shippingService.pollPendingShipments());
  });

  // Independent-review repair (M17, 2026-09-25): `:provider` is genuinely
  // used to select which registered ShippingProvider authenticates and
  // parses this request - see ShippingService.handleCarrierWebhook's
  // docblock. Never falls back to the globally configured
  // SHIPPING_PROVIDER; an unknown/unconfigured name fails safely (400).
  // Case-insensitive (upper-cased before lookup) so a carrier's own URL
  // casing convention doesn't matter - the registry key is the source of
  // truth, not string-exact matching.
  fastify.post('/webhooks/shipping/:provider', async (request, reply) => {
    const { provider } = z.object({ provider: z.string().min(1).max(64) }).parse(request.params);
    const signature = request.headers['x-shipping-signature'];
    const result = await shippingService.handleCarrierWebhook(
      provider.toUpperCase(),
      request.rawBody ?? '',
      typeof signature === 'string' ? signature : undefined,
    );
    if (!result.ok) {
      reply.status(400).send({ error: result.reason });
      return;
    }
    reply.status(200).send({ received: true, duplicate: result.duplicate ?? false });
  });
};

export default shippingRoutes;
