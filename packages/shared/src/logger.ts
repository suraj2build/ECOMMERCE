import pino from 'pino';

/**
 * Structured logging baseline (M00 requirement). Every service creates its
 * own child logger via createLogger(serviceName) so log lines are
 * attributable, and never logs secrets (OTPs, passwords, tokens) - see
 * SECURITY.md §3 and specs/01-auth-rbac.md.
 */
export function createLogger(serviceName: string, level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    name: serviceName,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        '*.password',
        '*.passwordHash',
        '*.otp',
        '*.code',
        '*.token',
        '*.tokenHash',
        '*.mfaSecret',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
