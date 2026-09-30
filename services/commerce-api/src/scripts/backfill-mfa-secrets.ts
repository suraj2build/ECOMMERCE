import { loadEnv } from '@fcp/config';
import { getPrismaClient, type PrismaClient } from '@fcp/db';
import { backfillLegacyMfaSecrets, type MfaBackfillReport } from '../modules/auth/mfa-secret-backfill.js';

/**
 * One-off deployment step (DEPLOYMENT.md "MFA secret backfill"):
 *   npm run mfa:backfill --workspace=services/commerce-api      (source)
 *   node services/commerce-api/dist/scripts/backfill-mfa-secrets.js (built)
 * Requires DATABASE_URL and the production MFA_SECRET_ENCRYPTION_KEY.
 * Safe to re-run; exits non-zero if any stored value could not be read.
 */
export async function runMfaBackfillCli(
  options: { prisma?: PrismaClient; write?: (line: string) => void } = {},
): Promise<MfaBackfillReport> {
  loadEnv();
  const write = options.write ?? ((line: string) => console.warn(line));
  const prisma = options.prisma ?? getPrismaClient();
  try {
    const report = await backfillLegacyMfaSecrets(prisma);
    write(`[mfa-backfill] ${JSON.stringify(report)}`);
    return report;
  } finally {
    if (!options.prisma) await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  runMfaBackfillCli()
    .then((report) => {
      const unreadable = report.unreadableStaffUserIds.length + report.corruptV1StaffUserIds.length;
      process.exit(unreadable > 0 ? 2 : 0);
    })
    .catch((err: unknown) => {
      console.error(`[mfa-backfill] failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exit(1);
    });
}
