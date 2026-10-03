import { randomBytes } from 'node:crypto';
import { __resetEnvCacheForTests } from '@fcp/config';

/**
 * Switches loadEnv() into production mode with secrets that pass the
 * production configuration guards (non-placeholder, high-entropy,
 * dedicated guest-session secret). Values are generated per test process
 * (never hard-coded, so nothing secret-shaped is committed) and never used
 * outside it. Returns a function restoring the previous env.
 */
export const PRODUCTION_TEST_SECRETS = {
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  MFA_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  GUEST_SESSION_SIGNING_SECRET: randomBytes(32).toString('hex'),
  // Production also requires an alert destination for failing jobs
  // (.invalid never resolves, so nothing is ever sent from a test).
  MAINTENANCE_ALERT_WEBHOOK_URL: 'https://alerts.invalid/maintenance',
} as const;

const KEYS = ['NODE_ENV', 'GUEST_SESSION_ALLOW_UNSIGNED', ...Object.keys(PRODUCTION_TEST_SECRETS)] as const;

export function enterProductionEnv(): () => void {
  const previous = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.NODE_ENV = 'production';
  delete process.env.GUEST_SESSION_ALLOW_UNSIGNED;
  Object.assign(process.env, PRODUCTION_TEST_SECRETS);
  __resetEnvCacheForTests();
  return () => {
    for (const k of KEYS) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    __resetEnvCacheForTests();
  };
}
