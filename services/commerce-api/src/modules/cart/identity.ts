import type { FastifyRequest } from 'fastify';
import { ValidationError } from '@fcp/shared';

export const GUEST_SESSION_HEADER = 'x-guest-session-id';

export interface CartOwnerIdentity {
  customerId?: string;
  guestSessionId?: string;
}

/**
 * Resolves who a cart/wishlist request belongs to (CART-001). A logged-in
 * customer's bearer token (already verified by the route's tryCustomerAuth
 * preHandler) always wins; otherwise the caller must supply a client-
 * generated device/session id via the guest header. Never both, never
 * neither - the Cart/Wishlist tables' own CHECK constraints enforce the
 * same XOR at the storage layer as defense in depth.
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
  return { guestSessionId: guestSessionId.trim() };
}
