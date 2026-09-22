import { Prisma } from '@fcp/db';
import { ConflictError } from '@fcp/shared';

/**
 * Runs a Prisma write and converts a unique-constraint violation (P2002)
 * into a clean ConflictError instead of letting it bubble up as an opaque
 * 500 (SECURITY.md §4 - consistent, safe error responses; also the
 * "Input/API failure testing" certification round). Every `.create()` on
 * a field with a `@unique`/`@@unique` constraint that doesn't already
 * pre-check for a conflict should go through this.
 */
export async function withUniqueConstraintCheck<T>(fn: () => Promise<T>, entityName: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : String(err.meta?.target ?? 'field');
      throw new ConflictError(`${entityName} with this ${target} already exists`);
    }
    throw err;
  }
}
