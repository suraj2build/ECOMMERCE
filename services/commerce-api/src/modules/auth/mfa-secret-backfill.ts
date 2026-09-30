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
 *  - Before any write, existing v1 rows are used to check that the
 *    configured key is the key those rows were written with; if v1 rows
 *    exist and none decrypt, nothing is written.
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
  /** Staff user ids whose stored value could not be read (corrupt, wrong key, unknown format). Ids only. */
  unreadableStaffUserIds: string[];
  /** v1 rows present but undecryptable with the configured key. */
  corruptV1StaffUserIds: string[];
}

export class MfaBackfillKeyMismatchError extends Error {
  constructor() {
    super(
      'MFA backfill aborted: existing v1-encrypted MFA secrets cannot be decrypted with the configured MFA_SECRET_ENCRYPTION_KEY. ' +
        'Refusing to encrypt legacy secrets with a key the running service may not hold. No rows were modified.',
    );
    this.name = 'MfaBackfillKeyMismatchError';
  }
}

function tryDecryptV1(value: string): boolean {
  try {
    decryptMfaSecret(value);
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

  const v1Rows = rows.filter((r) => classifyStoredMfaSecret(r.mfaSecret!) === 'v1');
  const corruptV1StaffUserIds = v1Rows.filter((r) => !tryDecryptV1(r.mfaSecret!)).map((r) => r.id);
  if (v1Rows.length > 0 && corruptV1StaffUserIds.length === v1Rows.length) {
    throw new MfaBackfillKeyMismatchError();
  }

  const report: MfaBackfillReport = {
    scanned: rows.length,
    alreadyV1: 0,
    encryptedLegacyPlaintext: 0,
    rewrappedUnversionedCiphertext: 0,
    skippedConcurrentlyChanged: 0,
    unreadableStaffUserIds: [],
    corruptV1StaffUserIds,
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

/** Count of stored MFA secrets not yet in v1 format - used for a startup warning. Never returns values. */
export async function countNonV1MfaSecrets(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.staffUser.findMany({ where: { mfaSecret: { not: null } }, select: { mfaSecret: true } });
  return rows.filter((r) => classifyStoredMfaSecret(r.mfaSecret!) !== 'v1').length;
}
