import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AnalyticsService } from './service.js';

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Analytics / Reporting routes (M28, specs/27-analytics-reporting.md).
 * Staff-gated reads only, reusing the EXISTING `analytics:read`
 * permission (already granted to ANALYTICS/BUSINESS_ADMIN/FINANCE) - no
 * new permission key needed for a read-only reporting surface.
 */
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const analytics = new AnalyticsService(fastify);
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('analytics:read')];

  fastify.get('/analytics/commerce', { preHandler: readAuth }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    reply.status(200).send(
      await analytics.getCommerceReport({
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
    );
  });

  fastify.get('/analytics/fashion', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await analytics.getFashionReport());
  });

  fastify.get('/analytics/procurement', { preHandler: readAuth }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    reply.status(200).send(
      await analytics.getProcurementReport({
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
    );
  });
};

export default analyticsRoutes;
