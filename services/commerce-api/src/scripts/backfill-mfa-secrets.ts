import { loadEnv } from '@fcp/config';
import { getPrismaClient, type PrismaClient } from '@fcp/db';
import {
  backfillLegacyMfaSecrets,
  MfaBackfillPreflightError,
  type MfaBackfillReport,
} from '../modules/auth/mfa-secret-backfill.js';

/**
 * One-off deployment step (DEPLOYMENT.md "MFA secret backfill"):
 *   npm run mfa:backfill --workspace=services/commerce-api      (source)
 *   node services/commerce-api/dist/scripts/backfill-mfa-secrets.js (built)
 * Requires DATABASE_URL and the production MFA_SECRET_ENCRYPTION_KEY.
 * Safe to re-run. Exit codes: 0 done; 1 aborted with zero writes (preflight
 * found encrypted values that do not decrypt, or any other failure);
 * 2 done but some values were in no recognised format. Output is counts and
 * staff user ids only.
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
  } catch (err) {
    if (err instanceof MfaBackfillPreflightError) {
      write(
        `[mfa-backfill] ${JSON.stringify({
          aborted: 'preflight',
          rowsModified: 0,
          undecryptableCount: err.undecryptableStaffUserIds.length,
          undecryptableStaffUserIds: err.undecryptableStaffUserIds,
        })}`,
      );
    }
    throw err;
  } finally {
    if (!options.prisma) await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  runMfaBackfillCli()
    .then((report) => {
      process.exit(report.unreadableStaffUserIds.length > 0 ? 2 : 0);
    })
    .catch((err: unknown) => {
      console.error(`[mfa-backfill] failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exit(1);
    });
}
