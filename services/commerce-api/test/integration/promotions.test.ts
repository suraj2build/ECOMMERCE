import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.COD_MAX_ORDER_VALUE_INR = '50000';

const SERVICEABLE_PINCODE = '110001';

/**
 * Promotions (M24, specs/23-promotions.md, PROMO-001/002; TAX-006)
 * adversarial certification. Covers: automatic-promotion eligibility
 * (minCartValue), coupon-code validation (invalid/expired/usage-cap),
 * stacking (same-stackGroup mutual exclusion, deterministic priority
 * resolution, a conflicting coupon rejected while the automatic
 * promotion it conflicts with remains applied), pre-tax discount
 * application (TAX-006 - the reduced taxable value/tax feed
 * splitTax unchanged), checkout-time store-credit redemption
 * (reserve/convert/release mirroring loyalty's own hold lifecycle),
 * genuine concurrency (a capped coupon's last-use race, and a
 * store-credit-balance overspend race), and staff RBAC on the minimal
 * promotion-management API.
 */
describe('Promotions (M24)', () => {
  let app: FastifyInstance;
  let counter = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await testPrisma.serviceablePincode.create({
      data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
    });
    counter += 1;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unexpected fetch in test');
      }),
    );
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write', 'promotion:manage', 'promotion:read']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Promo Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLPROTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function setupCheckoutableSku(sellingPrice: number, ctx: Awaited<ReturnType<typeof seedContext>>, onHand = 50) {
    const token = await merchandisingToken();
    const hsnCode = '6109';
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: `PROMO-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, name: 'Promo Test Jacket', brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = styleRes.json().id as string;
    const colourRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'Black', colourCode: 'BLK' } });
    const colourId = colourRes.json().id as string;
    const skuRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${token}` }, payload: { sizeIds: [ctx.sizeId] } });
    const skuId = skuRes.json()[0].skuId as string;

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: ctx.locationId, onHand, reserved: 0 } });

    return { skuId };
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function addToCart(skuId: string, headers: Record<string, string>, quantity = 1) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(res.statusCode).toBe(201);
  }

  function checkoutPayload(overrides: Record<string, unknown> = {}) {
    return {
      contactName: 'Jane Doe',
      contactMobile: '9876543210',
      billingAddress: validAddress(),
      shippingAddress: validAddress(),
      paymentMethod: 'COD',
      ...overrides,
    };
  }

  async function createPromotion(input: Record<string, unknown>) {
    const typeKey = (input.promotionTypeKey as string) ?? 'PROMOTIONAL';
    const promotionType = await testPrisma.promotionType.upsert({ where: { key: typeKey }, update: {}, create: { key: typeKey, name: typeKey } });
    return testPrisma.promotion.create({
      data: {
        name: (input.name as string) ?? 'Test Promotion',
        promotionTypeId: promotionType.id,
        isCoupon: (input.isCoupon as boolean) ?? false,
        couponCode: input.couponCode as string | undefined,
        discountType: (input.discountType as 'PERCENTAGE' | 'FLAT_AMOUNT') ?? 'PERCENTAGE',
        discountValue: (input.discountValue as number) ?? 10,
        maxDiscountAmount: input.maxDiscountAmount as number | undefined,
        minCartValue: input.minCartValue as number | undefined,
        stackGroup: input.stackGroup as string | undefined,
        priority: (input.priority as number) ?? 100,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: input.endsAt as Date | undefined,
        isActive: (input.isActive as boolean) ?? true,
        usageLimitTotal: input.usageLimitTotal as number | undefined,
        usageLimitPerCustomer: input.usageLimitPerCustomer as number | undefined,
        loyaltyCompatible: (input.loyaltyCompatible as boolean) ?? true,
        storeCreditCompatible: (input.storeCreditCompatible as boolean) ?? true,
      },
    });
  }

  /** Earns `targetPoints` (or more) for a fresh customer via one confirmed COD order at the default 1-point-per-100-INR rate, BEFORE any promotion exists so the earn amount is never itself discounted - mirrors loyalty.test.ts's own `customerWithEarnedPoints`. */
  async function customerWithLoyaltyPoints(targetPoints: number, ctx: Awaited<ReturnType<typeof seedContext>>) {
    const subtotalNeeded = targetPoints * 100 + 200; // headroom past floor() rounding
    const { skuId } = await setupCheckoutableSku(subtotalNeeded, ctx, 50);
    const { token } = await createAuthenticatedCustomer(app);
    const headers = { authorization: `Bearer ${token}` };
    await addToCart(skuId, headers);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-loyalty-seed-${counter}-${Math.random()}` }),
    });
    expect(res.statusCode).toBe(201);
    return { token };
  }

  async function customerWithStoreCreditBalance(amount: number) {
    const { customerId, token } = await createAuthenticatedCustomer(app);
    const account = await testPrisma.storeCreditAccount.create({ data: { customerId, balance: amount } });
    await testPrisma.storeCreditEntry.create({ data: { accountId: account.id, type: 'ISSUE', amount, reason: 'Test credit', idempotencyKey: `test-issue-xd-${customerId}` } });
    return { customerId, token, accountId: account.id };
  }

  // --- Automatic promotions ---

  describe('Automatic promotions', () => {
    it('1. an eligible automatic promotion (minCartValue met) applies with no code', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(2000, ctx);
      await createPromotion({ name: '10% off orders over 1000', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000 });

      const headers = { 'x-guest-session-id': `guest-promo-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-auto-${counter}` }) });
      expect(res.statusCode).toBe(201);
      expect(res.json().promotionDiscountTotal).toBeGreaterThan(0);
    });

    it('2. an automatic promotion below its minCartValue does NOT apply', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(500, ctx);
      await createPromotion({ name: '10% off orders over 1000', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000 });

      const headers = { 'x-guest-session-id': `guest-promo-low-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-low-${counter}` }) });
      expect(res.statusCode).toBe(201);
      expect(res.json().promotionDiscountTotal).toBe(0);
    });

    it('3. two automatic promotions sharing the same stackGroup are mutually exclusive - only the higher-priority (lower number) one applies', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      await createPromotion({ name: 'Group A - 5%', discountType: 'PERCENTAGE', discountValue: 5, stackGroup: 'SITEWIDE', priority: 10 });
      await createPromotion({ name: 'Group A - 20%', discountType: 'PERCENTAGE', discountValue: 20, stackGroup: 'SITEWIDE', priority: 1 });

      const headers = { 'x-guest-session-id': `guest-stack-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-stack-${counter}` }) });
      expect(res.statusCode).toBe(201);

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
      // Only the 20% (priority 1, applied first) promotion's redemption should exist.
      const redemptions = await testPrisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId } });
      expect(redemptions).toHaveLength(1);
      const winningPromo = await testPrisma.promotion.findUniqueOrThrow({ where: { id: redemptions[0]!.promotionId } });
      expect(winningPromo.name).toBe('Group A - 20%');
    });

    it('4. two automatic promotions in DIFFERENT stackGroups both apply (stack freely)', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(5000, ctx);
      await createPromotion({ name: 'Order discount', discountType: 'PERCENTAGE', discountValue: 5, stackGroup: 'ORDER' });
      await createPromotion({ name: 'Shipping-adjacent discount', discountType: 'FLAT_AMOUNT', discountValue: 100, stackGroup: 'SHIPPING' });

      const headers = { 'x-guest-session-id': `guest-multi-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-multi-${counter}` }) });
      expect(res.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
      const redemptions = await testPrisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId } });
      expect(redemptions).toHaveLength(2);
    });
  });

  // --- Coupons ---

  describe('Coupon codes', () => {
    it('5. a valid coupon code applies and stacks with a compatible (different stackGroup) automatic promotion', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Automatic 5%', discountType: 'PERCENTAGE', discountValue: 5, stackGroup: 'AUTO' });
      await createPromotion({ name: 'Welcome coupon', isCoupon: true, couponCode: 'WELCOME10', discountType: 'PERCENTAGE', discountValue: 10, stackGroup: 'COUPON' });

      const headers = { 'x-guest-session-id': `guest-coupon-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-coupon-${counter}`, couponCode: 'welcome10' }),
      });
      expect(res.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
      const redemptions = await testPrisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId } });
      expect(redemptions).toHaveLength(2); // both the automatic promo and the coupon
    });

    it('6. an invalid coupon code is rejected with a clear inline error at both preview and checkout', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const headers = { 'x-guest-session-id': `guest-invalid-${counter}` };
      await addToCart(skuId, headers);

      const previewRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout/preview',
        headers,
        payload: { shippingAddress: validAddress(), couponCode: 'DOES-NOT-EXIST' },
      });
      expect(previewRes.statusCode).toBe(400);
      expect(previewRes.json().error.message).toMatch(/not valid/i);

      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-invalid-${counter}`, couponCode: 'DOES-NOT-EXIST' }),
      });
      expect(checkoutRes.statusCode).toBe(400);
      // Reservations made before the coupon check must be released, not orphaned.
      expect(await testPrisma.inventoryReservation.count({ where: { status: 'ACTIVE' } })).toBe(0);
    });

    it('7. an expired coupon is rejected', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      await createPromotion({ isCoupon: true, couponCode: 'EXPIRED10', discountValue: 10, endsAt: new Date(Date.now() - 1000) });

      const headers = { 'x-guest-session-id': `guest-expired-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-expired-${counter}`, couponCode: 'EXPIRED10' }) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/expired/i);
    });

    it('8. a coupon conflicting with an already-eligible automatic promotion (same stackGroup) is rejected, and the automatic promotion remains applied on retry without the coupon', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Automatic sitewide', discountType: 'PERCENTAGE', discountValue: 15, stackGroup: 'SITEWIDE', priority: 1 });
      await createPromotion({ name: 'Conflicting coupon', isCoupon: true, couponCode: 'CONFLICT10', discountValue: 10, stackGroup: 'SITEWIDE', priority: 50 });

      const headers = { 'x-guest-session-id': `guest-conflict-${counter}` };
      await addToCart(skuId, headers);
      const rejectedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-conflict-a-${counter}`, couponCode: 'CONFLICT10' }),
      });
      expect(rejectedRes.statusCode).toBe(400);
      expect(rejectedRes.json().error.message).toMatch(/cannot be combined/i);

      // Retry without the coupon - the automatic promotion applies fine on its own.
      const acceptedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-conflict-b-${counter}` }),
      });
      expect(acceptedRes.statusCode).toBe(201);
      expect(acceptedRes.json().promotionDiscountTotal).toBeGreaterThan(0);
    });

    it('9. a coupon that has reached its total usage limit is rejected with a clear message', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(2000, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(2000, ctx);
      await createPromotion({ isCoupon: true, couponCode: 'ONEUSE', discountValue: 10, usageLimitTotal: 1 });

      const headersA = { 'x-guest-session-id': `guest-cap-a-${counter}` };
      await addToCart(skuA, headersA);
      const firstRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersA, payload: checkoutPayload({ idempotencyKey: `idem-cap-a-${counter}`, couponCode: 'ONEUSE' }) });
      expect(firstRes.statusCode).toBe(201);

      const headersB = { 'x-guest-session-id': `guest-cap-b-${counter}` };
      await addToCart(skuB, headersB);
      const secondRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersB, payload: checkoutPayload({ idempotencyKey: `idem-cap-b-${counter}`, couponCode: 'ONEUSE' }) });
      expect(secondRes.statusCode).toBe(400);
      expect(secondRes.json().error.message).toMatch(/usage limit/i);
    });

    it('10. a coupon usage-limit-per-customer is enforced across two different orders by the SAME customer', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(2000, ctx, 50);
      await createPromotion({ isCoupon: true, couponCode: 'ONCEPERCUSTOMER', discountValue: 10, usageLimitPerCustomer: 1 });
      const { token } = await createAuthenticatedCustomer(app);
      const headers = { authorization: `Bearer ${token}` };

      await addToCart(skuId, headers);
      const firstRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-perc-a-${counter}`, couponCode: 'ONCEPERCUSTOMER' }) });
      expect(firstRes.statusCode).toBe(201);

      await addToCart(skuId, headers);
      const secondRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-perc-b-${counter}`, couponCode: 'ONCEPERCUSTOMER' }) });
      expect(secondRes.statusCode).toBe(400);
      expect(secondRes.json().error.message).toMatch(/already used/i);
    });
  });

  // --- Pre-tax discount application (TAX-006) ---

  describe('Pre-tax discount application', () => {
    it('11. a flat-amount discount reduces each line taxable value PRE-TAX, and lines sum exactly to the session subtotal (no rounding drift)', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(1000, ctx);
      await createPromotion({ name: 'Flat 100 off', discountType: 'FLAT_AMOUNT', discountValue: 100 });

      const headers = { 'x-guest-session-id': `guest-pretax-${counter}` };
      await addToCart(skuId, headers, 3);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-pretax-${counter}` }) });
      expect(res.statusCode).toBe(201);

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id }, include: { lines: true } });
      expect(Number(order.promotionDiscountTotal)).toBe(100);
      const line = order.lines[0]!;
      expect(Number(line.discountAmountSnapshot)).toBe(100);
      // The line's own taxableValueSnapshot/taxAmountSnapshot were computed
      // from the DISCOUNTED inclusive amount, so their sum equals the
      // (already-discounted) lineTotalInclusive exactly.
      expect(Math.round((Number(line.taxableValueSnapshot) + Number(line.taxAmountSnapshot)) * 100) / 100).toBe(Number(line.lineTotalInclusive));
      // Original price preserved unchanged for invoice presentation.
      expect(Number(line.unitPriceInclusive)).toBe(1000);
    });
  });

  // --- Store credit at checkout (M24 reuse of M20 ledger) ---

  describe('Store credit at checkout', () => {
    async function customerWithStoreCredit(amount: number) {
      const { customerId, token } = await createAuthenticatedCustomer(app);
      const account = await testPrisma.storeCreditAccount.create({ data: { customerId, balance: amount } });
      await testPrisma.storeCreditEntry.create({ data: { accountId: account.id, type: 'ISSUE', amount, reason: 'Test credit', idempotencyKey: `test-issue-${customerId}` } });
      return { customerId, token, accountId: account.id };
    }

    it('12. store credit applied at checkout creates a REDEEM entry at order confirmation and reduces the balance', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const { token, accountId } = await customerWithStoreCredit(500);
      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);

      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-sc-${counter}`, storeCreditToApply: 300 }) });
      expect(res.statusCode).toBe(201);
      expect(res.json().storeCreditApplied).toBe(300);

      const hold = await testPrisma.storeCreditRedemptionHold.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
      expect(hold.status).toBe('CONVERTED');
      const redeemEntry = await testPrisma.storeCreditEntry.findFirst({ where: { accountId, type: 'REDEEM' } });
      expect(redeemEntry).toBeTruthy();
      expect(Number(redeemEntry!.amount)).toBe(300); // positive magnitude - type=REDEEM (not the sign) determines balance direction

      const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(Number(account.balance)).toBe(200);
    });

    it('13. requesting more store credit than available is rejected', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const { token } = await customerWithStoreCredit(100);
      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-sc-over-${counter}`, storeCreditToApply: 500 }) });
      expect(res.statusCode).toBe(400);
    });

    it('14. genuinely concurrent checkouts each spending most of the same store-credit balance converge to exactly one success, never a negative balance', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(3000, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(3000, ctx);
      const { token, accountId } = await customerWithStoreCredit(1000);
      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuA, headers);
      await addToCart(skuB, headers);

      const fire = (idempotencyKey: string) =>
        app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey, storeCreditToApply: 700 }) });

      const [resA, resB] = await Promise.all([fire(`idem-sc-race-a-${counter}`), fire(`idem-sc-race-b-${counter}`)]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 400]);

      const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { id: accountId } });
      expect(Number(account.balance)).toBeGreaterThanOrEqual(0);
      expect(Number(account.balance)).toBe(300);
    });

    it('15. genuinely concurrent checkouts racing the SAME single-use coupon converge to exactly one success, the other rejected with a clear message', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(2000, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(2000, ctx);
      await createPromotion({ isCoupon: true, couponCode: 'RACEONCE', discountValue: 10, usageLimitTotal: 1 });

      const headersA = { 'x-guest-session-id': `guest-race-a-${counter}` };
      const headersB = { 'x-guest-session-id': `guest-race-b-${counter}` };
      await addToCart(skuA, headersA);
      await addToCart(skuB, headersB);

      const fireA = () => app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersA, payload: checkoutPayload({ idempotencyKey: `idem-race-a-${counter}`, couponCode: 'RACEONCE' }) });
      const fireB = () => app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersB, payload: checkoutPayload({ idempotencyKey: `idem-race-b-${counter}`, couponCode: 'RACEONCE' }) });

      const [resA, resB] = await Promise.all([fireA(), fireB()]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 400]);
      const rejected = resA.statusCode === 400 ? resA : resB;
      expect(rejected.json().error.message).toMatch(/usage limit/i);

      const redemptions = await testPrisma.promotionRedemption.count({ where: { status: { in: ['HOLD', 'CONVERTED'] } } });
      expect(redemptions).toBe(1); // exactly one winner, never both, never neither
    });
  });

  // --- Cross-domain compatibility: promotion <-> loyalty / store credit
  // (M23/M24/M25 independent-review certification-repair, Blocker 2,
  // LOY-005/PROMO-002) ---

  describe('Cross-domain compatibility (promotion <-> loyalty / store credit)', () => {
    it('18. a promotion marked loyaltyCompatible (default true) combines with loyalty point redemption - both discounts apply, deterministic totals', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithLoyaltyPoints(100, ctx);
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Auto 10% (loyalty ok)', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000 });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-18-${counter}`, loyaltyPointsToRedeem: 100 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.promotionDiscountTotal).toBeGreaterThan(0);
      expect(body.loyaltyPointsRedeemed).toBe(100);
      // Server-authoritative: amountPayable must equal grandTotal minus the
      // loyalty redemption value minus store credit (0 here) - never a
      // client-trusted figure.
      expect(body.amountPayable).toBe(Math.round((body.grandTotal - (100 * 25) / 100) * 100) / 100);
    });

    it('19. a promotion marked loyaltyCompatible=false rejects a checkout attempting to combine it with loyalty redemption, naming the promotion; the same order succeeds with zero points redeemed', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithLoyaltyPoints(100, ctx);
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Auto 10% (no loyalty)', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000, loyaltyCompatible: false });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const rejectedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-19a-${counter}`, loyaltyPointsToRedeem: 100 }),
      });
      expect(rejectedRes.statusCode).toBe(400);
      expect(rejectedRes.json().error.message).toMatch(/cannot be combined with loyalty/i);
      expect(rejectedRes.json().error.message).toContain('Auto 10% (no loyalty)');

      const acceptedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-19b-${counter}` }),
      });
      expect(acceptedRes.statusCode).toBe(201);
      expect(acceptedRes.json().promotionDiscountTotal).toBeGreaterThan(0);
      expect(acceptedRes.json().loyaltyPointsRedeemed).toBe(0);
    });

    it('20. a coupon marked loyaltyCompatible (default true) combines with loyalty point redemption', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithLoyaltyPoints(100, ctx);
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Coupon (loyalty ok)', isCoupon: true, couponCode: 'XDLOY10', discountValue: 10 });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-20-${counter}`, couponCode: 'XDLOY10', loyaltyPointsToRedeem: 100 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().promotionDiscountTotal).toBeGreaterThan(0);
      expect(res.json().loyaltyPointsRedeemed).toBe(100);
    });

    it('21. a coupon marked loyaltyCompatible=false rejects a checkout attempting to combine it with loyalty redemption', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithLoyaltyPoints(100, ctx);
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      await createPromotion({ name: 'Coupon (no loyalty)', isCoupon: true, couponCode: 'XDNOLOY10', discountValue: 10, loyaltyCompatible: false });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-21-${counter}`, couponCode: 'XDNOLOY10', loyaltyPointsToRedeem: 100 }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/cannot be combined with loyalty/i);
    });

    it('22. a promotion marked storeCreditCompatible (default true) combines with store credit at checkout', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      const { token } = await customerWithStoreCreditBalance(500);
      await createPromotion({ name: 'Auto 10% (SC ok)', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000 });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-22-${counter}`, storeCreditToApply: 300 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().promotionDiscountTotal).toBeGreaterThan(0);
      expect(res.json().storeCreditApplied).toBe(300);
    });

    it('23. a promotion marked storeCreditCompatible=false rejects a checkout attempting to combine it with store credit; the same order succeeds with zero store credit applied', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(4000, ctx);
      const { token } = await customerWithStoreCreditBalance(500);
      await createPromotion({ name: 'Auto 10% (no SC)', discountType: 'PERCENTAGE', discountValue: 10, minCartValue: 1000, storeCreditCompatible: false });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const rejectedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-23a-${counter}`, storeCreditToApply: 300 }),
      });
      expect(rejectedRes.statusCode).toBe(400);
      expect(rejectedRes.json().error.message).toMatch(/cannot be combined with store credit/i);
      expect(rejectedRes.json().error.message).toContain('Auto 10% (no SC)');

      const acceptedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-23b-${counter}` }),
      });
      expect(acceptedRes.statusCode).toBe(201);
      expect(acceptedRes.json().promotionDiscountTotal).toBeGreaterThan(0);
      expect(acceptedRes.json().storeCreditApplied).toBe(0);
    });

    it('24. a coupon stacking with a compatible automatic promotion, both compatible with loyalty AND store credit, combined with real loyalty redemption and store credit at the same real checkout produces exactly the expected redemptions and deterministic server-authoritative totals', async () => {
      const ctx = await seedContext();
      const { token, accountId: scAccountId } = await customerWithStoreCreditBalance(500);
      // Give the SAME customer real earned loyalty points too, via a
      // second confirmed order on their own token (before any promotion
      // exists, so the earn amount is never itself discounted).
      const { skuId: seedSkuId } = await setupCheckoutableSku(100 * 100 + 200, ctx, 50);
      const seedHeaders = { authorization: `Bearer ${token}` };
      await addToCart(seedSkuId, seedHeaders);
      const seedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers: seedHeaders,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-24-seed-${counter}` }),
      });
      expect(seedRes.statusCode).toBe(201);

      const { skuId } = await setupCheckoutableSku(6000, ctx);
      await createPromotion({ name: 'Auto sitewide (compatible)', discountType: 'PERCENTAGE', discountValue: 5, stackGroup: 'AUTO', minCartValue: 1000 });
      await createPromotion({ name: 'Coupon (compatible)', isCoupon: true, couponCode: 'XDALL10', discountValue: 10, stackGroup: 'COUPON' });

      const headers = { authorization: `Bearer ${token}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-xd-24-${counter}`, couponCode: 'XDALL10', loyaltyPointsToRedeem: 100, storeCreditToApply: 300 }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();

      expect(body.promotionDiscountTotal).toBeGreaterThan(0);
      expect(body.loyaltyPointsRedeemed).toBe(100);
      expect(body.storeCreditApplied).toBe(300);
      // amountPayable is fully server-derived: grandTotal (already net of
      // both promotions, pre-tax per TAX-006) minus the loyalty redemption
      // value minus store credit applied - never a client-computed figure.
      const expectedLoyaltyValue = (100 * 25) / 100; // LOYALTY_REDEMPTION_PAISE_PER_POINT default = 25
      expect(body.amountPayable).toBe(Math.round((body.grandTotal - expectedLoyaltyValue - 300) * 100) / 100);

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: body.id } });
      const redemptions = await testPrisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId } });
      expect(redemptions).toHaveLength(2); // exactly the automatic promotion + the coupon, never a third

      const scAccount = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { id: scAccountId } });
      expect(Number(scAccount.balance)).toBe(200); // 500 - 300
    });
  });

  // --- Staff RBAC on the minimal promotion-management API ---

  describe('Staff RBAC', () => {
    it('16. creating a promotion requires promotion:manage; a caller without it is rejected', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read']);
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'x', promotionTypeKey: 'PROMOTIONAL', isCoupon: false, discountType: 'PERCENTAGE', discountValue: 5, startsAt: new Date().toISOString() },
      });
      expect(res.statusCode).toBe(403);
    });

    it('17. a promotion created via the real staff API is immediately usable at checkout', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(2000, ctx);
      await testPrisma.promotionType.upsert({ where: { key: 'CAMPAIGN' }, update: {}, create: { key: 'CAMPAIGN', name: 'Campaign coupon' } });
      const token = await merchandisingToken();
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'API-created coupon', promotionTypeKey: 'CAMPAIGN', isCoupon: true, couponCode: 'APICOUPON', discountType: 'FLAT_AMOUNT', discountValue: 50, startsAt: new Date(Date.now() - 1000).toISOString() },
      });
      expect(createRes.statusCode).toBe(201);

      const headers = { 'x-guest-session-id': `guest-api-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers, payload: checkoutPayload({ idempotencyKey: `idem-api-${counter}`, couponCode: 'APICOUPON' }) });
      expect(res.statusCode).toBe(201);
      expect(res.json().promotionDiscountTotal).toBe(50);
    });
  });
});
