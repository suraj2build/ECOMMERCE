import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SupportService } from './service.js';

/**
 * Internal Customer 360 routes (M29, specs/28-admin.md ADM-002). Gated
 * by the EXISTING `customer_service:manage` permission (already granted
 * to CUSTOMER_SERVICE - this permission existed since M01 but had no
 * route consuming it until this milestone).
 */
const supportRoutes: FastifyPluginAsync = async (fastify) => {
  const support = new SupportService(fastify);
  const auth = [fastify.requireStaffAuth, fastify.requirePermission('customer_service:manage')];

  fastify.get('/support/customers/lookup', { preHandler: auth }, async (request, reply) => {
    const { mobile } = z.object({ mobile: z.string().min(1) }).parse(request.query);
    reply.status(200).send(await support.findCustomerByMobile(mobile));
  });

  fastify.get('/support/customers/:id/360', { preHandler: auth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await support.getInternalCustomer360(id));
  });
};

export default supportRoutes;
