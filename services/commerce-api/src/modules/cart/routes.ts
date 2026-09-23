import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CartService } from './service.js';
import { WishlistService } from './wishlist-service.js';
import { resolveCartIdentity, GUEST_SESSION_HEADER } from './identity.js';

const addItemSchema = z.object({ skuId: z.string().uuid(), quantity: z.number().int().positive().default(1) });
const updateQuantitySchema = z.object({ quantity: z.number().int().positive() });
const moveToCartSchema = z.object({ quantity: z.number().int().positive().default(1) });
const skuIdParamSchema = z.object({ skuId: z.string().uuid() });
const guestHeaderSchema = z.object({ [GUEST_SESSION_HEADER]: z.string().min(1).optional() });

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

  fastify.post(
    '/storefront/cart/merge',
    { preHandler: fastify.requireCustomerAuth },
    async (request, reply) => {
      const { [GUEST_SESSION_HEADER]: guestSessionId } = guestHeaderSchema.parse(request.headers);
      if (guestSessionId) {
        await cartService.mergeGuestCartIntoCustomer(request.customer!.id, guestSessionId);
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
      const { [GUEST_SESSION_HEADER]: guestSessionId } = guestHeaderSchema.parse(request.headers);
      if (guestSessionId) {
        await wishlistService.mergeGuestWishlistIntoCustomer(request.customer!.id, guestSessionId);
      }
      reply.status(200).send(await wishlistService.listItems({ customerId: request.customer!.id }));
    },
  );
};

export default cartRoutes;
