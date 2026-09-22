import { authenticator } from 'otplib';

/**
 * TOTP-based MFA for staff roles requiring it (AUTH-002,
 * MFA_REQUIRED_ROLES in @fcp/shared). Standard RFC 6238 TOTP - compatible
 * with any authenticator app (Google Authenticator, Authy, 1Password, etc).
 */
export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function verifyMfaToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function buildMfaOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, 'FashionCommercePlatform', secret);
}
