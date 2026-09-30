import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '@fcp/config';

/**
 * AES-256-GCM encryption of `StaffUser.mfaSecret` (a TOTP seed) at rest.
 *
 * Stored format (current, the only format the authentication path reads):
 *   v1:<iv-hex 24>:<authTag-hex 32>:<ciphertext-hex>
 *
 * Other values that can exist in a database written by older code:
 *   - legacy plaintext: the raw otplib base32 seed pre-M31 code wrote
 *     directly (`[A-Z2-7]`, e.g. `IU2XEDI2GMSQMNZ6`);
 *   - unversioned ciphertext `<iv>:<tag>:<ct>`: written only by the
 *     pre-repair M31 commit (0dc2a82), never released.
 * Neither is accepted by `decryptMfaSecret`. Both are upgraded to v1 by
 * the explicit backfill (mfa-secret-backfill.ts), which must run before
 * the new code serves staff logins (see DEPLOYMENT.md). There is no
 * plaintext fallback anywhere in the authentication path.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const V1_PREFIX = 'v1:';

const V1_PATTERN = /^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
const UNVERSIONED_CIPHERTEXT_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
const LEGACY_PLAINTEXT_PATTERN = /^[A-Z2-7]{16,128}=*$/;

export type StoredMfaSecretFormat = 'v1' | 'unversioned-ciphertext' | 'legacy-plaintext' | 'unrecognized';

export type MfaSecretUnreadableReason = 'legacy_plaintext_requires_backfill' | 'decrypt_failed' | 'unrecognized_format';

/**
 * Raised when a stored MFA secret cannot be turned into a TOTP seed. The
 * message is fixed text and never contains any part of the stored value.
 */
export class MfaSecretUnreadableError extends Error {
  constructor(readonly reason: MfaSecretUnreadableReason) {
    super(`Stored MFA secret is unreadable (${reason})`);
    this.name = 'MfaSecretUnreadableError';
  }
}

export function classifyStoredMfaSecret(stored: string): StoredMfaSecretFormat {
  if (V1_PATTERN.test(stored)) return 'v1';
  if (UNVERSIONED_CIPHERTEXT_PATTERN.test(stored)) return 'unversioned-ciphertext';
  if (LEGACY_PLAINTEXT_PATTERN.test(stored)) return 'legacy-plaintext';
  return 'unrecognized';
}

function getKey(): Buffer {
  return Buffer.from(loadEnv().MFA_SECRET_ENCRYPTION_KEY, 'hex');
}

function decryptParts(ivHex: string, authTagHex: string, ciphertextHex: string, key: Buffer): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered/corrupted ciphertext - GCM authentication failed.
    throw new MfaSecretUnreadableError('decrypt_failed');
  }
}

export function encryptMfaSecret(plaintext: string, key: Buffer = getKey()): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${V1_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Decrypts a v1 value. Any other format - including legacy plaintext - throws MfaSecretUnreadableError. */
export function decryptMfaSecret(stored: string, key: Buffer = getKey()): string {
  const format = classifyStoredMfaSecret(stored);
  if (format === 'legacy-plaintext') throw new MfaSecretUnreadableError('legacy_plaintext_requires_backfill');
  if (format !== 'v1') throw new MfaSecretUnreadableError('unrecognized_format');
  const [, ivHex, authTagHex, ciphertextHex] = stored.split(':') as [string, string, string, string];
  return decryptParts(ivHex, authTagHex, ciphertextHex, key);
}

/** Backfill-only: decrypts the never-released unversioned M31 format so it can be re-wrapped as v1. */
export function decryptUnversionedMfaCiphertext(stored: string, key: Buffer = getKey()): string {
  if (classifyStoredMfaSecret(stored) !== 'unversioned-ciphertext') throw new MfaSecretUnreadableError('unrecognized_format');
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':') as [string, string, string];
  return decryptParts(ivHex, authTagHex, ciphertextHex, key);
}
