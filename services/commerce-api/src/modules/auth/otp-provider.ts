import { randomInt } from 'node:crypto';
import { loadEnv } from '@fcp/config';

/** Minimal logger shape (satisfied by both @fcp/shared's pino Logger and Fastify's request-bound logger). */
export interface MinimalLogger {
  info(obj: unknown, msg?: string): void;
}

/**
 * OTP delivery is deferred operational configuration (AUTH-001, IND-001 in
 * blueprint/DECISION_REGISTER.md) - the actual SMS provider is not decided.
 * This interface lets a real provider (e.g. an SMS gateway) be swapped in
 * later without touching the auth service's business logic.
 */
export interface OtpProvider {
  send(mobile: string, code: string): Promise<void>;
}

/**
 * Development/test default: logs the OTP rather than sending a real SMS.
 * Never used as-is in production - a real provider must be configured via
 * dependency injection before go-live (see specs/13-payment.md pattern for
 * the analogous provider-abstraction discipline).
 */
export class ConsoleOtpProvider implements OtpProvider {
  constructor(private readonly logger: MinimalLogger) {}

  async send(mobile: string, code: string): Promise<void> {
    // Deliberately NOT logging the code itself in production-shaped logs
    // (logger redaction also covers this) - only a delivery confirmation.
    this.logger.info({ mobile: maskMobile(mobile) }, 'OTP dispatched (console provider)');
    if (loadEnv().NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.info(`[dev-only] OTP for ${maskMobile(mobile)}: ${code}`);
    }
  }
}

function maskMobile(mobile: string): string {
  return mobile.length > 4 ? `${'*'.repeat(mobile.length - 4)}${mobile.slice(-4)}` : mobile;
}

export function generateOtpCode(length: number): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(randomInt(min, max + 1));
}
