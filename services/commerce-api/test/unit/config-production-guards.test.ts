import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { loadEnv, __resetEnvCacheForTests } from '@fcp/config';
import { PRODUCTION_TEST_SECRETS } from '../helpers/production-env.js';

/**
 * M31 certification repair - production must never boot with a
 * placeholder/default secret, a missing or shared guest-session signing
 * secret, the dev/test unsigned-guest mode, or the E2E rate-limit
 * override. Each case is proven against loadEnv() itself with an
 * explicit env object, so the process env is never mutated.
 */
const BASE = {
  DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
  REDIS_URL: 'redis://localhost:6379',
};
const PROD = { ...BASE, NODE_ENV: 'production', ...PRODUCTION_TEST_SECRETS };

function parse(env: Record<string, string | undefined>) {
  __resetEnvCacheForTests();
  return loadEnv(env as NodeJS.ProcessEnv);
}

describe('Production configuration guards', () => {
  afterEach(() => __resetEnvCacheForTests());

  it('accepts a production configuration with real-shaped secrets, and defaults unsigned guests OFF', () => {
    const env = parse(PROD);
    expect(env.GUEST_SESSION_ALLOW_UNSIGNED).toBe(false);
    expect(env.GUEST_SESSION_TTL_SECONDS).toBe(2_592_000);
  });

  it('requires a dedicated guest-session signing secret', () => {
    expect(() => parse({ ...PROD, GUEST_SESSION_SIGNING_SECRET: undefined })).toThrow(/GUEST_SESSION_SIGNING_SECRET: is required in production/);
  });

  it('refuses a guest-session secret equal to JWT_ACCESS_SECRET', () => {
    expect(() => parse({ ...PROD, GUEST_SESSION_SIGNING_SECRET: PROD.JWT_ACCESS_SECRET })).toThrow(/must differ from JWT_ACCESS_SECRET/);
  });

  it('refuses placeholder secrets (the .env.example and CI values)', () => {
    expect(() => parse({ ...PROD, JWT_ACCESS_SECRET: 'dev-only-change-me-dev-only-change-me' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parse({ ...PROD, JWT_ACCESS_SECRET: 'ci-only-secret-ci-only-secret-not-for-prod' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parse({ ...PROD, GUEST_SESSION_SIGNING_SECRET: 'dev-only-guest-session-secret-change-me' })).toThrow(/GUEST_SESSION_SIGNING_SECRET/);
  });

  it('refuses the repeated-pattern MFA key placeholders', () => {
    expect(() => parse({ ...PROD, MFA_SECRET_ENCRYPTION_KEY: 'c1'.repeat(32) })).toThrow(/MFA_SECRET_ENCRYPTION_KEY/);
    expect(() => parse({ ...PROD, MFA_SECRET_ENCRYPTION_KEY: 'a'.repeat(64) })).toThrow(/MFA_SECRET_ENCRYPTION_KEY/);
  });

  it('P: the dev/test unsigned-guest mode can never be switched on in production', () => {
    expect(() => parse({ ...PROD, GUEST_SESSION_ALLOW_UNSIGNED: 'true' })).toThrow(/unsigned guest identities can never be enabled in production/);
  });

  it('refuses the E2E rate-limit override in production', () => {
    expect(() => parse({ ...PROD, AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX: '1000' })).toThrow(/AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX/);
  });

  it('outside production the documented placeholders still work and unsigned guests default ON', () => {
    const env = parse({ ...BASE, NODE_ENV: 'test', JWT_ACCESS_SECRET: 'ci-only-secret-ci-only-secret-not-for-prod', MFA_SECRET_ENCRYPTION_KEY: 'c1'.repeat(32) });
    expect(env.GUEST_SESSION_ALLOW_UNSIGNED).toBe(true);
    expect(env.GUEST_SESSION_SIGNING_SECRET).toBeUndefined();
  });

  it('requires the storefront revalidation secret whenever its URL is set, in any environment', () => {
    const test = { ...BASE, NODE_ENV: 'test', JWT_ACCESS_SECRET: 'ci-only-secret-ci-only-secret-not-for-prod', MFA_SECRET_ENCRYPTION_KEY: 'c1'.repeat(32) };
    const url = 'http://storefront:3000/api/revalidate/product';
    expect(() => parse({ ...test, STOREFRONT_REVALIDATE_URL: url })).toThrow(/STOREFRONT_REVALIDATE_SECRET: is required when STOREFRONT_REVALIDATE_URL is set/);
    expect(() => parse({ ...test, STOREFRONT_REVALIDATE_URL: url, STOREFRONT_REVALIDATE_SECRET: 'short' })).toThrow(/at least 32 characters/);
    expect(() => parse({ ...test, STOREFRONT_REVALIDATE_URL: 'not a url', STOREFRONT_REVALIDATE_SECRET: 'x'.repeat(40) })).toThrow(/STOREFRONT_REVALIDATE_URL/);
    expect(parse({ ...test }).STOREFRONT_REVALIDATE_URL).toBeUndefined();
  });

  it('refuses a placeholder storefront revalidation secret in production', () => {
    const url = 'http://storefront:3000/api/revalidate/product';
    expect(() => parse({ ...PROD, STOREFRONT_REVALIDATE_URL: url, STOREFRONT_REVALIDATE_SECRET: 'ci-only-storefront-revalidate-secret-0001' })).toThrow(/STOREFRONT_REVALIDATE_SECRET: must be a real secret in production/);
    expect(parse({ ...PROD, STOREFRONT_REVALIDATE_URL: url, STOREFRONT_REVALIDATE_SECRET: randomBytes(24).toString('hex') }).STOREFRONT_REVALIDATE_URL).toBe(url);
  });
});
