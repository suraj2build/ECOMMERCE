import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '@fcp/config';
import { UnauthorizedError } from '@fcp/shared';
import { CartService } from './service.js';
import { WishlistService } from './wishlist-service.js';
import {
  resolveCartIdentity,
  resolveGuestOwner,
  mintGuestSessionToken,
  renewGuestSessionToken,
  guestRenewalRateLimitKey,
  GUEST_SESSION_HEADER,
  type IssuedGuestSession,
} from './identity.js';

const addItemSchema = z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().default(1) });
const updateQuantitySchema = z.object({ quantity: z.number().int().positive() });
const moveToCartSchema = z.object({ quantity: z.number().int().positive().default(1) });
const skuIdParamSchema = z.object({ skuId: z.string().uuid() });

function guestSessionResponse(issued: IssuedGuestSession) {
  return {
    guestSessionId: issued.token,
    issuedAt: new Date(issued.claims.issuedAt * 1000).toISOString(),
    expiresAt: new Date(issued.claims.expiresAt * 1000).toISOString(),
  };
}

/**
 * Cart/Wishlist storefront routes (M12). Every route below serves both
 * guest and logged-in customers via tryCustomerAuth (optional bearer
 * token) + resolveCartIdentity's guest-header fallback - the only
 * exception is /merge, which requires a real customer session (you can
 * only merge a guest cart INTO an account you're currently logged into).
 */
const cartRoutes: FastifyPluginAsync = async (fastify) => {
  const cartService = new CartService(fastify);
  const wishlistService = new WishlistService(fastify);

  const identityAuth = { preHandler: fastify.tryCustomerAuth };

  // --- Guest session credential (CART-004) - see identity.ts ---
  //
  // Issuance mints a brand-new guest owner; it reads nothing from the
  // request, so no caller can have a chosen owner id signed. Limited per
  // client IP since every call creates a fresh credential.
  const env = loadEnv();
  const e2eOverride = env.AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX;
  fastify.post(
    '/storefront/guest-session',
    {
      config: {
        rateLimit: {
          max: e2eOverride ?? env.GUEST_SESSION_ISSUE_RATE_LIMIT_PER_MINUTE,
          timeWindow: '1 minute',
          keyGenerator: (request) => `ip:${request.ip}`,
        },
      },
    },
    async (_request, reply) => {
      reply.status(201).send(guestSessionResponse(mintGuestSessionToken()));
    },
  );

  // Renewal: re-signs the owner of the CURRENTLY VALID token in the
  // guest header with a fresh lifetime - same owner, so the existing
  // cart/wishlist/orders stay attached. An invalid or expired token is
  // 401; the client then obtains a new session. Limited per verified
  // owner (unverifiable callers share their IP bucket).
  fastify.post(
    '/storefront/guest-session/renew',
    {
      config: {
        rateLimit: { max: e2eOverride ?? 10, timeWindow: '1 minute', keyGenerator: guestRenewalRateLimitKey },
      },
    },
    async (request, reply) => {
      const header = request.headers[GUEST_SESSION_HEADER];
      const presented = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
      const renewed = renewGuestSessionToken(presented);
      if (!renewed) {
        throw new UnauthorizedError('Guest session is invalid or expired - obtain a new one via POST /storefront/guest-session');
      }
      reply.status(200).send(guestSessionResponse(renewed));
    },
  );

  // --- Cart ---

  fastify.get('/storefront/cart', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await cartService.getCartView(identity));
  });

  fastify.post('/storefront/cart/items', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = addItemSchema.parse(request.body);
    reply.status(201).send(await cartService.addItem(identity, body.skuId, body.quantity));
  });

  fastify.patch('/storefront/cart/items/:skuId', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { skuId } = skuIdParamSchema.parse(request.params);
    const { quantity } = updateQuantitySchema.parse(request.body);
    reply.status(200).send(await cartService.updateItemQuantity(identity, skuId, quantity));
  });

  fastify.delete('/storefront/cart/items/:skuId', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { skuId } = skuIdParamSchema.parse(request.params);
    reply.status(200).send(await cartService.removeItem(identity, skuId));
  });

  // A shopper's explicit "Update price" response to a priceChanged line
  // (CartService.acceptCurrentPrice's own docblock) - never triggered
  // implicitly by a quantity change.
  fastify.post('/storefront/cart/items/:skuId/accept-price', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { skuId } = skuIdParamSchema.parse(request.params);
    reply.status(200).send(await cartService.acceptCurrentPrice(identity, skuId));
  });

  fastify.post(
    '/storefront/cart/merge',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const guestOwner = resolveGuestOwner(request);
      if (guestOwner) {
        await cartService.mergeGuestCartIntoCustomer(request.customer!.id, guestOwner);
      }
      reply.status(200).send(await cartService.getCartView({ customerId: request.customer!.id }));
    },
  );

  // --- Wishlist ---

  fastify.get('/storefront/wishlist', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    reply.status(200).send(await wishlistService.listItems(identity));
  });

  fastify.post('/storefront/wishlist/items', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const body = z.object({ skuId: z.string().uuid() }).parse(request.body);
    reply.status(201).send(await wishlistService.addItem(identity, body.skuId));
  });

  fastify.delete('/storefront/wishlist/items/:skuId', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { skuId } = skuIdParamSchema.parse(request.params);
    reply.status(200).send(await wishlistService.removeItem(identity, skuId));
  });

  fastify.post('/storefront/wishlist/items/:skuId/move-to-cart', identityAuth, async (request, reply) => {
    const identity = resolveCartIdentity(request);
    const { skuId } = skuIdParamSchema.parse(request.params);
    const { quantity } = moveToCartSchema.parse(request.body ?? {});
    reply.status(200).send(await wishlistService.moveToCart(identity, skuId, quantity));
  });

  fastify.post(
    '/storefront/wishlist/merge',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const guestOwner = resolveGuestOwner(request);
      if (guestOwner) {
        await wishlistService.mergeGuestWishlistIntoCustomer(request.customer!.id, guestOwner);
      }
      reply.status(200).send(await wishlistService.listItems({ customerId: request.customer!.id }));
    },
  );
};

export default cartRoutes;
