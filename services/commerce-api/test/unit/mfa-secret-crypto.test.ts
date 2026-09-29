import { describe, it, expect } from 'vitest';
import { encryptMfaSecret, decryptMfaSecret } from '../../src/modules/auth/mfa-secret-crypto.js';

describe('MFA secret encryption at rest (M31)', () => {
  it('decrypts back to the exact original plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptMfaSecret(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it('never stores the plaintext secret inside the ciphertext string', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
  });

  it('produces a different ciphertext each time for the same plaintext (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = encryptMfaSecret(secret);
    const b = encryptMfaSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptMfaSecret(a)).toBe(secret);
    expect(decryptMfaSecret(b)).toBe(secret);
  });

  it('rejects a tampered ciphertext rather than silently returning garbage (GCM auth tag)', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tamperedByte = ciphertext![0] === 'a' ? 'b' : 'a';
    const tampered = `${iv}:${authTag}:${tamperedByte}${ciphertext!.slice(1)}`;
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });

  it('rejects a malformed stored value with the wrong number of segments', () => {
    expect(() => decryptMfaSecret('not-a-valid-encrypted-value')).toThrow();
    expect(() => decryptMfaSecret('one:two')).toThrow();
    expect(() => decryptMfaSecret('one:two:three:four')).toThrow();
  });
});
