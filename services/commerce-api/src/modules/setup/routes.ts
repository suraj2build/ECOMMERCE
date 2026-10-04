import type { FastifyPluginAsync } from 'fastify';
import { SetupService } from './service.js';

/** Admin Ops Phase 1: Setup & health (org:manage). Read-only except the explicit storage test. */
const setupRoutes: FastifyPluginAsync = async (fastify) => {
  const setup = new SetupService(fastify);
  const auth = [fastify.requireStaffAuth, fastify.requirePermission('org:manage')];
  fastify.get('/admin/setup', { preHandler: auth }, async () => setup.overview());
  fastify.post('/admin/setup/media-storage/test', { preHandler: auth }, async () => setup.testMediaStorage());
};

export default setupRoutes;
