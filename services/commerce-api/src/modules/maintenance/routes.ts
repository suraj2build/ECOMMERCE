import type { FastifyPluginAsync } from 'fastify';
import { maintenanceJobStatus } from '../../maintenance.js';

/**
 * LR-006 job monitoring: last run, last success, last failure, the current
 * run of consecutive failures and an alert flag for every scheduled sweep.
 * Operational oversight, so it reuses the audit-reading permission.
 */
const maintenanceRoutes: FastifyPluginAsync = async (fastify) => {
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('audit:read')];
  fastify.get('/maintenance/jobs', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await maintenanceJobStatus(fastify));
  });
};

export default maintenanceRoutes;
