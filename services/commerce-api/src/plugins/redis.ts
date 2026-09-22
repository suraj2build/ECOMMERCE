import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { loadEnv } from '@fcp/config';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/**
 * Decorates the Fastify instance with a shared Redis client, used for
 * staff session storage (AUTH-003 - server-side, instantly-revocable) and
 * future caching/queueing (ADR-0005).
 */
const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const env = loadEnv();
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
  await redis.connect();
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => {
    redis.disconnect();
  });
};

export default fp(redisPlugin, { name: 'redis' });
