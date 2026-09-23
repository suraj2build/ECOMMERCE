import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Meilisearch } from 'meilisearch';
import { loadEnv } from '@fcp/config';

declare module 'fastify' {
  interface FastifyInstance {
    meilisearch: Meilisearch;
  }
}

/**
 * Decorates the Fastify instance with a shared Meilisearch client (ADR-0006).
 * Meilisearch is a derived index, never the source of truth - a client
 * construction failure here is a startup-time config problem (bad host
 * URL), not a data problem, so unlike prisma/redis this plugin does not
 * ping the server at boot: index writes/reads fail individually and are
 * handled per-call (see modules/search/index-service.ts) so a Meilisearch
 * outage degrades search, never the rest of the platform.
 */
const meilisearchPlugin: FastifyPluginAsync = async (fastify) => {
  const env = loadEnv();
  const client = new Meilisearch({
    host: env.MEILISEARCH_HOST,
    apiKey: env.MEILISEARCH_API_KEY,
  });
  fastify.decorate('meilisearch', client);
};

export default fp(meilisearchPlugin, { name: 'meilisearch' });
