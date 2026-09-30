import pino from 'pino';

/**
 * Structured logging baseline (M00 requirement). Every service creates its
 * own child logger via createLogger(serviceName) so log lines are
 * attributable, and never logs secrets (OTPs, passwords, tokens) - see
 * SECURITY.md §3 and specs/01-auth-rbac.md.
 */
export function createLogger(
  serviceName: string,
  level = process.env.LOG_LEVEL ?? 'info',
  destination?: pino.DestinationStream,
) {
  const options: pino.LoggerOptions = {
    name: serviceName,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.otp',
        '*.code',
        '*.token',
        '*.tokenHash',
        '*.mfaSecret',
        // M31 Security Hardening (5F) - gift-card redemption secrets
        // (M30) are the same class of "spendable-on-possession" value as
        // an OTP/password; nothing in this codebase logs a request body
        // today (verified by this pass's own grep sweep - see
        // security/PII_DATA_INVENTORY.md), but this list is defence in
        // depth for the day something does.
        '*.giftCardCode',
        '*.codeHash',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
