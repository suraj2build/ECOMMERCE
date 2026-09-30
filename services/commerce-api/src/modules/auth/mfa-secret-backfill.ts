import type { PrismaClient } from '@fcp/db';
import {
  classifyStoredMfaSecret,
  decryptMfaSecret,
  decryptUnversionedMfaCiphertext,
  encryptMfaSecret,
  MfaSecretUnreadableError,
} from './mfa-secret-crypto.js';

/**
 * Explicit, idempotent upgrade of stored MFA secrets to the v1 encrypted
 * format (M31 certification repair). It lives in the application, not a
 * SQL migration, because only the application holds
 * MFA_SECRET_ENCRYPTION_KEY. Run it after `prisma migrate deploy` and
 * before the new code serves staff logins (DEPLOYMENT.md).
 *
 * Safety properties:
 *  - Every write is a compare-and-swap on the exact value that was read
 *    (`WHERE id = ? AND mfaSecret = <observed>`), so a concurrent
 *    backfill, re-enrollment or any other writer is never overwritten -
 *    the losing writer simply updates zero rows.
 *  - A value is only written after the new ciphertext is decrypted back
 *    and compared with the original seed.
 *  - Preflight, before any write: every existing encrypted value (v1,
 *    and the never-released unversioned format) must authenticate-decrypt
 *    with the configured key. If even one does not, the run aborts with
 *    zero writes and lists the affected staff user ids - it does not try
 *    to guess whether the key is wrong or the data is corrupt.
 *  - v1 rows are never re-encrypted (no double encryption).
 *  - The report contains counts and staff user ids only, never a secret.
 */

export type MfaBackfillRowOutcome =
  | 'already-v1'
  | 'encrypted-legacy-plaintext'
  | 'rewrapped-unversioned-ciphertext'
  | 'skipped-concurrently-changed'
  | 'skipped-unreadable';

export interface MfaBackfillReport {
  scanned: number;
  alreadyV1: number;
  encryptedLegacyPlaintext: number;
  rewrappedUnversionedCiphertext: number;
  skippedConcurrentlyChanged: number;
  /** Staff user ids whose stored value is in no recognised format (never ciphertext). Ids only. */
  unreadableStaffUserIds: string[];
}

/** The preflight found encrypted values that do not decrypt; nothing was written. Carries ids only. */
export class MfaBackfillPreflightError extends Error {
  constructor(readonly undecryptableStaffUserIds: string[]) {
    super(
      `MFA backfill aborted before any write: ${undecryptableStaffUserIds.length} existing encrypted MFA secret(s) ` +
        'cannot be decrypted with the configured MFA_SECRET_ENCRYPTION_KEY (wrong key or corrupted data - operator ' +
        `investigation required). No rows were modified. Staff user ids: ${undecryptableStaffUserIds.join(', ')}`,
    );
    this.name = 'MfaBackfillPreflightError';
  }
}

function decryptsWithConfiguredKey(value: string): boolean {
  try {
    if (classifyStoredMfaSecret(value) === 'v1') decryptMfaSecret(value);
    else decryptUnversionedMfaCiphertext(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upgrades one row whose current value was observed as `observed`.
 * Exported so the compare-and-swap behaviour can be tested against a
 * deterministic interleaving (a value that changed after it was read).
 */
export async function upgradeStoredMfaSecret(
  prisma: PrismaClient,
  staffUserId: string,
  observed: string,
): Promise<MfaBackfillRowOutcome> {
  const format = classifyStoredMfaSecret(observed);
  if (format === 'v1') return 'already-v1';
  if (format === 'unrecognized') return 'skipped-unreadable';

  let seed: string;
  try {
    seed = format === 'legacy-plaintext' ? observed : decryptUnversionedMfaCiphertext(observed);
  } catch (err) {
    if (err instanceof MfaSecretUnreadableError) return 'skipped-unreadable';
    throw err;
  }

  const upgraded = encryptMfaSecret(seed);
  if (decryptMfaSecret(upgraded) !== seed) {
    throw new Error('MFA backfill round-trip verification failed; no row was modified');
  }

  const { count } = await prisma.staffUser.updateMany({
    where: { id: staffUserId, mfaSecret: observed },
    data: { mfaSecret: upgraded },
  });
  if (count === 0) return 'skipped-concurrently-changed';
  return format === 'legacy-plaintext' ? 'encrypted-legacy-plaintext' : 'rewrapped-unversioned-ciphertext';
}

export async function backfillLegacyMfaSecrets(prisma: PrismaClient): Promise<MfaBackfillReport> {
  const rows = await prisma.staffUser.findMany({
    where: { mfaSecret: { not: null } },
    select: { id: true, mfaSecret: true },
    orderBy: { id: 'asc' },
  });

  const undecryptable = rows
    .filter((r) => {
      const format = classifyStoredMfaSecret(r.mfaSecret!);
      return (format === 'v1' || format === 'unversioned-ciphertext') && !decryptsWithConfiguredKey(r.mfaSecret!);
    })
    .map((r) => r.id);
  if (undecryptable.length > 0) throw new MfaBackfillPreflightError(undecryptable);

  const report: MfaBackfillReport = {
    scanned: rows.length,
    alreadyV1: 0,
    encryptedLegacyPlaintext: 0,
    rewrappedUnversionedCiphertext: 0,
    skippedConcurrentlyChanged: 0,
    unreadableStaffUserIds: [],
  };

  for (const row of rows) {
    const outcome = await upgradeStoredMfaSecret(prisma, row.id, row.mfaSecret!);
    switch (outcome) {
      case 'already-v1':
        report.alreadyV1 += 1;
        break;
      case 'encrypted-legacy-plaintext':
        report.encryptedLegacyPlaintext += 1;
        break;
      case 'rewrapped-unversioned-ciphertext':
        report.rewrappedUnversionedCiphertext += 1;
        break;
      case 'skipped-concurrently-changed':
        report.skippedConcurrentlyChanged += 1;
        break;
      case 'skipped-unreadable':
        report.unreadableStaffUserIds.push(row.id);
        break;
    }
  }
  return report;
}

/** Count of stored MFA secrets not yet in v1 format. Never returns values. */
export async function countNonV1MfaSecrets(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.staffUser.findMany({ where: { mfaSecret: { not: null } }, select: { mfaSecret: true } });
  return rows.filter((r) => classifyStoredMfaSecret(r.mfaSecret!) !== 'v1').length;
}

/** Production startup refused: the MFA backfill has not run, or its completion could not be verified. */
export class MfaStartupBlockedError extends Error {
  constructor(
    message: string,
    readonly pendingMfaUpgrades: number | null,
  ) {
    super(message);
    this.name = 'MfaStartupBlockedError';
  }
}

interface StartupLogger {
  warn(obj: object, msg: string): void;
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code;
  return err instanceof Error ? err.name : 'unknown';
}

/**
 * Startup gate for the MFA upgrade (DEPLOYMENT.md). The login path reads
 * v1 only, so serving with non-v1 rows would lock those staff out.
 *  - production: any pending row, or any failure to perform the count,
 *    throws MfaStartupBlockedError - the caller must not listen. The
 *    backfill is never run from here; the explicit deployment step stays
 *    authoritative.
 *  - development/test: warn and continue, so a partially migrated local
 *    database stays usable; a failed count is warned about, never read
 *    as zero.
 * Logs and errors carry the count and an error code only - never values.
 */
export async function assertMfaStartupSafety(prisma: PrismaClient, log: StartupLogger, production: boolean): Promise<void> {
  let pending: number;
  try {
    pending = await countNonV1MfaSecrets(prisma);
  } catch (err) {
    if (production) {
      throw new MfaStartupBlockedError(
        `MFA migration safety check could not be performed (${errorCode(err)}); refusing to start in production`,
        null,
      );
    }
    log.warn({ reason: errorCode(err) }, 'MFA migration safety check could not be performed');
    return;
  }
  if (pending === 0) return;
  if (production) {
    throw new MfaStartupBlockedError(
      `${pending} stored MFA secret(s) are not in v1 encrypted format - run the MFA backfill (DEPLOYMENT.md) before starting; refusing to start in production`,
      pending,
    );
  }
  log.warn(
    { pendingMfaUpgrades: pending },
    'Stored MFA secrets not yet in v1 encrypted format - run the MFA backfill (npm run mfa:backfill) before serving staff logins',
  );
}
