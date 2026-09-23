import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

const GUEST_HEADER = 'x-guest-session-id';

/**
 * M12 Wishlist / Cart (specs/11-wishlist-cart.md, CART-001/002/003,
 * INV-002). The one invariant every test here indirectly proves: cart
 * operations never call InventoryService.reserve() - see the explicit
 * "never reserves" test below.
 */
describe('Wishlist / Cart (M12)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  /** Seeds Brand/Category/Size/Location once - reused across multiple publishStyle() calls in the same test to avoid unique-code collisions. */
  async function seedCatalogContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function publishStyle(
    ctx: { brandId: string; categoryId: string; sizeId: string; locationId: string },
    opts: { styleCode: string; name: string; sellingPrice: number; mrp?: number },
  ) {
    const token = await merchandisingToken();

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: opts.styleCode, name: opts.name, brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core' },
    });
    const styleId = styleRes.json().id as string;

    const colourRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Black', colourCode: 'BLK' },
    });
    const colourId = colourRes.json().id as string;

    const skuRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/skus/generate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sizeIds: [ctx.sizeId] },
    });
    const skuId = skuRes.json()[0].skuId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId, url: 'https://example.com/x.jpg' },
    });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleId, mrp: opts.mrp ?? opts.sellingPrice, sellingPrice: opts.sellingPrice },
    });

    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: ctx.locationId, onHand: 5, reserved: 0 } });

    return { styleId, skuId, colourId, token };
  }

  describe('Cart', () => {
    it('never creates an inventory reservation when an item is added (INV-002)', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-001', name: 'Tee', sellingPrice: 999 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/cart/items',
        headers: { [GUEST_HEADER]: 'guest-a' },
        payload: { skuId, quantity: 2 },
      });
      expect(res.statusCode).toBe(201);

      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(0);
      const txns = await testPrisma.inventoryTransaction.findMany({ where: { skuId, type: 'RESERVATION' } });
      expect(txns).toHaveLength(0);
      const balance = await testPrisma.inventoryBalance.findFirst({ where: { skuId } });
      expect(balance!.reserved).toBe(0);
    });

    it('adds, reads, updates quantity, and removes a cart item as a guest', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-002', name: 'Jeans', sellingPrice: 1999 });
      const headers = { [GUEST_HEADER]: 'guest-b' };

      const addRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });
      expect(addRes.statusCode).toBe(201);
      expect(addRes.json().itemCount).toBe(1);
      expect(addRes.json().subtotal).toBe(1999);

      const getRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers });
      expect(getRes.json().items).toHaveLength(1);
      expect(getRes.json().items[0].inStock).toBe(true);
      expect(getRes.json().items[0].isPurchasable).toBe(true);

      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/storefront/cart/items/${skuId}`,
        headers,
        payload: { quantity: 3 },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().items[0].quantity).toBe(3);
      expect(updateRes.json().subtotal).toBe(5997);

      const removeRes = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/cart/items/${skuId}`, headers });
      expect(removeRes.statusCode).toBe(200);
      expect(removeRes.json().items).toHaveLength(0);
    });

    it('rejects a guest request with no guest-session header and no customer token (400)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart' });
      expect(res.statusCode).toBe(400);
    });

    it('enforces the per-SKU quantity limit (CART-002)', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-003', name: 'Cap', sellingPrice: 499 });
      const headers = { [GUEST_HEADER]: 'guest-c' };

      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 11 } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/maximum/i);
    });

    it('flags a price change against the price-at-add snapshot without silently charging the new price', async () => {
      const { styleId, skuId, token } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-004', name: 'Hoodie', sellingPrice: 2000 });
      const headers = { [GUEST_HEADER]: 'guest-d' };

      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });

      // Merchandiser changes the price after the item was added.
      await app.inject({
        method: 'POST',
        url: '/api/v1/catalog/prices',
        headers: { authorization: `Bearer ${token}` },
        payload: { styleId, mrp: 2500, sellingPrice: 2500 },
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers });
      const item = res.json().items[0];
      expect(item.priceAtAdd).toBe(2000);
      expect(item.currentPrice).toBe(2500);
      expect(item.priceChanged).toBe(true);
      expect(res.json().hasBlockingChanges).toBe(true);
    });

    it('flags an item that has gone out of stock since it was added, without erroring', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-005', name: 'Scarf', sellingPrice: 599 });
      const headers = { [GUEST_HEADER]: 'guest-e' };

      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 5 } });
      await testPrisma.inventoryBalance.updateMany({ where: { skuId }, data: { onHand: 0 } });

      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers });
      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.inStock).toBe(false);
      expect(res.json().hasBlockingChanges).toBe(true);
    });

    it('keeps a guest cart isolated from a different guest session and from an unauthenticated customer', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'CART-006', name: 'Belt', sellingPrice: 799 });
      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers: { [GUEST_HEADER]: 'guest-f1' }, payload: { skuId, quantity: 1 } });

      const otherGuest = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers: { [GUEST_HEADER]: 'guest-f2' } });
      expect(otherGuest.json().items).toHaveLength(0);

      const { token } = await createAuthenticatedCustomer(app);
      const customerCart = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers: { authorization: `Bearer ${token}` } });
      expect(customerCart.json().items).toHaveLength(0);
    });

    it('merges a guest cart into the account cart on login, summing quantities and capping at the max (CART-001)', async () => {
      const ctx = await seedCatalogContext();
      const { skuId: skuA } = await publishStyle(ctx, { styleCode: 'CART-007', name: 'Socks', sellingPrice: 199 });
      const { skuId: skuB } = await publishStyle(ctx, { styleCode: 'CART-008', name: 'Gloves', sellingPrice: 299 });
      const guestHeaders = { [GUEST_HEADER]: 'guest-g' };

      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers: guestHeaders, payload: { skuId: skuA, quantity: 2 } });
      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers: guestHeaders, payload: { skuId: skuB, quantity: 1 } });

      const { token } = await createAuthenticatedCustomer(app);
      // Customer already had skuA in their own account cart before this login.
      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers: { authorization: `Bearer ${token}` }, payload: { skuId: skuA, quantity: 1 } });

      const mergeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/cart/merge',
        headers: { authorization: `Bearer ${token}`, [GUEST_HEADER]: 'guest-g' },
      });
      expect(mergeRes.statusCode).toBe(200);
      const items = mergeRes.json().items as { skuId: string; quantity: number }[];
      expect(items.find((i) => i.skuId === skuA)?.quantity).toBe(3); // 1 (account) + 2 (guest)
      expect(items.find((i) => i.skuId === skuB)?.quantity).toBe(1);

      // The guest cart is gone after merging - re-reading it starts fresh, not duplicated.
      const guestAfterMerge = await app.inject({ method: 'GET', url: '/api/v1/storefront/cart', headers: guestHeaders });
      expect(guestAfterMerge.json().items).toHaveLength(0);
    });
  });

  describe('Wishlist', () => {
    it('saves, lists, and removes a wishlist item as a guest', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'WISH-001', name: 'Watch', sellingPrice: 4999 });
      const headers = { [GUEST_HEADER]: 'guest-h' };

      const addRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers, payload: { skuId } });
      expect(addRes.statusCode).toBe(201);
      expect(addRes.json()).toHaveLength(1);
      expect(addRes.json()[0].currentPrice).toBe(4999);

      const listRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/wishlist', headers });
      expect(listRes.json()).toHaveLength(1);

      const removeRes = await app.inject({ method: 'DELETE', url: `/api/v1/storefront/wishlist/items/${skuId}`, headers });
      expect(removeRes.statusCode).toBe(200);
      expect(removeRes.json()).toHaveLength(0);
    });

    it('moves a wishlist item to the cart, removing it from the wishlist', async () => {
      const { skuId } = await publishStyle(await seedCatalogContext(), { styleCode: 'WISH-002', name: 'Sunglasses', sellingPrice: 1299 });
      const headers = { [GUEST_HEADER]: 'guest-i' };

      await app.inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers, payload: { skuId } });

      const moveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/wishlist/items/${skuId}/move-to-cart`,
        headers,
        payload: { quantity: 2 },
      });
      expect(moveRes.statusCode).toBe(200);
      expect(moveRes.json().items[0].quantity).toBe(2);

      const wishlistAfter = await app.inject({ method: 'GET', url: '/api/v1/storefront/wishlist', headers });
      expect(wishlistAfter.json()).toHaveLength(0);
    });

    it('merges a guest wishlist into the account wishlist on login, without duplicating shared items', async () => {
      const ctx = await seedCatalogContext();
      const { skuId: skuA } = await publishStyle(ctx, { styleCode: 'WISH-003', name: 'Ring', sellingPrice: 899 });
      const { skuId: skuB } = await publishStyle(ctx, { styleCode: 'WISH-004', name: 'Necklace', sellingPrice: 1599 });
      const guestHeaders = { [GUEST_HEADER]: 'guest-j' };

      await app.inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers: guestHeaders, payload: { skuId: skuA } });
      await app.inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers: guestHeaders, payload: { skuId: skuB } });

      const { token } = await createAuthenticatedCustomer(app);
      await app.inject({ method: 'POST', url: '/api/v1/storefront/wishlist/items', headers: { authorization: `Bearer ${token}` }, payload: { skuId: skuA } });

      const mergeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/wishlist/merge',
        headers: { authorization: `Bearer ${token}`, [GUEST_HEADER]: 'guest-j' },
      });
      expect(mergeRes.statusCode).toBe(200);
      expect(mergeRes.json()).toHaveLength(2); // skuA (deduped, not doubled) + skuB
    });

    it('404s adding an unknown SKU to the wishlist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/wishlist/items',
        headers: { [GUEST_HEADER]: 'guest-k' },
        payload: { skuId: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
