import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '@fcp/config';

/**
 * M31 Security Hardening (5F/5I) - AES-256-GCM encryption for
 * `StaffUser.mfaSecret` at rest. The schema's own column comment had
 * long claimed this secret was "encrypted at rest by application layer"
 * - a genuine gap this pass found: no encryption was ever actually
 * implemented anywhere in this codebase, the TOTP seed was written to
 * Postgres as plain text. A leaked database dump would have let an
 * attacker generate valid MFA codes for every enrolled staff account
 * indefinitely, defeating the entire point of requiring MFA for
 * `MFA_REQUIRED_ROLES`.
 *
 * Ciphertext is stored as `<iv-hex>:<authTag-hex>:<ciphertext-hex>` in
 * the SAME `mfaSecret` column (no schema/migration change - it was
 * already a plain String). GCM's authentication tag means a tampered
 * ciphertext fails to decrypt rather than silently producing garbage
 * that would then just fail TOTP verification anyway - defence in depth,
 * not load-bearing on its own.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV, the GCM-recommended size

function getKey(): Buffer {
  return Buffer.from(loadEnv().MFA_SECRET_ENCRYPTION_KEY, 'hex');
}

export function encryptMfaSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptMfaSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted MFA secret - expected <iv>:<authTag>:<ciphertext>');
  }
  const ivHex = parts[0]!;
  const authTagHex = parts[1]!;
  const ciphertextHex = parts[2]!;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
