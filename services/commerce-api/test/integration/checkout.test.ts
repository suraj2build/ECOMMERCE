import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantAllPermissions, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';
const NO_COD_PINCODE = '110002';
const UNSERVICEABLE_PINCODE = '999999';

/**
 * M13 Checkout (specs/12-checkout.md, CHK-001/002/003/004, INV-002).
 * Produces a CheckoutSession (the "order creation trigger" artifact) -
 * not a formal Order, which is M15's own milestone (see the schema
 * comment). Two payment paths: COD completes for real within this
 * milestone (no external gateway needed); PREPAID hands off to the
 * PaymentProvider interface and is honestly incomplete pending M14's
 * real Razorpay integration.
 */
describe('Checkout (M13)', () => {
  let app: FastifyInstance;
  let gstinCounter = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();

    await testPrisma.serviceablePincode.create({
      data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
    });
    await testPrisma.serviceablePincode.create({
      data: { pincode: NO_COD_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: false },
    });
    await testPrisma.serviceablePincode.create({
      data: { pincode: UNSERVICEABLE_PINCODE, city: 'Nowhere', state: 'Nowhere', isServiceable: false, codAvailable: false },
    });
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  /** Seeds Brand/Category/Size/Location + an ACTIVE GST registration once - reused across multiple setupCheckoutableSku() calls in the same test to avoid unique-code collisions. */
  async function seedCheckoutContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();

    gstinCounter += 1;
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Checkout Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLAAAAA${String(gstinCounter).padStart(4, '0')}A1Z${gstinCounter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });

    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  /** Publishes a priced, in-stock, tax-configured SKU ready to check out. */
  async function setupCheckoutableSku(
    opts: { sellingPrice: number; onHand?: number; hsnCode?: string },
    ctx?: { brandId: string; categoryId: string; sizeId: string; locationId: string },
  ) {
    const token = await merchandisingToken();
    const seeded = ctx ?? (await seedCheckoutContext());

    const hsnCode = opts.hsnCode ?? '6109';
    const existingRate = await testPrisma.taxRate.findFirst({ where: { hsnCode } });
    if (!existingRate) {
      await testPrisma.taxRate.create({
        data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });
    }

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: `CHK-${Date.now()}-${gstinCounter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Checkout Test Jacket',
        brandId: seeded.brandId,
        categoryId: seeded.categoryId,
        season: 'SS26',
        collection: 'Core',
        hsnCode,
      },
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
      payload: { sizeIds: [seeded.sizeId] },
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
      payload: { styleId, mrp: opts.sellingPrice, sellingPrice: opts.sellingPrice },
    });

    await testPrisma.inventoryBalance.create({
      data: { skuId, locationId: seeded.locationId, onHand: opts.onHand ?? 10, reserved: 0 },
    });

    return { styleId, skuId, locationId: seeded.locationId };
  }

  function validAddress(overrides: Partial<Record<string, string>> = {}) {
    return {
      line1: '123 Test Street',
      city: 'New Delhi',
      state: 'Delhi',
      stateCode: 'DL',
      pincode: SERVICEABLE_PINCODE,
      ...overrides,
    };
  }

  async function addToCart(skuId: string, headers: Record<string, string>, quantity = 1) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(res.statusCode).toBe(201);
  }

  describe('Preview', () => {
    it('rejects preview with an empty bag', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout/preview',
        headers: { [GUEST_HEADER]: 'guest-empty' },
        payload: { shippingAddress: validAddress() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('computes tax-inclusive line totals, shipping, and grand total', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 1000 });
      const headers = { [GUEST_HEADER]: 'guest-preview' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout/preview',
        headers,
        payload: { shippingAddress: validAddress() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isServiceable).toBe(true);
      expect(body.lines[0].lineTotalInclusive).toBe(1000);
      expect(body.subtotal).toBe(1000);
      // Below the free-shipping default threshold (₹1999) - flat rate applies.
      expect(body.shippingCost).toBeGreaterThan(0);
      expect(body.grandTotal).toBe(body.subtotal + body.shippingCost);
    });
  });

  describe('COD - completes fully within this milestone', () => {
    it('reserves inventory, confirms the order, and marks payment CONFIRMED', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-cod' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-cod-1',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('CONFIRMED');
      expect(body.payment.status).toBe('CONFIRMED');
      expect(body.confirmedAt).not.toBeNull();

      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(1);
      expect(reservations[0]!.status).toBe('ACTIVE');

      const balance = await testPrisma.inventoryBalance.findFirst({ where: { skuId } });
      expect(balance!.reserved).toBe(1);
    });

    it('rejects COD for a PIN code where COD is unavailable', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-cod-nocod' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress({ pincode: NO_COD_PINCODE }),
          shippingAddress: validAddress({ pincode: NO_COD_PINCODE }),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-cod-nocod',
        },
      });
      expect(res.statusCode).toBe(400);

      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(0);
    });

    it('rejects COD above the configured order-value cap', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 999999 });
      const headers = { [GUEST_HEADER]: 'guest-cod-cap' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-cod-cap',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/Cash on Delivery/i);
    });
  });

  describe('Prepaid - honest handoff, not completed here', () => {
    it('reserves inventory but leaves the session RESERVED, payment INITIATED, with a clear "coming soon" message', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-prepaid' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'PREPAID',
          idempotencyKey: 'idem-prepaid-1',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('RESERVED');
      expect(body.payment.status).toBe('INITIATED');
      expect(body.payment.message).toMatch(/coming soon/i);
      expect(body.confirmedAt).toBeNull();

      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(1);
    });
  });

  describe('PIN re-validation (CHK-004)', () => {
    it('blocks checkout for a non-serviceable PIN code even if the cart is otherwise valid', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-unserviceable' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress({ pincode: UNSERVICEABLE_PINCODE }),
          shippingAddress: validAddress({ pincode: UNSERVICEABLE_PINCODE }),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-unserviceable',
        },
      });
      expect(res.statusCode).toBe(400);

      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(0);
    });
  });

  describe('Cart re-validation', () => {
    it('blocks checkout when a cart item has gone out of stock since it was added', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500, onHand: 1 });
      const headers = { [GUEST_HEADER]: 'guest-oos-cart' };
      await addToCart(skuId, headers);
      await testPrisma.inventoryBalance.updateMany({ where: { skuId }, data: { onHand: 0 } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-oos-cart',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Insufficient stock at checkout time (all-or-nothing)', () => {
    it('cart-level re-validation blocks checkout (400) before any reservation is attempted when the cart itself has too little stock', async () => {
      const ctx = await seedCheckoutContext();
      const { skuId: skuA } = await setupCheckoutableSku({ sellingPrice: 500, onHand: 5 }, ctx);
      const { skuId: skuB } = await setupCheckoutableSku({ sellingPrice: 500, onHand: 1 }, ctx);
      const headers = { [GUEST_HEADER]: 'guest-partial-oos' };
      await addToCart(skuA, headers, 2);
      await addToCart(skuB, headers, 5); // exceeds the 1 unit on hand - the cart's own inStock check catches this

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-partial-oos',
        },
      });
      expect(res.statusCode).toBe(400);

      const reservationsA = await testPrisma.inventoryReservation.findMany({ where: { skuId: skuA } });
      const reservationsB = await testPrisma.inventoryReservation.findMany({ where: { skuId: skuB } });
      expect(reservationsA).toHaveLength(0);
      expect(reservationsB).toHaveLength(0);
    });

    it('rolls back an already-reserved line (all-or-nothing) when stock is fragmented across locations with no single location able to fulfil it', async () => {
      // Cart validation checks aggregate availability across all
      // locations, but a single line is still reserved from ONE
      // location (no split-shipment support) - fragmented stock can
      // pass the cart's own check yet still fail at reservation time.
      // This is the genuine InsufficientStockError (409) path, distinct
      // from the cart-level 400 above, and proves the first line's
      // reservation is rolled back rather than left dangling.
      const ctx = await seedCheckoutContext();
      const { skuId: skuA } = await setupCheckoutableSku({ sellingPrice: 500, onHand: 5 }, ctx);
      const { skuId: skuB } = await setupCheckoutableSku({ sellingPrice: 500, onHand: 3 }, ctx);
      const otherLocation = await testPrisma.location.create({ data: { code: `EXTRA-${Date.now()}`, name: 'Extra Warehouse', type: 'WAREHOUSE' } });
      await testPrisma.inventoryBalance.create({ data: { skuId: skuB, locationId: otherLocation.id, onHand: 2, reserved: 0 } });
      // Aggregate available for skuB is 5 (passes cart-level check for qty 5), but no single location has >= 5.

      const headers = { [GUEST_HEADER]: 'guest-fragmented' };
      await addToCart(skuA, headers, 2);
      await addToCart(skuB, headers, 5);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-fragmented',
        },
      });
      expect(res.statusCode).toBe(409);

      // skuA's reservation is made first (line order follows add-to-cart
      // order), then released when skuB's line fails - releaseReservation
      // marks it RELEASED rather than deleting the row, so "no active
      // reservation remains" is the correct assertion, not "no row exists".
      const reservationsA = await testPrisma.inventoryReservation.findMany({ where: { skuId: skuA, status: 'ACTIVE' } });
      const reservationsB = await testPrisma.inventoryReservation.findMany({ where: { skuId: skuB, status: 'ACTIVE' } });
      expect(reservationsA).toHaveLength(0);
      expect(reservationsB).toHaveLength(0);

      const balanceA = await testPrisma.inventoryBalance.findFirst({ where: { skuId: skuA } });
      expect(balanceA!.reserved).toBe(0);
    });
  });

  describe('Idempotency (double-submission)', () => {
    it('returns the same session for two identical submissions and creates only one reservation', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-dupe' };
      await addToCart(skuId, headers);

      const payload = {
        contactName: 'Jane Doe',
        contactMobile: '9876543210',
        billingAddress: validAddress(),
        shippingAddress: validAddress(),
        paymentMethod: 'COD' as const,
        idempotencyKey: 'idem-dupe-1',
      };

      const [res1, res2] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload }),
        app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload }),
      ]);
      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);
      expect(res1.json().id).toBe(res2.json().id);

      const sessions = await testPrisma.checkoutSession.findMany({ where: { idempotencyKey: 'idem-dupe-1' } });
      expect(sessions).toHaveLength(1);
      const reservations = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservations).toHaveLength(1);
    });
  });

  describe('Guest and identity isolation', () => {
    it('lets a genuine guest complete checkout with no account/login at any point', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-no-account' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Guest Buyer',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-guest-account',
        },
      });
      expect(res.statusCode).toBe(201);

      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: res.json().id } });
      expect(session.customerId).toBeNull();
      expect(session.guestSessionId).toBe('guest-no-account');
    });

    it('does not let one identity read another identity\'s checkout session', async () => {
      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-owner' };
      await addToCart(skuId, headers);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-owner-read',
        },
      });
      const sessionId = createRes.json().id as string;

      const otherGuestRes = await app.inject({
        method: 'GET',
        url: `/api/v1/storefront/checkout/${sessionId}`,
        headers: { [GUEST_HEADER]: 'guest-not-owner' },
      });
      expect(otherGuestRes.statusCode).toBe(404);

      const { token } = await createAuthenticatedCustomer(app);
      const customerRes = await app.inject({
        method: 'GET',
        url: `/api/v1/storefront/checkout/${sessionId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(customerRes.statusCode).toBe(404);

      const ownerRes = await app.inject({ method: 'GET', url: `/api/v1/storefront/checkout/${sessionId}`, headers });
      expect(ownerRes.statusCode).toBe(200);
    });
  });

  describe('Shipping rule configuration (CHK-003)', () => {
    it('applies free shipping above the configured threshold', async () => {
      await grantAllPermissions('SUPER_ADMIN');
      const { token } = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);
      await app.inject({
        method: 'POST',
        url: '/api/v1/checkout/shipping-rule',
        headers: { authorization: `Bearer ${token}` },
        payload: { type: 'FREE_ABOVE_THRESHOLD', freeAboveThreshold: 100 },
      });

      const { skuId } = await setupCheckoutableSku({ sellingPrice: 500 });
      const headers = { [GUEST_HEADER]: 'guest-free-ship' };
      await addToCart(skuId, headers);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout/preview',
        headers,
        payload: { shippingAddress: validAddress() },
      });
      expect(res.json().shippingCost).toBe(0);
    });

    it('rejects shipping-rule configuration without shipping:manage permission', async () => {
      const { token } = await createAuthenticatedStaff(app, ['ANALYTICS']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/checkout/shipping-rule',
        headers: { authorization: `Bearer ${token}` },
        payload: { type: 'FLAT', flatAmount: 50 },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
