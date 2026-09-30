import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { loadEnv } from '@fcp/config';
import {
  encryptMfaSecret,
  decryptMfaSecret,
  decryptUnversionedMfaCiphertext,
  classifyStoredMfaSecret,
  MfaSecretUnreadableError,
} from '../../src/modules/auth/mfa-secret-crypto.js';

const SEED = 'JBSWY3DPEHPK3PXP';

function tamperSegment(stored: string, index: number): string {
  const parts = stored.split(':');
  const seg = parts[index]!;
  parts[index] = (seg[0] === 'a' ? 'b' : 'a') + seg.slice(1);
  return parts.join(':');
}

function unversionedCiphertext(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

function expectUnreadable(fn: () => unknown, reason: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MfaSecretUnreadableError);
    expect((err as MfaSecretUnreadableError).reason).toBe(reason);
    expect(String((err as Error).message)).not.toContain(SEED);
    expect(String((err as Error).stack)).not.toContain(SEED);
    return;
  }
  throw new Error('expected MfaSecretUnreadableError');
}

describe('MFA secret encryption at rest (M31 + certification repair)', () => {
  it('writes the versioned v1 format and decrypts back to the exact seed', () => {
    const encrypted = encryptMfaSecret(SEED);
    expect(encrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(classifyStoredMfaSecret(encrypted)).toBe('v1');
    expect(decryptMfaSecret(encrypted)).toBe(SEED);
    expect(encrypted).not.toContain(SEED);
  });

  it('uses a fresh IV per encryption', () => {
    const a = encryptMfaSecret(SEED);
    const b = encryptMfaSecret(SEED);
    expect(a).not.toBe(b);
    expect(decryptMfaSecret(a)).toBe(SEED);
    expect(decryptMfaSecret(b)).toBe(SEED);
  });

  it('classifies every value an older database can contain, unambiguously', () => {
    expect(classifyStoredMfaSecret('IU2XEDI2GMSQMNZ6')).toBe('legacy-plaintext'); // pre-M31 otplib seed
    expect(classifyStoredMfaSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('legacy-plaintext');
    expect(classifyStoredMfaSecret(unversionedCiphertext(SEED, Buffer.alloc(32, 7)))).toBe('unversioned-ciphertext');
    expect(classifyStoredMfaSecret(encryptMfaSecret(SEED))).toBe('v1');
    for (const junk of ['', 'not-a-secret', 'one:two', 'v1:zz:yy:xx', 'jbswy3dpehpk3pxp', 'v2:' + 'a'.repeat(24) + ':' + 'b'.repeat(32) + ':cc']) {
      expect(classifyStoredMfaSecret(junk)).toBe('unrecognized');
    }
  });

  it('H: never falls back to plaintext - a legacy plaintext seed is refused by the reader', () => {
    expectUnreadable(() => decryptMfaSecret(SEED), 'legacy_plaintext_requires_backfill');
  });

  it('G: a tampered ciphertext, tag or IV fails as decrypt_failed (GCM authentication)', () => {
    const encrypted = encryptMfaSecret(SEED);
    for (const segment of [1, 2, 3]) {
      expectUnreadable(() => decryptMfaSecret(tamperSegment(encrypted, segment)), 'decrypt_failed');
    }
  });

  it('G: a truncated or malformed stored value fails as unrecognized_format', () => {
    const encrypted = encryptMfaSecret(SEED);
    expectUnreadable(() => decryptMfaSecret(encrypted.slice(0, 40)), 'unrecognized_format');
    expectUnreadable(() => decryptMfaSecret('one:two:three:four'), 'unrecognized_format');
    expectUnreadable(() => decryptMfaSecret(`v1:${encrypted}`), 'unrecognized_format');
  });

  it('I: a value encrypted under a different key fails safely', () => {
    const otherKey = randomBytes(32);
    const foreign = encryptMfaSecret(SEED, otherKey);
    expectUnreadable(() => decryptMfaSecret(foreign), 'decrypt_failed');
    expect(decryptMfaSecret(foreign, otherKey)).toBe(SEED);
  });

  it('F: a v1 value is never re-interpreted as legacy plaintext, so it cannot be double-encrypted', () => {
    const encrypted = encryptMfaSecret(SEED);
    expect(classifyStoredMfaSecret(encrypted)).not.toBe('legacy-plaintext');
    expect(classifyStoredMfaSecret(encrypted)).not.toBe('unversioned-ciphertext');
  });

  it('the unversioned pre-repair format is readable only by the backfill helper', () => {
    // The pre-repair code encrypted under the configured key, whatever it is.
    const key = Buffer.from(loadEnv().MFA_SECRET_ENCRYPTION_KEY, 'hex');
    const unversioned = unversionedCiphertext(SEED, key);
    expectUnreadable(() => decryptMfaSecret(unversioned), 'unrecognized_format');
    expect(decryptUnversionedMfaCiphertext(unversioned)).toBe(SEED);
  });
});
