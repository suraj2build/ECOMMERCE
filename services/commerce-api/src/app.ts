import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import { loadEnv } from '@fcp/config';
import { createLogger } from '@fcp/shared';

import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import meilisearchPlugin from './plugins/meilisearch.js';
import corsPlugin from './plugins/cors.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import securityHeadersPlugin from './plugins/security-headers.js';

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
import { StorefrontCacheService } from './modules/pdp/storefront-cache.js';
import pdpRoutes from './modules/pdp/routes.js';
import cartRoutes from './modules/cart/routes.js';
import checkoutRoutes from './modules/checkout/routes.js';
import paymentRoutes from './modules/payment/routes.js';
import orderRoutes from './modules/order/routes.js';
import warehouseRoutes from './modules/warehouse/routes.js';
import shippingRoutes from './modules/shipping/routes.js';
import returnRoutes from './modules/returns/routes.js';
import refundRoutes from './modules/refunds/routes.js';
import exchangeRoutes from './modules/exchanges/routes.js';
import customerProfileRoutes from './modules/customer-profile/routes.js';
import loyaltyRoutes from './modules/loyalty/routes.js';
import giftCardRoutes from './modules/gift-cards/routes.js';
import promotionsRoutes from './modules/promotions/routes.js';
import marketingRoutes from './modules/marketing/routes.js';
import channelRoutes from './modules/channels/routes.js';
import analyticsRoutes from './modules/analytics/routes.js';
import cmsRoutes from './modules/cms/routes.js';
import supportRoutes from './modules/support/routes.js';
import adminQueryRoutes from './modules/admin-queries/routes.js';

export interface BuildAppOptions {
  /** Test seam: route log output to a caller-supplied stream instead of stdout. */
  logDestination?: Parameters<typeof createLogger>[2];
  /** Test seam: keep per-request logging on under NODE_ENV=test (off by default there). */
  requestLogging?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const logger: FastifyBaseLogger = createLogger('commerce-api', env.LOG_LEVEL, options.logDestination);

  const app = Fastify({
    // Fastify v5: a pre-built pino instance goes via loggerInstance, not
    // logger (that option now only accepts true/false/a pino config
    // object) - see docs/decisions/0018-fastify-v5-cve-migration.md.
    loggerInstance: logger,
    disableRequestLogging: options.requestLogging === undefined ? env.NODE_ENV === 'test' : !options.requestLogging,
    // Trust exactly TRUST_PROXY_HOPS proxies (the same rule proxy-addr
    // applies for a numeric setting), so request.ip is never taken from a
    // client-supplied X-Forwarded-For prefix.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    // M33 observability review (2026-09-29): Fastify's own default
    // reqId is a per-process incrementing counter - fine for a single
    // instance, but not a real correlation ID across multiple replicas
    // or across an upstream proxy/CDN and this service's own logs. Reuse
    // an inbound x-request-id (a CDN/WAF/API-gateway-assigned ID, if
    // one is already present) so this service's logs correlate with the
    // edge layer's own; otherwise mint a real UUID. Every request-scoped
    // log line already includes this as `reqId` (Fastify's own default
    // logging behavior); onSend below also echoes it back as a response
    // header so a client/caller can report a specific request precisely.
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined)?.slice(0, 128) || randomUUID(),
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
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
  await app.register(securityHeadersPlugin);
  await app.register(authPlugin);
  // Depends on redisPlugin (registered above) for its shared,
  // multi-process-safe counter store - see plugins/rate-limit.ts.
  await app.register(rateLimitPlugin);
  // Return-evidence upload only (M19 independent-review repair, finding
  // 2) - a hard byte-ceiling backstop at the transport layer, defence
  // in depth alongside ReturnService.uploadEvidence's own config-driven
  // size/MIME checks. Nothing else in this API accepts file uploads.
  await app.register(multipart, { limits: { fileSize: loadEnv().RETURN_EVIDENCE_MAX_FILE_SIZE_BYTES, files: 1 } });

  // Search indexing (M10, ADR-0006) - decorated once so every module can
  // trigger a best-effort reindex after a catalog/price/stock change
  // without importing another module's service class directly.
  app.decorate('searchIndex', new SearchIndexService(app));
  // Fire-and-forget: index settings converge eventually even if
  // Meilisearch isn't up yet at boot (see SearchIndexService.configureIndex).
  void app.searchIndex.configureIndex();
  // Drops the storefront's cached product page after a publish-state,
  // media or price change (modules/pdp/storefront-cache.ts).
  app.decorate('storefrontCache', new StorefrontCacheService(app.log));

  // Health & readiness (M00 requirement). Excluded from the M31 global
  // rate limiter (plugins/rate-limit.ts) - these are unauthenticated
  // orchestration liveness/readiness probes, not the attacker-facing
  // surface that control exists for.
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
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
  await app.register(orderRoutes, { prefix: '/api/v1' });
  await app.register(warehouseRoutes, { prefix: '/api/v1' });
  await app.register(shippingRoutes, { prefix: '/api/v1' });
  await app.register(returnRoutes, { prefix: '/api/v1' });
  await app.register(refundRoutes, { prefix: '/api/v1' });
  await app.register(exchangeRoutes, { prefix: '/api/v1' });
  await app.register(customerProfileRoutes, { prefix: '/api/v1' });
  await app.register(loyaltyRoutes, { prefix: '/api/v1' });
  await app.register(giftCardRoutes, { prefix: '/api/v1' });
  await app.register(promotionsRoutes, { prefix: '/api/v1' });
  await app.register(marketingRoutes, { prefix: '/api/v1' });
  await app.register(channelRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });
  await app.register(cmsRoutes, { prefix: '/api/v1' });
  await app.register(supportRoutes, { prefix: '/api/v1' });
  await app.register(adminQueryRoutes, { prefix: '/api/v1' });

  return app;
}
