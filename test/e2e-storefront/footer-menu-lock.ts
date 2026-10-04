import type { PrismaClient } from '@fcp/db';

// Arbitrary constant shared by every spec that rewrites the storefront
// footer menus (footer-about / footer-social).
const FOOTER_MENU_LOCK_KEY = 7_204_301;

/**
 * Serializes the specs that rewrite the storefront footer menus
 * (test/e2e-storefront/cms-pages.spec.ts and the admin AO-05 menu test).
 * Both set the same menus and read them back on the storefront, so they
 * must not interleave; every other test keeps running in parallel.
 *
 * Holds a Postgres transaction-scoped advisory lock inside an open
 * transaction until the returned release function is called. Nothing
 * else runs in that transaction.
 */
export async function acquireFooterMenuLock(prisma: PrismaClient): Promise<() => Promise<void>> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => (acquired = resolve));
  const held = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOOTER_MENU_LOCK_KEY})`;
      acquired();
      await released;
    },
    { maxWait: 10_000, timeout: 300_000 },
  );
  // Surface a failure to take the lock instead of waiting forever.
  await Promise.race([ready, held]);
  return async () => {
    release();
    await held;
  };
}
