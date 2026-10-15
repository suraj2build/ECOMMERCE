import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DispatchService } from './service.js';
import { OrderService } from '../order/service.js';

/** Dispatch settings and courier handover (docs/admin/DISPATCH.md). */
const dispatchRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new DispatchService(fastify.prisma, new OrderService(fastify));
  const shippingAuth = [fastify.requireStaffAuth, fastify.requirePermission('shipping:manage')];

  // Any signed-in staff member may read the checks (the pick and pack screens show them).
  fastify.get('/dispatch/settings', { preHandler: [fastify.requireStaffAuth] }, async () => service.getSettings());

  fastify.put('/dispatch/settings', { preHandler: [fastify.requireStaffAuth, fastify.requirePermission('org:manage')] }, async (request) => {
    const body = z.object({ requireScanAtPick: z.boolean(), requireScanAtPack: z.boolean(), requireParcelMeasurements: z.boolean() }).strict().parse(request.body);
    return service.updateSettings(body, request.staffUser!.id);
  });

  fastify.get('/shipments/handover', { preHandler: shippingAuth }, async () => service.awaitingHandover());

  fastify.post('/shipments/handover', { preHandler: shippingAuth }, async (request) => {
    const body = z.object({ shipmentIds: z.array(z.string().uuid()).min(1).max(500), reference: z.string().max(120).optional() }).strict().parse(request.body);
    return service.recordHandover(body.shipmentIds, body.reference, request.staffUser!.id);
  });
};

export default dispatchRoutes;
