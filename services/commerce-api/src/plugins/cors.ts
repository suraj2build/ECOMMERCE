import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import { loadEnv } from '@fcp/config';

/**
 * Allows the storefront's own browser-originated requests (M11's PIN
 * check, review submission, and OTP request/verify - the first
 * genuinely client-side fetches this API serves; every earlier public
 * read was fetched server-side by Next.js, which isn't subject to CORS).
 * Only CORS_ORIGINS is ever allowed - never a wildcard, since customer
 * OTP/session endpoints are reachable here.
 */
const corsPlugin: FastifyPluginAsync = async (fastify) => {
  const env = loadEnv();
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await fastify.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
};

export default fp(corsPlugin, { name: 'cors' });
