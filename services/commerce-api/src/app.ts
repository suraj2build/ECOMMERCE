import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { loadEnv } from '@fcp/config';
import { createLogger } from '@fcp/shared';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';

import authRoutes from './modules/auth/routes.js';
import organizationRoutes from './modules/organization/routes.js';
import productRoutes from './modules/product/routes.js';
import supplierRoutes from './modules/supplier/routes.js';
import procurementRoutes from './modules/procurement/routes.js';
import grnRoutes from './modules/grn/routes.js';
import inventoryRoutes from './modules/inventory/routes.js';
import catalogRoutes from './modules/catalog/routes.js';
import taxRoutes from './modules/tax/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const logger: FastifyBaseLogger = createLogger('commerce-api', env.LOG_LEVEL);

  const app = Fastify({
    logger,
    disableRequestLogging: env.NODE_ENV === 'test',
    trustProxy: true,
  });

  // Core infrastructure plugins (order matters: auth depends on prisma+redis)
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  // Health & readiness (M00 requirement)
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      await app.redis.ping();
      reply.status(200).send({ status: 'ready' });
    } catch (err) {
      app.log.error({ err }, 'Readiness check failed');
      reply.status(503).send({ status: 'not_ready' });
    }
  });

  // Domain module routes, one per milestone (M01-M07, M08+)
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(organizationRoutes, { prefix: '/api/v1' });
  await app.register(productRoutes, { prefix: '/api/v1' });
  await app.register(supplierRoutes, { prefix: '/api/v1' });
  await app.register(procurementRoutes, { prefix: '/api/v1' });
  await app.register(grnRoutes, { prefix: '/api/v1' });
  await app.register(inventoryRoutes, { prefix: '/api/v1' });
  await app.register(catalogRoutes, { prefix: '/api/v1' });
  await app.register(taxRoutes, { prefix: '/api/v1' });

  return app;
}
