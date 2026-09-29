import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';

export const GUEST_SESSION_HEADER = 'x-guest-session-id';

export interface CartOwnerIdentity {
  customerId?: string;
  guestSessionId?: string;
}

const MAX_GUEST_SESSION_ID_LENGTH = 256;

/**
 * M31 CART-004 closure: mints a fresh, server-issued guest-session
 * token - `<uuid-v4>.<hmac-hex>`, the HMAC computed over the uuid with
 * `JWT_ACCESS_SECRET` (the same HMAC-then-compare idiom this codebase
 * already uses for Razorpay/carrier webhook signatures, reused here
 * rather than inventing a second signing convention or a new secret
 * env var). Stateless by design - no DB row, no expiry job - the token
 * IS its own proof of server issuance; verifyGuestSessionToken below is
 * the only thing that can accept one as valid.
 */
export function mintGuestSessionToken(): string {
  const id = randomUUID();
  const env = loadEnv();
  const signature = createHmac('sha256', env.JWT_ACCESS_SECRET).update(id).digest('hex');
  return `${id}.${signature}`;
}

/**
 * Verifies a presented token was genuinely minted by this server (never
 * merely well-formatted) - constant-time comparison, the same
 * `timingSafeEqual` discipline every other HMAC verification in this
 * codebase uses. Returns the underlying id on success, null otherwise -
 * never throws, since an invalid/forged token is not itself special
 * (see resolveCartIdentity's own production-mode handling below).
 */
function verifyGuestSessionToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [id, signature] = parts;
  if (!id || !signature) return null;
  const env = loadEnv();
  const expected = createHmac('sha256', env.JWT_ACCESS_SECRET).update(id).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== signatureBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null;
  return id;
}

/**
 * Resolves who a cart/wishlist/checkout request belongs to (CART-001).
 * A logged-in customer's bearer token (already verified by the route's
 * tryCustomerAuth preHandler) always wins; otherwise the caller must
 * supply a guest-session identity via the guest header. Never both,
 * never neither - the Cart/Wishlist tables' own CHECK constraints
 * enforce the same XOR at the storage layer as defense in depth.
 *
 * CART-004 (blueprint/DECISION_REGISTER.md): this header functions as a
 * bearer credential - whoever presents a given value gets that guest's
 * cart/wishlist/checkout-session access, so its strength genuinely
 * matters. The previously-shipped design trusted ANY client-supplied
 * string verbatim (length-capped only) - a real gap, since a
 * non-storefront caller could present a short/guessed/reused value and
 * be accepted identically to the storefront's own genuine
 * `crypto.randomUUID()`-based id.
 *
 * Fixed with a server-issued, HMAC-signed token
 * (`mintGuestSessionToken`/`POST /storefront/guest-session`) that the
 * real storefront client (`apps/storefront/src/lib/cart.ts`) now
 * fetches instead of generating locally - genuinely server-authoritative
 * end to end, not merely format-validated. In `NODE_ENV=production`
 * (the ONLY environment where this vulnerability is actually
 * exploitable by a real attacker - see SECURITY.md's own dev/test-vs-
 * production posture, and the identical `getChannelProvider` MOCK_*
 * production guard's precedent for this exact "strict in production,
 * permissive in dev/test" shape), a header that fails signature
 * verification is REJECTED outright (never silently substituted with a
 * fresh identity, which would require threading a new response header
 * through every cart/wishlist/checkout route - a much larger, riskier
 * change than this fix needs) - the client is expected to call
 * `POST /storefront/guest-session` first, exactly as the real storefront
 * already does on its very first cart interaction, so this path is
 * reached by a genuine non-storefront caller (correctly rejected) or a
 * real client bug (correctly surfaced, never papered over), never a
 * normal guest checkout. Outside production, a raw client-supplied
 * string is still accepted verbatim (length-capped) - preserving every
 * existing integration test fixture across every storefront milestone
 * without a large, unrelated test-suite rewrite; those environments are
 * never reachable by a real attacker.
 */
export function resolveCartIdentity(request: FastifyRequest): CartOwnerIdentity {
  if (request.customer) return { customerId: request.customer.id };

  const header = request.headers[GUEST_SESSION_HEADER];
  const guestSessionId = Array.isArray(header) ? header[0] : header;
  if (!guestSessionId?.trim()) {
    throw new ValidationError(
      `A guest request requires the '${GUEST_SESSION_HEADER}' header when no customer session is present`,
    );
  }
  const trimmed = guestSessionId.trim();
  if (trimmed.length > MAX_GUEST_SESSION_ID_LENGTH) {
    throw new ValidationError(`The '${GUEST_SESSION_HEADER}' header must be at most ${MAX_GUEST_SESSION_ID_LENGTH} characters`);
  }

  if (loadEnv().NODE_ENV === 'production') {
    const verifiedId = verifyGuestSessionToken(trimmed);
    if (!verifiedId) {
      throw new ValidationError(
        `The '${GUEST_SESSION_HEADER}' header must be a server-issued token - call POST /storefront/guest-session first`,
      );
    }
    return { guestSessionId: verifiedId };
  }

  return { guestSessionId: trimmed };
}
