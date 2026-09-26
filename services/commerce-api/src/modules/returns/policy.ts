import type { PrismaClient } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { NotFoundError } from '@fcp/shared';

/**
 * Eligibility-window/non-returnable policy resolution (RET-001), shared
 * by ReturnService (M19) and ExchangeService (M21, EXC-003: "same window
 * as returns, configured together") - genuinely the SAME ReturnPolicy
 * table and the SAME style > category > platform-default resolution
 * order, not two independently-maintained copies.
 */
export async function resolveReturnPolicy(
  prisma: PrismaClient,
  skuId: string,
): Promise<{ windowDays: number; returnable: boolean; evidenceRequired: boolean }> {
  const sku = await prisma.sku.findUnique({
    where: { id: skuId },
    select: { styleId: true, style: { select: { categoryId: true } } },
  });
  if (!sku) throw new NotFoundError('Sku', skuId);

  const styleRow = await prisma.returnPolicy.findUnique({ where: { styleId: sku.styleId } });
  if (styleRow) return { windowDays: styleRow.windowDays, returnable: styleRow.returnable, evidenceRequired: styleRow.evidenceRequired };

  const categoryRow = await prisma.returnPolicy.findUnique({ where: { categoryId: sku.style.categoryId } });
  if (categoryRow) return { windowDays: categoryRow.windowDays, returnable: categoryRow.returnable, evidenceRequired: categoryRow.evidenceRequired };

  return { windowDays: loadEnv().RETURN_WINDOW_DEFAULT_DAYS, returnable: true, evidenceRequired: false };
}

/**
 * Day-granularity boundary check (see ReturnService's own docblock for
 * why Math.floor, not raw millisecond division): a window is understood
 * as N full inclusive days from the reference date, not N*86400000ms to
 * the millisecond.
 */
export function isWithinWindow(referenceDate: Date, windowDays: number): boolean {
  const daysSince = Math.floor((Date.now() - referenceDate.getTime()) / 86_400_000);
  return daysSince <= windowDays;
}
