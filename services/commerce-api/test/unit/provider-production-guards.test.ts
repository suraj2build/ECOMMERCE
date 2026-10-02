import { describe, it, expect, afterEach } from 'vitest';
import { enterProductionEnv } from '../helpers/production-env.js';
import { resolveShippingProvider } from '../../src/modules/shipping/provider.js';
import { getMarketingProvider } from '../../src/modules/marketing/provider.js';
import { ConsoleOtpProvider } from '../../src/modules/auth/otp-provider.js';

/**
 * M31 Security Hardening (5I) - proves resolveShippingProvider and
 * getMarketingProvider both refuse to resolve a MOCK_* provider name in
 * production, mirroring the precedent getChannelProvider already
 * established (test/integration/channels.test.ts's own "never resolves
 * a MOCK_* provider in production" test). Neither SHIP-001 nor MKT-001
 * has a real provider selected yet, and both env vars default to
 * 'MOCK' - without this guard, a production deployment that never
 * explicitly overrides SHIPPING_PROVIDER/MARKETING_PROVIDER would
 * silently "ship"/"send" against a fake provider with no real dispatch
 * ever happening.
 */
describe('Provider production guards (M31)', () => {
  let restoreEnv: (() => void) | undefined;
  afterEach(() => {
    restoreEnv?.();
    restoreEnv = undefined;
  });

  function asProduction() {
    restoreEnv = enterProductionEnv();
  }

  it('never reports console-only OTP delivery as successful in production', async () => {
    asProduction();
    let logged = false;
    const provider = new ConsoleOtpProvider({ info: () => { logged = true; } });
    await expect(provider.send('9999999999', '123456')).rejects.toThrow('configure a real SMS provider');
    expect(logged).toBe(false);
  });

  describe('resolveShippingProvider', () => {
    it('refuses to resolve MOCK in production', () => {
      asProduction();
      expect(() => resolveShippingProvider('MOCK')).toThrow(/test double.*may never be used in production/);
    });

    it('refuses to resolve MOCK_SECONDARY in production', () => {
      asProduction();
      expect(() => resolveShippingProvider('MOCK_SECONDARY')).toThrow(/test double.*may never be used in production/);
    });

    it('still resolves MOCK outside production (existing test fixtures unaffected)', () => {
      expect(() => resolveShippingProvider('MOCK')).not.toThrow();
    });
  });

  describe('getMarketingProvider', () => {
    it('refuses to resolve MOCK in production', () => {
      asProduction();
      expect(() => getMarketingProvider('MOCK')).toThrow(/test double.*may never be used in production/);
    });

    it('refuses to resolve MOCK_UNRELIABLE in production', () => {
      asProduction();
      expect(() => getMarketingProvider('MOCK_UNRELIABLE')).toThrow(/test double.*may never be used in production/);
    });

    it('still resolves MOCK outside production (existing test fixtures unaffected)', () => {
      expect(() => getMarketingProvider('MOCK')).not.toThrow();
    });
  });
});
