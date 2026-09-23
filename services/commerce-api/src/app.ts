import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyError } from 'fastify';
import { loadEnv } from '@fcp/config';
import { createLogger } from '@fcp/shared';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import meilisearchPlugin from './plugins/meilisearch.js';
import corsPlugin from './plugins/cors.js';
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
import contentRoutes from './modules/content/routes.js';
import searchRoutes from './modules/search/routes.js';
import { SearchIndexService } from './modules/search/index-service.js';
import pdpRoutes from './modules/pdp/routes.js';
import cartRoutes from './modules/cart/routes.js';
import checkoutRoutes from './modules/checkout/routes.js';
import paymentRoutes from './modules/payment/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const logger: FastifyBaseLogger = createLogger('commerce-api', env.LOG_LEVEL);

  const app = Fastify({
    // Fastify v5: a pre-built pino instance goes via loggerInstance, not
    // logger (that option now only accepts true/false/a pino config
    // object) - see docs/decisions/0018-fastify-v5-cve-migration.md.
    loggerInstance: logger,
    disableRequestLogging: env.NODE_ENV === 'test',
    trustProxy: true,
  });

  // Single global `application/json` parser (Fastify does not allow a
  // child plugin to register a second parser for the same content type,
  // even in its own encapsulated context - FST_ERR_CTP_ALREADY_PRESENT -
  // so this one function must serve every route, not just the webhook).
  // Two things it does beyond Fastify's default:
  //
  // 1. Tolerates an EMPTY body sent with this content-type. Fastify v5's
  //    default parser rejects that ("Body cannot be empty...") where v4
  //    tolerated it (docs/decisions/0018-fastify-v5-cve-migration.md) -
  //    every storefront DELETE call (remove cart item, remove wishlist
  //    item, etc.) sends exactly that shape, since the browser fetch
  //    wrapper always sets Content-Type even with nothing to send.
  // 2. Stashes the exact raw bytes on `request.rawBody` - the Razorpay
  //    webhook route (modules/payment/routes.ts) needs the untouched
  //    bytes to verify Razorpay's HMAC signature; re-serializing the
  //    parsed JSON would silently break on any whitespace/key-ordering
  //    difference. Harmless for every other route, which just ignores it.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = body as string;
    request.rawBody = raw;
    if (raw.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      // Fastify's own default parser sets statusCode/code on a malformed-
      // JSON error, which error-handler.ts relies on to return a clean
      // 400 rather than falling through to the generic 500 - a raw
      // SyntaxError from JSON.parse carries neither, so build the same
      // shape here (certification-pass finding, api-input-failures.test.ts).
      const error = new Error('Body is not valid JSON') as FastifyError;
      error.statusCode = 400;
      error.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
      done(error, undefined);
    }
  });

  // Core infrastructure plugins (order matters: auth depends on prisma+redis)
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(meilisearchPlugin);
  await app.register(corsPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  // Search indexing (M10, ADR-0006) - decorated once so every module can
  // trigger a best-effort reindex after a catalog/price/stock change
  // without importing another module's service class directly.
  app.decorate('searchIndex', new SearchIndexService(app));
  // Fire-and-forget: index settings converge eventually even if
  // Meilisearch isn't up yet at boot (see SearchIndexService.configureIndex).
  void app.searchIndex.configureIndex();

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
  await app.register(contentRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  await app.register(pdpRoutes, { prefix: '/api/v1' });
  await app.register(cartRoutes, { prefix: '/api/v1' });
  await app.register(checkoutRoutes, { prefix: '/api/v1' });
  await app.register(paymentRoutes, { prefix: '/api/v1' });

  return app;
}
