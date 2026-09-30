import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { loadEnv } from '@fcp/config';
import { UnauthorizedError, ValidationError } from '@fcp/shared';

export const GUEST_SESSION_HEADER = 'x-guest-session-id';

export interface CartOwnerIdentity {
  customerId?: string;
  guestSessionId?: string;
}

/**
 * CART-004 guest-session credential (M31, lifecycle added by the M31
 * certification repair).
 *
 * The guest header is a bearer credential: whoever presents a valid one
 * gets that guest's cart, wishlist, checkout sessions and guest orders.
 * Format (version 1):
 *
 *   gs1.<ownerId>.<issuedAt>.<expiresAt>.<mac>
 *
 *  - ownerId: server-generated UUIDv4, the stable guest owner stored in
 *    Cart/Wishlist/Order/etc. `guestSessionId` columns. Never chosen by
 *    the client and never changed by renewal.
 *  - issuedAt / expiresAt: integer epoch seconds.
 *  - mac: base64url HMAC-SHA256 over `gs1.<ownerId>.<issuedAt>.<expiresAt>`
 *    with a dedicated signing key, so the version, owner, and both
 *    timestamps are all authenticated - changing any of them invalidates
 *    the token.
 *
 * Expiry is enforced here on every request from the token's own
 * authenticated `expiresAt`. A token whose lifetime exceeds the currently
 * configured GUEST_SESSION_TTL_SECONDS is also rejected, so lowering the
 * TTL takes effect immediately. Renewal (renewGuestSessionToken) re-signs
 * the SAME verified owner with a fresh issuedAt/expiresAt; it is only
 * possible from a currently valid token.
 *
 * The TTL is a credential lifetime, not data retention (CUST-001 is
 * untouched): an expired token stops authenticating, nothing is deleted.
 */
const TOKEN_VERSION = 'gs1';
const DERIVED_KEY_LABEL = 'fcp-guest-session-signing-key/v1';
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_GUEST_HEADER_LENGTH = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EPOCH_SECONDS_PATTERN = /^\d{1,12}$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GuestSessionClaims {
  ownerId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface IssuedGuestSession {
  token: string;
  claims: GuestSessionClaims;
}

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function signingKey(): Buffer {
  const env = loadEnv();
  if (env.GUEST_SESSION_SIGNING_SECRET) return Buffer.from(env.GUEST_SESSION_SIGNING_SECRET, 'utf8');
  // Outside production only (config refuses to boot production without a
  // dedicated secret): a domain-separated derivation, so a guest token
  // can never double as any other credential signed with the JWT secret.
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(DERIVED_KEY_LABEL).digest();
}

function macFor(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

function sign(claims: GuestSessionClaims): IssuedGuestSession {
  const payload = `${TOKEN_VERSION}.${claims.ownerId}.${claims.issuedAt}.${claims.expiresAt}`;
  return { token: `${payload}.${macFor(payload)}`, claims };
}

/** Issues a credential for a brand-new guest owner. Takes no owner input by design. */
export function mintGuestSessionToken(now: number = nowInSeconds()): IssuedGuestSession {
  const ttl = loadEnv().GUEST_SESSION_TTL_SECONDS;
  return sign({ ownerId: randomUUID(), issuedAt: now, expiresAt: now + ttl });
}

export function isVersionedGuestToken(value: string): boolean {
  return value.startsWith(`${TOKEN_VERSION}.`);
}

/** Returns the authenticated claims of a valid, unexpired token, or null. Never throws. */
export function verifyGuestSessionToken(token: string, now: number = nowInSeconds()): GuestSessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [version, ownerId, issuedAtRaw, expiresAtRaw, mac] = parts as [string, string, string, string, string];
  if (version !== TOKEN_VERSION) return null;
  if (!UUID_PATTERN.test(ownerId) || !EPOCH_SECONDS_PATTERN.test(issuedAtRaw) || !EPOCH_SECONDS_PATTERN.test(expiresAtRaw)) return null;
  if (!MAC_PATTERN.test(mac)) return null;

  const expected = Buffer.from(macFor(`${version}.${ownerId}.${issuedAtRaw}.${expiresAtRaw}`), 'base64url');
  const presented = Buffer.from(mac, 'base64url');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  if (expiresAt <= issuedAt) return null;
  if (expiresAt - issuedAt > loadEnv().GUEST_SESSION_TTL_SECONDS) return null;
  if (issuedAt > now + MAX_CLOCK_SKEW_SECONDS) return null;
  if (now >= expiresAt) return null;
  return { ownerId, issuedAt, expiresAt };
}

/**
 * Re-signs the owner of a currently valid token with a fresh lifetime.
 * The owner comes only from the verified token - there is no parameter
 * through which a caller could ask for any other owner to be signed.
 */
export function renewGuestSessionToken(token: string, now: number = nowInSeconds()): IssuedGuestSession | null {
  const claims = verifyGuestSessionToken(token, now);
  if (!claims) return null;
  const ttl = loadEnv().GUEST_SESSION_TTL_SECONDS;
  return sign({ ownerId: claims.ownerId, issuedAt: now, expiresAt: now + ttl });
}

function readGuestHeader(request: FastifyRequest): string | undefined {
  const header = request.headers[GUEST_SESSION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The guest owner id a request is entitled to act as, or undefined when
 * no guest header was sent. A present-but-invalid/expired credential is
 * rejected with 401 - never silently replaced with a new identity.
 * GUEST_SESSION_ALLOW_UNSIGNED (dev/test only; a startup error in
 * production) additionally accepts a raw unsigned id for pre-existing
 * test fixtures; a value that claims to be a gs1 token must still verify.
 */
export function resolveGuestOwner(request: FastifyRequest): string | undefined {
  const value = readGuestHeader(request);
  if (!value) return undefined;
  if (value.length > MAX_GUEST_HEADER_LENGTH) {
    throw new ValidationError(`The '${GUEST_SESSION_HEADER}' header must be at most ${MAX_GUEST_HEADER_LENGTH} characters`);
  }
  if (isVersionedGuestToken(value)) {
    const claims = verifyGuestSessionToken(value);
    if (!claims) {
      throw new UnauthorizedError('Guest session is invalid or expired - obtain a new one via POST /storefront/guest-session');
    }
    return claims.ownerId;
  }
  if (loadEnv().GUEST_SESSION_ALLOW_UNSIGNED) return value;
  throw new UnauthorizedError('Guest session must be a server-issued token - obtain one via POST /storefront/guest-session');
}

/**
 * Resolves who a cart/wishlist/checkout/order request belongs to
 * (CART-001). A verified customer (tryCustomerAuth ran first) always
 * wins; otherwise a valid guest credential is required.
 */
export function resolveCartIdentity(request: FastifyRequest): CartOwnerIdentity {
  if (request.customer) return { customerId: request.customer.id };
  const guestOwner = resolveGuestOwner(request);
  if (!guestOwner) {
    throw new ValidationError(
      `A guest request requires the '${GUEST_SESSION_HEADER}' header when no customer session is present`,
    );
  }
  return { guestSessionId: guestOwner };
}

function verifiedGuestOwnerOrNull(request: FastifyRequest): string | null {
  const value = readGuestHeader(request);
  if (!value || value.length > MAX_GUEST_HEADER_LENGTH) return null;
  if (isVersionedGuestToken(value)) return verifyGuestSessionToken(value)?.ownerId ?? null;
  return loadEnv().GUEST_SESSION_ALLOW_UNSIGNED ? value : null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Rate-limit key for guest-or-customer storefront routes (checkout,
 * payment retry). Only a VERIFIED identity earns its own bucket:
 *  - a customer JWT that verifies           -> `c:<customerId>`
 *  - a guest credential that verifies       -> `g:<ownerId>`
 *  - anything else (absent, forged, expired,
 *    garbage bearer or guest header)         -> `ip:<client ip>`
 * so rotating fake credentials only ever lands in the caller's one IP
 * bucket and cannot mint fresh buckets. Runs at onRequest (before the
 * route's own auth preHandler), so it verifies the credentials itself;
 * both checks are stateless (JWT signature / HMAC). Ordinary identity and
 * IP throttling - no device fingerprinting.
 */
export function checkoutRateLimitKey(request: FastifyRequest): string {
  const bearer = bearerToken(request);
  if (bearer) {
    try {
      const payload = request.server.jwt.verify<{ sub?: string }>(bearer);
      if (payload?.sub) return `c:${payload.sub}`;
    } catch {
      // unverifiable bearer - fall through to the IP bucket
    }
    return `ip:${request.ip}`;
  }
  const guestOwner = verifiedGuestOwnerOrNull(request);
  return guestOwner ? `g:${guestOwner}` : `ip:${request.ip}`;
}

/** Rate-limit key for guest-session renewal: the verified owner, or the IP for anything unverifiable. */
export function guestRenewalRateLimitKey(request: FastifyRequest): string {
  const value = readGuestHeader(request);
  const owner = value && isVersionedGuestToken(value) ? verifyGuestSessionToken(value)?.ownerId : undefined;
  return owner ? `g:${owner}` : `ip:${request.ip}`;
}
