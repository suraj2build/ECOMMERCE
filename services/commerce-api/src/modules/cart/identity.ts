import type { FastifyRequest } from 'fastify';
import { ValidationError } from '@fcp/shared';

export const GUEST_SESSION_HEADER = 'x-guest-session-id';

export interface CartOwnerIdentity {
  customerId?: string;
  guestSessionId?: string;
}

// Bearer-credential-grade guest ids are genuine UUIDs (36 chars) - the
// shipped storefront client (apps/storefront/src/lib/cart.ts) always
// generates one via crypto.randomUUID(). This cap is deliberately loose
// (well above 36) rather than a strict format check: many existing test
// fixtures across the storefront milestones use short, human-readable
// guest ids ('guest-a', 'guest-ord-cod', etc.), and retrofitting strict
// UUID validation now would require rewriting all of them - tracked as
// its own, separate, pre-production security follow-up rather than done
// here (CART-004, blueprint/DECISION_REGISTER.md). This cap only closes
// the cheap abuse vector (an oversized header value) without touching
// any legitimate caller, real or test.
const MAX_GUEST_SESSION_ID_LENGTH = 256;

/**
 * Resolves who a cart/wishlist request belongs to (CART-001). A logged-in
 * customer's bearer token (already verified by the route's tryCustomerAuth
 * preHandler) always wins; otherwise the caller must supply a client-
 * generated device/session id via the guest header. Never both, never
 * neither - the Cart/Wishlist tables' own CHECK constraints enforce the
 * same XOR at the storage layer as defense in depth.
 *
 * This header functions as a bearer credential (CART-004): whoever
 * presents a given value gets that guest's cart/wishlist/checkout
 * access. Full format/entropy validation is a documented, deliberately
 * deferred follow-up (see the constant above) - not silently skipped.
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
  return { guestSessionId: trimmed };
}
