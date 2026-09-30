import { createHmac } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { UnauthorizedError, ValidationError } from '@fcp/shared';
import {
  resolveCartIdentity,
  mintGuestSessionToken,
  renewGuestSessionToken,
  verifyGuestSessionToken,
  GUEST_SESSION_HEADER,
} from '../../src/modules/cart/identity.js';
import { PRODUCTION_TEST_SECRETS } from '../helpers/production-env.js';

/**
 * CART-004 guest-session credential (M31 certification repair). Pure
 * functions of (token, now), so expiry is proven with an explicit clock
 * value - no sleeps, no wall-clock dependence. HTTP-level lifecycle
 * (renewal, cart continuity, concurrency) is proven in
 * test/integration/guest-session-lifecycle.test.ts.
 */
const T0 = 1_900_000_000; // fixed epoch seconds
const TTL = 2_592_000; // default GUEST_SESSION_TTL_SECONDS

function fakeRequest(opts: { customerId?: string; guestHeader?: string }): FastifyRequest {
  return {
    customer: opts.customerId ? { id: opts.customerId } : undefined,
    headers: opts.guestHeader === undefined ? {} : { [GUEST_SESSION_HEADER]: opts.guestHeader },
  } as unknown as FastifyRequest;
}

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetEnvCacheForTests();
}

const PROD_ENV = { NODE_ENV: 'production', ...PRODUCTION_TEST_SECRETS };

function part(token: string, index: number): string {
  return token.split('.')[index]!;
}
function withPart(token: string, index: number, value: string): string {
  const parts = token.split('.');
  parts[index] = value;
  return parts.join('.');
}

describe('Guest-session credential (CART-004)', () => {
  afterEach(() => {
    setEnv({
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-only-secret-test-only-secret',
      MFA_SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
      GUEST_SESSION_SIGNING_SECRET: undefined,
      GUEST_SESSION_ALLOW_UNSIGNED: undefined,
      GUEST_SESSION_TTL_SECONDS: undefined,
    });
  });

  describe('token structure and verification', () => {
    it('A: a freshly issued token verifies and carries a server-generated owner, issuedAt and expiry', () => {
      const { token, claims } = mintGuestSessionToken(T0);
      expect(token.split('.')).toHaveLength(5);
      expect(part(token, 0)).toBe('gs1');
      expect(claims).toEqual({ ownerId: part(token, 1), issuedAt: T0, expiresAt: T0 + TTL });
      expect(verifyGuestSessionToken(token, T0)).toEqual(claims);
    });

    it('two issued tokens never share an owner', () => {
      const a = mintGuestSessionToken(T0);
      const b = mintGuestSessionToken(T0);
      expect(a.claims.ownerId).not.toBe(b.claims.ownerId);
    });

    it('B: substituting another (victim) owner id breaks the signature', () => {
      const attacker = mintGuestSessionToken(T0).token;
      const victim = mintGuestSessionToken(T0).claims.ownerId;
      expect(verifyGuestSessionToken(withPart(attacker, 1, victim), T0)).toBeNull();
    });

    it('C: tampering with issuedAt breaks the signature', () => {
      const { token } = mintGuestSessionToken(T0);
      expect(verifyGuestSessionToken(withPart(token, 2, String(T0 + 10)), T0 + 20)).toBeNull();
    });

    it('D: extending the expiry breaks the signature', () => {
      const { token } = mintGuestSessionToken(T0);
      expect(verifyGuestSessionToken(withPart(token, 3, String(T0 + TTL + 86_400)), T0)).toBeNull();
    });

    it('E: changing the version breaks it (unknown version, and a re-labelled token)', () => {
      const { token } = mintGuestSessionToken(T0);
      expect(verifyGuestSessionToken(withPart(token, 0, 'gs2'), T0)).toBeNull();
      expect(verifyGuestSessionToken(withPart(token, 0, 'GS1'), T0)).toBeNull();
    });

    it('F: a flipped signature character, a truncated signature, and a signature from another key all fail', () => {
      const { token } = mintGuestSessionToken(T0);
      const mac = part(token, 4);
      const flipped = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
      expect(verifyGuestSessionToken(withPart(token, 4, flipped), T0)).toBeNull();
      expect(verifyGuestSessionToken(withPart(token, 4, mac.slice(0, 20)), T0)).toBeNull();
      const payload = token.split('.').slice(0, 4).join('.');
      const foreignMac = createHmac('sha256', 'some-other-key-entirely-0123456789').update(payload).digest('base64url');
      expect(verifyGuestSessionToken(withPart(token, 4, foreignMac), T0)).toBeNull();
    });

    it('G: expiry is enforced server-side from the authenticated expiresAt (deterministic clock)', () => {
      const { token } = mintGuestSessionToken(T0);
      expect(verifyGuestSessionToken(token, T0 + TTL - 1)).not.toBeNull();
      expect(verifyGuestSessionToken(token, T0 + TTL)).toBeNull();
      expect(verifyGuestSessionToken(token, T0 + TTL + 3600)).toBeNull();
    });

    it('a token claiming to be issued in the future (beyond clock skew) is rejected', () => {
      const { token } = mintGuestSessionToken(T0 + 3600);
      expect(verifyGuestSessionToken(token, T0)).toBeNull();
      expect(verifyGuestSessionToken(token, T0 + 3600 - 30)).not.toBeNull();
    });

    it('lowering GUEST_SESSION_TTL_SECONDS immediately invalidates longer-lived tokens already issued', () => {
      const { token } = mintGuestSessionToken(T0);
      setEnv({ GUEST_SESSION_TTL_SECONDS: '3600' });
      expect(verifyGuestSessionToken(token, T0 + 10)).toBeNull();
    });

    it('rejects malformed values without throwing', () => {
      for (const bad of ['', 'gs1', 'gs1....', 'gs1.not-a-uuid.1.2.x', `gs1.${'0'.repeat(36)}.a.b.c`, 'x'.repeat(300)]) {
        expect(verifyGuestSessionToken(bad, T0)).toBeNull();
      }
    });
  });

  describe('renewal', () => {
    it('H + I: renewal issues a NEW credential for the SAME owner with a fresh lifetime', () => {
      const original = mintGuestSessionToken(T0);
      const renewed = renewGuestSessionToken(original.token, T0 + 86_400)!;
      expect(renewed.token).not.toBe(original.token);
      expect(renewed.claims.ownerId).toBe(original.claims.ownerId);
      expect(renewed.claims).toEqual({ ownerId: original.claims.ownerId, issuedAt: T0 + 86_400, expiresAt: T0 + 86_400 + TTL });
      expect(verifyGuestSessionToken(renewed.token, T0 + TTL + 10)).not.toBeNull();
    });

    it('an expired or tampered token cannot be renewed', () => {
      const { token } = mintGuestSessionToken(T0);
      expect(renewGuestSessionToken(token, T0 + TTL)).toBeNull();
      const victim = mintGuestSessionToken(T0).claims.ownerId;
      expect(renewGuestSessionToken(withPart(token, 1, victim), T0)).toBeNull();
    });
  });

  describe('request identity resolution', () => {
    it('a logged-in customer always wins over any guest header', () => {
      expect(resolveCartIdentity(fakeRequest({ customerId: 'cust-1', guestHeader: 'anything' }))).toEqual({ customerId: 'cust-1' });
    });

    it('a request with neither identity is a 400', () => {
      expect(() => resolveCartIdentity(fakeRequest({}))).toThrow(ValidationError);
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: '   ' }))).toThrow(ValidationError);
    });

    it('a valid token resolves to its stable owner id', () => {
      const { token, claims } = mintGuestSessionToken();
      expect(resolveCartIdentity(fakeRequest({ guestHeader: token }))).toEqual({ guestSessionId: claims.ownerId });
    });

    it('a value claiming to be a gs1 token must verify even where unsigned dev ids are allowed', () => {
      const { token } = mintGuestSessionToken(T0 - TTL - 10); // legitimately signed, but expired
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: token }))).toThrow(UnauthorizedError);
    });

    it('P (dev/test): unsigned ids are accepted only while GUEST_SESSION_ALLOW_UNSIGNED is on', () => {
      expect(resolveCartIdentity(fakeRequest({ guestHeader: 'fixture-guest-1' }))).toEqual({ guestSessionId: 'fixture-guest-1' });
      setEnv({ GUEST_SESSION_ALLOW_UNSIGNED: 'false' });
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: 'fixture-guest-1' }))).toThrow(UnauthorizedError);
    });

    describe('O: production', () => {
      it('rejects a raw, client-chosen guest id (legacy unsigned) and the pre-lifecycle <uuid>.<hex> format', () => {
        setEnv(PROD_ENV);
        expect(() => resolveCartIdentity(fakeRequest({ guestHeader: 'guest-arbitrary-123' }))).toThrow(UnauthorizedError);
        const legacy = `${'1b4e28ba-2fa1-4d2b-883f-0016d3cca427'}.${'ab'.repeat(32)}`;
        expect(() => resolveCartIdentity(fakeRequest({ guestHeader: legacy }))).toThrow(UnauthorizedError);
      });

      it('accepts a token minted with the production signing secret', () => {
        setEnv(PROD_ENV);
        const { token, claims } = mintGuestSessionToken();
        expect(resolveCartIdentity(fakeRequest({ guestHeader: token }))).toEqual({ guestSessionId: claims.ownerId });
      });

      it('a token minted under the dev/test derived key is not valid under the production secret', () => {
        const devToken = mintGuestSessionToken().token;
        setEnv(PROD_ENV);
        expect(() => resolveCartIdentity(fakeRequest({ guestHeader: devToken }))).toThrow(UnauthorizedError);
      });
    });
  });
});
