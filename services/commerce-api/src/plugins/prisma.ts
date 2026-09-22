import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { getPrismaClient, type PrismaClient } from '@fcp/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the Fastify instance with a shared Prisma client and closes it
 * cleanly on server shutdown.
 */
const prismaPlugin: FastifyPluginAsync = async (fastify) => {
  const prisma = getPrismaClient();
  fastify.decorate('prisma', prisma);
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
