import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEnv, mockProvidersAllowed, __resetEnvCacheForTests } from '@fcp/config';
import { enterProductionEnv, PRODUCTION_TEST_SECRETS } from '../helpers/production-env.js';
import { resolveShippingProvider } from '../../src/modules/shipping/provider.js';
import { getMarketingProvider } from '../../src/modules/marketing/provider.js';
import { getChannelProvider } from '../../src/modules/channels/provider.js';
import { ConsoleOtpProvider } from '../../src/modules/auth/otp-provider.js';
import { resolveEvidenceStorageProvider } from '../../src/modules/returns/evidence-storage.js';

/**
 * LR-010: a hosted preview runs as production with DEPLOYMENT_STAGE=preview.
 * It may use the test-double providers while SMS and carrier vendors are
 * undecided (LR-008), but never live Razorpay keys or Meta server events
 * outside the test-events tool. The production stage still refuses every
 * mock (provider-production-guards.test.ts).
 */
const PROD = {
  DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
  REDIS_URL: 'redis://localhost:6379',
  NODE_ENV: 'production',
  ...PRODUCTION_TEST_SECRETS,
};
const PREVIEW = { ...PROD, DEPLOYMENT_STAGE: 'preview' };

function parse(env: Record<string, string | undefined>) {
  __resetEnvCacheForTests();
  return loadEnv(env as NodeJS.ProcessEnv);
}

describe('Preview deployment stage (LR-010)', () => {
  let restoreEnv: (() => void) | undefined;
  afterEach(() => {
    restoreEnv?.();
    restoreEnv = undefined;
    delete process.env.DEPLOYMENT_STAGE;
    __resetEnvCacheForTests();
    vi.restoreAllMocks();
  });

  function asStage(stage: 'production' | 'preview') {
    restoreEnv = enterProductionEnv();
    process.env.DEPLOYMENT_STAGE = stage;
    __resetEnvCacheForTests();
  }

  it('defaults to the production stage, which allows no mock provider', () => {
    const env = parse(PROD);
    expect(env.DEPLOYMENT_STAGE).toBe('production');
    expect(mockProvidersAllowed(env)).toBe(false);
    expect(mockProvidersAllowed(parse(PREVIEW))).toBe(true);
    expect(mockProvidersAllowed({ NODE_ENV: 'test', DEPLOYMENT_STAGE: 'production' })).toBe(true);
  });

  it('keeps every production secret guard on a preview', () => {
    expect(() => parse({ ...PREVIEW, GUEST_SESSION_SIGNING_SECRET: undefined })).toThrow(/GUEST_SESSION_SIGNING_SECRET: is required in production/);
    expect(() => parse({ ...PREVIEW, GUEST_SESSION_ALLOW_UNSIGNED: 'true' })).toThrow(/GUEST_SESSION_ALLOW_UNSIGNED/);
    expect(parse(PREVIEW).GUEST_SESSION_ALLOW_UNSIGNED).toBe(false);
  });

  it('takes Razorpay test-mode keys only', () => {
    expect(parse({ ...PREVIEW, RAZORPAY_KEY_ID: 'rzp_test_previewonly1' }).RAZORPAY_KEY_ID).toBe('rzp_test_previewonly1');
    expect(() => parse({ ...PREVIEW, RAZORPAY_KEY_ID: 'rzp_live_previewonly1' })).toThrow(/RAZORPAY_KEY_ID: a preview takes only Razorpay test-mode keys/);
    // The production stage is not restricted to test keys.
    expect(parse({ ...PROD, RAZORPAY_KEY_ID: 'rzp_live_previewonly1' }).RAZORPAY_KEY_ID).toBe('rzp_live_previewonly1');
  });

  it('sends Meta server events only to the test-events tool', () => {
    const meta = { META_PIXEL_ID: '1234567890', META_CAPI_ACCESS_TOKEN: randomBytes(24).toString('hex'), STOREFRONT_PUBLIC_URL: 'https://preview.example.com' };
    expect(() => parse({ ...PREVIEW, ...meta })).toThrow(/META_TEST_EVENT_CODE: is required on a preview/);
    expect(parse({ ...PREVIEW, ...meta, META_TEST_EVENT_CODE: 'TEST12345' }).META_TEST_EVENT_CODE).toBe('TEST12345');
  });

  it('resolves the mock carrier, messaging and channel providers on a preview, never on production', () => {
    asStage('preview');
    expect(() => resolveShippingProvider('MOCK')).not.toThrow();
    expect(() => getMarketingProvider('MOCK')).not.toThrow();
    expect(() => getChannelProvider('MOCK')).not.toThrow();
    expect(() => resolveEvidenceStorageProvider()).not.toThrow();

    asStage('production');
    expect(() => resolveShippingProvider('MOCK')).toThrow(/may never be used in production/);
    expect(() => getMarketingProvider('MOCK')).toThrow(/may never be used in production/);
    expect(() => getChannelProvider('MOCK')).toThrow(/may never be used in production/);
    expect(() => resolveEvidenceStorageProvider()).toThrow(/production refuses/);
  });

  it('prints a preview sign-in code for testers, and refuses on production', async () => {
    asStage('preview');
    const printed: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((line: string) => void printed.push(line));
    await new ConsoleOtpProvider({ info: () => {} }).send('9876543210', '482913');
    expect(printed.join('\n')).toContain('482913');

    asStage('production');
    await expect(new ConsoleOtpProvider({ info: () => {} }).send('9876543210', '482913')).rejects.toThrow(/configure a real SMS provider/);
  });
});
