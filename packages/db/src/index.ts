import { PrismaClient } from '../generated/client/index.js';

let prisma: PrismaClient | undefined;

/**
 * Singleton Prisma client. Avoids exhausting Postgres connections when
 * hot-reloaded in dev, and gives tests/services one shared entry point.
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.DB_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return prisma;
}

export * from '../generated/client/index.js';
export { PrismaClient } from '../generated/client/index.js';
export type { Prisma } from '../generated/client/index.js';
