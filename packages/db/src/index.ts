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

// `export *` below already re-exports `Prisma` as both a value (the
// runtime namespace, needed for e.g. Prisma.PrismaClientKnownRequestError)
// and a type - an explicit `export type { Prisma }` here would shadow
// that and make it type-only again, breaking any runtime usage.
export * from '../generated/client/index.js';
export { PrismaClient } from '../generated/client/index.js';
