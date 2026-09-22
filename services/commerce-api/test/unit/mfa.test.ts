import { describe, it, expect } from 'vitest';
import { authenticator } from 'otplib';
import { generateMfaSecret, verifyMfaToken } from '../../src/modules/auth/mfa.js';

describe('TOTP MFA', () => {
  it('verifies a token generated from the enrolled secret', () => {
    const secret = generateMfaSecret();
    const token = authenticator.generate(secret);
    expect(verifyMfaToken(token, secret)).toBe(true);
  });

  it('rejects a token generated from a different secret', () => {
    const secret = generateMfaSecret();
    const otherSecret = generateMfaSecret();
    const token = authenticator.generate(otherSecret);
    expect(verifyMfaToken(token, secret)).toBe(false);
  });

  it('rejects a malformed token without throwing', () => {
    const secret = generateMfaSecret();
    expect(verifyMfaToken('not-a-valid-token', secret)).toBe(false);
  });
});
