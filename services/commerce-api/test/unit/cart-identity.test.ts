import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { ValidationError } from '@fcp/shared';
import { resolveCartIdentity, mintGuestSessionToken, GUEST_SESSION_HEADER } from '../../src/modules/cart/identity.js';

/**
 * M31 CART-004 closure - adversarial ownership tests for the guest-session
 * identity resolver (services/commerce-api/src/modules/cart/identity.ts).
 * Unit-level (no DB/HTTP) since resolveCartIdentity is a pure function of
 * a request-shaped object; the full HTTP-level behaviour (oversized
 * header, guest isolation, login merge) is already covered by
 * test/integration/cart-wishlist.test.ts in dev/test mode. What's unique
 * to this file is proving the PRODUCTION-mode signature enforcement
 * actually rejects a forged/unsigned/tampered token, since no existing
 * integration test runs with NODE_ENV=production (doing so would require
 * an unrelated app-wide behaviour change across every other module).
 */
function fakeRequest(opts: { customerId?: string; guestHeader?: string | string[] }): FastifyRequest {
  return {
    customer: opts.customerId ? { id: opts.customerId } : undefined,
    headers: opts.guestHeader === undefined ? {} : { [GUEST_SESSION_HEADER]: opts.guestHeader },
  } as unknown as FastifyRequest;
}

describe('Cart guest-session identity (CART-004)', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    __resetEnvCacheForTests();
  });

  it('a logged-in customer always wins over any guest header, forged or not', () => {
    const identity = resolveCartIdentity(fakeRequest({ customerId: 'cust-1', guestHeader: 'anything-at-all' }));
    expect(identity).toEqual({ customerId: 'cust-1' });
  });

  it('rejects a request with neither a customer session nor a guest header', () => {
    expect(() => resolveCartIdentity(fakeRequest({}))).toThrow(ValidationError);
  });

  describe('outside production (dev/test)', () => {
    it('accepts any non-empty client-supplied guest id verbatim (existing fixture compatibility)', () => {
      const identity = resolveCartIdentity(fakeRequest({ guestHeader: 'guest-arbitrary-123' }));
      expect(identity).toEqual({ guestSessionId: 'guest-arbitrary-123' });
    });
  });

  describe('in production', () => {
    function asProduction() {
      process.env.NODE_ENV = 'production';
      __resetEnvCacheForTests();
    }

    it('accepts a genuine server-minted token and recovers the underlying id', () => {
      asProduction();
      const token = mintGuestSessionToken();
      const [expectedId] = token.split('.');
      const identity = resolveCartIdentity(fakeRequest({ guestHeader: token }));
      expect(identity).toEqual({ guestSessionId: expectedId });
    });

    it('rejects a raw client-chosen string with no signature at all', () => {
      asProduction();
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: 'guest-arbitrary-123' }))).toThrow(ValidationError);
    });

    it('rejects a token whose signature has been tampered with', () => {
      asProduction();
      const token = mintGuestSessionToken();
      const [id, signature] = token.split('.');
      const flippedChar = signature[0] === 'a' ? 'b' : 'a';
      const tampered = `${id}.${flippedChar}${signature.slice(1)}`;
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: tampered }))).toThrow(ValidationError);
    });

    it('rejects a well-formed-looking token minted with a different secret (never verifiable, only comparable against this server\'s own secret)', () => {
      asProduction();
      const legitimate = mintGuestSessionToken();
      const [legitimateId] = legitimate.split('.');
      // Simulates an attacker guessing/reusing another id and pairing it with an arbitrary hex string of the right length.
      const forgedSignature = 'a'.repeat(64);
      const forged = `${legitimateId}.${forgedSignature}`;
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: forged }))).toThrow(ValidationError);
    });

    it('rejects a token with the id and signature swapped', () => {
      asProduction();
      const token = mintGuestSessionToken();
      const [id, signature] = token.split('.');
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: `${signature}.${id}` }))).toThrow(ValidationError);
    });

    it('rejects a malformed token with no separator', () => {
      asProduction();
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: 'not-a-valid-token-at-all' }))).toThrow(ValidationError);
    });

    it('rejects an empty-string guest header identically to a missing one', () => {
      asProduction();
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: '' }))).toThrow(ValidationError);
    });

    it('two separately minted tokens never collide and never verify against each other\'s id', () => {
      asProduction();
      const tokenA = mintGuestSessionToken();
      const tokenB = mintGuestSessionToken();
      const [idA] = tokenA.split('.');
      const [, sigB] = tokenB.split('.');
      expect(idA).not.toEqual(tokenB.split('.')[0]);
      expect(() => resolveCartIdentity(fakeRequest({ guestHeader: `${idA}.${sigB}` }))).toThrow(ValidationError);
    });
  });
});
