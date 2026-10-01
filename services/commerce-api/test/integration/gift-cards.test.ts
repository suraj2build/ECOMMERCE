import { createHash, createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';
import { GiftCardService } from '../../src/modules/gift-cards/service.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.COD_MAX_ORDER_VALUE_INR = '50000';

const SERVICEABLE_PINCODE = '110001';

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}

function razorpayCapturedEvent(orderId: string, paymentEntityId: string) {
  return { id: `evt_${paymentEntityId}_captured`, event: 'payment.captured', payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } } };
}
function razorpayFailedEvent(orderId: string, paymentEntityId: string) {
  return { id: `evt_${paymentEntityId}_failed`, event: 'payment.failed', payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } } };
}

/**
 * Gift Cards (M30, specs/33-store-credit-gift-cards.md) adversarial
 * certification. Covers issuance/disable/adjustment/refund-to-gift-card
 * ledger operations, checkout-time redemption (preview/reserve/convert/
 * release mirroring StoreCreditService's own hold lifecycle), genuine
 * concurrency (a redemption-balance overspend race under real Postgres),
 * the M30-required amountPayable<=0 zero-payment repair (a gift card
 * covering the full payable amount), the purchase flow end to end
 * (Razorpay mocked at the fetch boundary, ADR-0011's own testing
 * approach), staff RBAC, and audit-payload secret-leak prevention.
 */
describe('Gift Cards (M30)', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;
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
    let callCounter = 0;
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith('/orders') && init?.method === 'POST') {
        callCounter += 1;
        return new Response(JSON.stringify({ id: `order_mock_${counter}_${callCounter}` }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  async function financeToken() {
    await grantPermissions('FINANCE', ['giftcard:manage', 'giftcard:read']);
    return (await createAuthenticatedStaff(app, ['FINANCE'])).token;
  }
  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write', 'promotion:manage', 'promotion:read']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }
  // No giftcard:* permission at all - used to prove unauthorized staff
  // cannot mutate or even read gift cards.
  async function unauthorizedStaffToken() {
    return (await createAuthenticatedStaff(app, ['CATALOG'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Gift Card Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLGCTST${counter}A1Z${counter % 10}`,
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
      payload: { styleCode: `GC-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, name: 'Gift Card Test Jacket', brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core', hsnCode },
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
  async function addToCart(skuId: string, headers: Record<string, string>) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });
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

  // A test-only fixture: creates a GiftCard row + ISSUE entry directly
  // (bypassing the service's code-generation path so the test controls
  // the plaintext code), the same idiom promotions.test.ts's own
  // `customerWithStoreCredit` helper uses for StoreCreditAccount.
  async function giftCardWithBalance(amount: number, code = `GC-TEST-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`) {
    const codeHash = hashCode(code);
    const giftCard = await testPrisma.giftCard.create({
      data: { codeHash, codeLast4: code.slice(-4), initialValue: amount, balance: amount, issuedAt: new Date() },
    });
    await testPrisma.giftCardLedgerEntry.create({
      data: { giftCardId: giftCard.id, type: 'ISSUE', amount, balanceAfter: amount, reason: 'Test issue', idempotencyKey: `test-issue-${giftCard.id}` },
    });
    return { giftCard, code };
  }

  // --- Ledger operations ---

  it('1. staff-issued gift card creates a GiftCard row + ISSUE entry with a correctly-hashed code, and the plaintext code is returned exactly once', async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gift-cards/issue',
      headers: { authorization: `Bearer ${token}` },
      payload: { initialValue: 1000, idempotencyKey: `issue-${counter}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBeTruthy();
    expect(body.giftCard.balance).toBe(1000);
    expect(body.giftCard.status).toBe('ACTIVE');

    const stored = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: body.giftCard.id } });
    expect(stored.codeHash).toBe(hashCode(body.code));
    // The stored row never contains the plaintext code anywhere.
    expect(JSON.stringify(stored)).not.toContain(body.code);
  });

  it('2. issuance is idempotent - a replayed idempotencyKey never creates a second gift card', async () => {
    const token = await financeToken();
    const idempotencyKey = `issue-dup-${counter}`;
    const res1 = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: { authorization: `Bearer ${token}` }, payload: { initialValue: 500, idempotencyKey } });
    const res2 = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: { authorization: `Bearer ${token}` }, payload: { initialValue: 500, idempotencyKey } });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.json().giftCard.id).toBe(res2.json().giftCard.id);
    // The replay never re-reveals the plaintext code.
    expect(res2.json().code).toBeFalsy();

    const count = await testPrisma.giftCard.count();
    expect(count).toBe(1);
  });

  it('3. a manual credit adjustment increases the balance, a debit decreases it, and it cannot go negative', async () => {
    const token = await financeToken();
    const { giftCard } = await giftCardWithBalance(500);

    const credit = await app.inject({
      method: 'POST',
      url: `/api/v1/gift-cards/${giftCard.id}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: 200, reason: 'Goodwill top-up', idempotencyKey: `adj-credit-${counter}` },
    });
    expect(credit.statusCode).toBe(200);
    let fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(700);

    const debit = await app.inject({
      method: 'POST',
      url: `/api/v1/gift-cards/${giftCard.id}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: -100, reason: 'Correction', idempotencyKey: `adj-debit-${counter}` },
    });
    expect(debit.statusCode).toBe(200);
    fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(600);

    const overDebit = await app.inject({
      method: 'POST',
      url: `/api/v1/gift-cards/${giftCard.id}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { delta: -10000, reason: 'Bad correction', idempotencyKey: `adj-overdebit-${counter}` },
    });
    expect(overDebit.statusCode).toBe(400);
    fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(600); // unchanged - the rejected attempt never partially applied
  });

  it('4. refund-to-gift-card credits the balance with a distinct REFUND_TO_GIFT_CARD ledger entry', async () => {
    const token = await financeToken();
    const { giftCard } = await giftCardWithBalance(200);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gift-cards/${giftCard.id}/refund-to-gift-card`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 150, referenceType: 'RETURN', referenceId: 'ret-123', idempotencyKey: `refund-${counter}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe('REFUND_TO_GIFT_CARD');

    const fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(350);
    const entries = await testPrisma.giftCardLedgerEntry.findMany({ where: { giftCardId: giftCard.id } });
    expect(entries.map((e) => e.type).sort()).toEqual(['ISSUE', 'REFUND_TO_GIFT_CARD']);
  });

  it('5. disabling a gift card marks it DISABLED and it can no longer be redeemed', async () => {
    const token = await financeToken();
    const { giftCard, code } = await giftCardWithBalance(500);
    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/gift-cards/${giftCard.id}/disable`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Suspected fraud' },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json().status).toBe('DISABLED');

    const service = new GiftCardService(app);
    await expect(service.previewRedemptionValue(code, 100, 1000)).rejects.toThrow(/invalid or unavailable/i);
  });

  // --- Checkout-time redemption ---

  it('6. a gift card applied at checkout creates a REDEEM entry at order confirmation and reduces the balance (partial redemption)', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(3000, ctx);
    const { giftCard, code } = await giftCardWithBalance(500);
    const headers = { 'x-guest-session-id': `guest-gc-${counter}` };
    await addToCart(skuId, headers);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-${counter}`, giftCardCode: code, giftCardAmountToApply: 300 }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().giftCardApplied).toBe(300);

    const hold = await testPrisma.giftCardRedemptionHold.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    expect(hold.status).toBe('CONVERTED');
    const redeemEntry = await testPrisma.giftCardLedgerEntry.findFirst({ where: { giftCardId: giftCard.id, type: 'REDEEM' } });
    expect(redeemEntry).toBeTruthy();
    expect(Number(redeemEntry!.amount)).toBe(300);

    const fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(200);
  });

  it('7. requesting more than the gift card balance is rejected with a generic (non-enumerating) error', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(3000, ctx);
    const { code } = await giftCardWithBalance(100);
    const headers = { 'x-guest-session-id': `guest-gc-over-${counter}` };
    await addToCart(skuId, headers);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-over-${counter}`, giftCardCode: code, giftCardAmountToApply: 500 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/invalid or unavailable/i);
  });

  it('8. a disabled or non-existent gift card code is rejected with the SAME generic error (no enumeration signal)', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(1000, ctx);
    const { code: disabledCode, giftCard } = await giftCardWithBalance(500);
    await testPrisma.giftCard.update({ where: { id: giftCard.id }, data: { status: 'DISABLED' } });

    const headersDisabled = { 'x-guest-session-id': `guest-disabled-${counter}` };
    await addToCart(skuId, headersDisabled);
    const resDisabled = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers: headersDisabled,
      payload: checkoutPayload({ idempotencyKey: `idem-disabled-${counter}`, giftCardCode: disabledCode, giftCardAmountToApply: 100 }),
    });

    const headersUnknown = { 'x-guest-session-id': `guest-unknown-${counter}` };
    await addToCart(skuId, headersUnknown);
    const resUnknown = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers: headersUnknown,
      payload: checkoutPayload({ idempotencyKey: `idem-unknown-${counter}`, giftCardCode: 'GC-NOPE-NOPE-NOPE', giftCardAmountToApply: 100 }),
    });

    expect(resDisabled.statusCode).toBe(400);
    expect(resUnknown.statusCode).toBe(400);
    expect(resDisabled.json().error.message).toBe(resUnknown.json().error.message);
  });

  it('9. genuinely concurrent checkouts each spending most of the same gift card balance converge to exactly one success, never a negative balance', async () => {
    const ctx = await seedContext();
    const { skuId: skuA } = await setupCheckoutableSku(3000, ctx);
    const { skuId: skuB } = await setupCheckoutableSku(3000, ctx);
    const { giftCard, code } = await giftCardWithBalance(1000);
    const headersA = { 'x-guest-session-id': `guest-gc-race-a-${counter}` };
    const headersB = { 'x-guest-session-id': `guest-gc-race-b-${counter}` };
    await addToCart(skuA, headersA);
    await addToCart(skuB, headersB);

    const fireA = () =>
      app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersA, payload: checkoutPayload({ idempotencyKey: `idem-gc-race-a-${counter}`, giftCardCode: code, giftCardAmountToApply: 700 }) });
    const fireB = () =>
      app.inject({ method: 'POST', url: '/api/v1/storefront/checkout', headers: headersB, payload: checkoutPayload({ idempotencyKey: `idem-gc-race-b-${counter}`, giftCardCode: code, giftCardAmountToApply: 700 }) });

    // Both promises created before either is awaited - genuine
    // concurrent execution against real Postgres, the row-lock inside
    // GiftCardService.reserveRedemptionForCheckout is what makes this
    // converge correctly, never application-level serialization.
    const [resA, resB] = await Promise.all([fireA(), fireB()]);
    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([201, 400]);

    const fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBeGreaterThanOrEqual(0);
    expect(Number(fresh.balance)).toBe(300); // exactly one 700 redemption succeeded
  });

  it('10. a gift card covering the FULL payable amount confirms the order immediately with no payment-provider call (amountPayable<=0 repair)', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(500, ctx); // small enough for a 1000-value gift card to fully cover
    const { code } = await giftCardWithBalance(1000);
    const headers = { 'x-guest-session-id': `guest-gc-full-${counter}` };
    await addToCart(skuId, headers);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-full-${counter}`, paymentMethod: 'PREPAID', giftCardCode: code, giftCardAmountToApply: 1000 }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('CONFIRMED');
    // Razorpay's own order-creation endpoint was never called - the
    // reduction chain already brought amountPayable to exactly 0. (Other
    // fetch calls, e.g. best-effort Meilisearch reindexing from the
    // product-publish setup step above, are unrelated and expected.)
    const razorpayOrderCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/orders'));
    expect(razorpayOrderCalls).toHaveLength(0);

    const order = await testPrisma.order.findFirst({ where: { checkoutSessionId: res.json().id } });
    expect(order).toBeTruthy();
    expect(Number(order!.giftCardApplied)).toBe(599); // subtotal (500) + default flat shipping (99) - only what was actually needed, never the full 1000 requested
  });

  it('11. a gift card combined with COD covers part of the total, the remainder is genuinely due on delivery', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(3000, ctx);
    const { code } = await giftCardWithBalance(1000);
    const headers = { 'x-guest-session-id': `guest-gc-partial-${counter}` };
    await addToCart(skuId, headers);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-partial-${counter}`, giftCardCode: code, giftCardAmountToApply: 800 }),
    });
    expect(res.statusCode).toBe(201);
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: res.json().id } });
    expect(payment.provider).toBe('COD');
    expect(payment.status).toBe('CONFIRMED');
    expect(Number(payment.amount)).toBeGreaterThan(0); // the genuine remainder, not the full subtotal
    expect(Number(payment.amount)).toBeLessThan(3000);
  });

  it('12. a promotion marked incompatible with gift cards rejects the combination when a gift card is actually applied', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(3000, ctx);
    const promotionType = await testPrisma.promotionType.upsert({ where: { key: 'PROMOTIONAL' }, update: {}, create: { key: 'PROMOTIONAL', name: 'Promotional' } });
    await testPrisma.promotion.create({
      data: {
        name: 'No Gift Cards Promo',
        promotionTypeId: promotionType.id,
        isCoupon: true,
        couponCode: 'NOGIFTCARD',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        priority: 100,
        startsAt: new Date(Date.now() - 86_400_000),
        isActive: true,
        giftCardCompatible: false,
      },
    });
    const { code } = await giftCardWithBalance(500);
    const headers = { 'x-guest-session-id': `guest-gc-incompat-${counter}` };
    await addToCart(skuId, headers);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-incompat-${counter}`, couponCode: 'NOGIFTCARD', giftCardCode: code, giftCardAmountToApply: 300 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/cannot be combined with a gift card/i);
  });

  it('13. a replayed/double-converted redemption hold never double-debits the balance', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(1000, ctx);
    const { giftCard, code } = await giftCardWithBalance(500);
    const headers = { 'x-guest-session-id': `guest-gc-replay-${counter}` };
    await addToCart(skuId, headers);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-gc-replay-${counter}`, giftCardCode: code, giftCardAmountToApply: 300 }),
    });
    expect(res.statusCode).toBe(201);
    const order = await testPrisma.order.findFirstOrThrow({ where: { checkoutSessionId: res.json().id } });

    // A direct second call to convertRedemptionHold - simulating a
    // retried/duplicated order-creation trigger - must be a safe no-op
    // (the hold is already CONVERTED, and the entry's own deterministic
    // idempotencyKey guards the ledger write itself).
    const service = new GiftCardService(app);
    await testPrisma.$transaction((tx) => service.convertRedemptionHold(tx, order));

    const fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(200); // unchanged from the first, genuine conversion
    const redeemEntries = await testPrisma.giftCardLedgerEntry.count({ where: { giftCardId: giftCard.id, type: 'REDEEM' } });
    expect(redeemEntries).toBe(1);
  });

  it('14. the stale-hold sweep releases an expired ACTIVE hold without spending anything', async () => {
    const { giftCard } = await giftCardWithBalance(500);
    const checkoutSession = await testPrisma.checkoutSession.create({
      data: {
        guestSessionId: `sweep-guest-${counter}`,
        contactName: 'Sweep Test',
        contactMobile: '9876543210',
        billingAddress: {},
        shippingAddress: {},
        shippingStateCode: 'DL',
        shippingCost: 0,
        subtotal: 500,
        taxAmount: 0,
        grandTotal: 500,
        paymentMethod: 'COD',
        status: 'PAYMENT_FAILED',
        idempotencyKey: `sweep-idem-${counter}`,
      },
    });
    await testPrisma.giftCardRedemptionHold.create({
      data: { giftCardId: giftCard.id, checkoutSessionId: checkoutSession.id, amount: 300, expiresAt: new Date(Date.now() - 60_000) },
    });

    const token = await financeToken();
    const res = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/sweep/release-stale-holds', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().released).toBeGreaterThanOrEqual(1);

    const hold = await testPrisma.giftCardRedemptionHold.findFirstOrThrow({ where: { giftCardId: giftCard.id } });
    expect(hold.status).toBe('RELEASED');
    const fresh = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
    expect(Number(fresh.balance)).toBe(500); // untouched - a released hold never spends anything
  });

  // --- RBAC ---

  it('15. a staff member without giftcard:manage cannot issue, disable, or adjust a gift card', async () => {
    const token = await unauthorizedStaffToken();
    const { giftCard } = await giftCardWithBalance(500);

    const issueRes = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: { authorization: `Bearer ${token}` }, payload: { initialValue: 100, idempotencyKey: `unauth-issue-${counter}` } });
    const disableRes = await app.inject({ method: 'POST', url: `/api/v1/gift-cards/${giftCard.id}/disable`, headers: { authorization: `Bearer ${token}` }, payload: { reason: 'x' } });
    const adjustRes = await app.inject({ method: 'POST', url: `/api/v1/gift-cards/${giftCard.id}/adjust`, headers: { authorization: `Bearer ${token}` }, payload: { delta: 10, reason: 'x', idempotencyKey: `unauth-adj-${counter}` } });

    expect(issueRes.statusCode).toBe(403);
    expect(disableRes.statusCode).toBe(403);
    expect(adjustRes.statusCode).toBe(403);
  });

  it('16. a staff member without giftcard:read cannot view a gift card, and an unauthenticated request is rejected', async () => {
    const token = await unauthorizedStaffToken();
    const { giftCard } = await giftCardWithBalance(500);
    const res = await app.inject({ method: 'GET', url: `/api/v1/gift-cards/${giftCard.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);

    const noAuthRes = await app.inject({ method: 'GET', url: `/api/v1/gift-cards/${giftCard.id}` });
    expect(noAuthRes.statusCode).toBe(401);
  });

  // --- Audit secret-leak prevention ---

  it('17. audit payloads for gift-card issue/redeem events never contain the plaintext code or its hash', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(1000, ctx);
    const token = await financeToken();
    const issueRes = await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: { authorization: `Bearer ${token}` }, payload: { initialValue: 500, idempotencyKey: `audit-issue-${counter}` } });
    const { code, id: giftCardId } = issueRes.json().giftCard.id ? { id: issueRes.json().giftCard.id, code: issueRes.json().code } : { id: '', code: '' };
    const codeHash = hashCode(code);

    const headers = { 'x-guest-session-id': `guest-audit-${counter}` };
    await addToCart(skuId, headers);
    await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-audit-${counter}`, giftCardCode: code, giftCardAmountToApply: 200 }),
    });

    const auditRows = await testPrisma.auditLog.findMany({ where: { entityType: 'GiftCard', entityId: giftCardId } });
    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      const payload = JSON.stringify(row);
      expect(payload).not.toContain(code);
      expect(payload.toLowerCase()).not.toContain(codeHash.toLowerCase());
    }
  });

  // --- Purchase flow (end to end, Razorpay mocked at the fetch boundary) ---

  it('18. a captured gift-card purchase webhook mints a real, redeemable gift card with the correct balance', async () => {
    const { customerId, token } = await createAuthenticatedCustomer(app);
    const purchaseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/gift-cards/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 1000, idempotencyKey: `purchase-${counter}` },
    });
    expect(purchaseRes.statusCode).toBe(201);
    const purchase = purchaseRes.json();
    expect(purchase.status).toBe('INITIATED');
    expect(fetchMock).toHaveBeenCalled();

    const paymentEntityId = `pay_gc_${counter}`;
    const event = razorpayCapturedEvent(purchase.providerReferenceId, paymentEntityId);
    const rawBody = JSON.stringify(event);
    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'x-razorpay-signature': signWebhook(rawBody), 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(webhookRes.statusCode).toBe(200);

    const dbPurchase = await testPrisma.giftCardPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(dbPurchase.status).toBe('CAPTURED');
    expect(dbPurchase.giftCardId).toBeTruthy();
    const giftCard = await testPrisma.giftCard.findUniqueOrThrow({ where: { id: dbPurchase.giftCardId! } });
    expect(Number(giftCard.balance)).toBe(1000);
    expect(giftCard.purchasedByCustomerId).toBe(customerId);

    // A redelivery of the SAME webhook event id is a safe no-op - never
    // a second gift card, never a duplicate ISSUE entry.
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'x-razorpay-signature': signWebhook(rawBody), 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(replayRes.statusCode).toBe(200);
    const giftCardCount = await testPrisma.giftCard.count({ where: { purchasedByCustomerId: customerId } });
    expect(giftCardCount).toBe(1);
  });

  it('19. a failed gift-card purchase webhook never mints a gift card', async () => {
    const headers = { 'x-guest-session-id': `guest-purchase-fail-${counter}` };
    const purchaseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/gift-cards/purchase',
      headers,
      payload: { amount: 500, idempotencyKey: `purchase-fail-${counter}` },
    });
    expect(purchaseRes.statusCode).toBe(201);
    const purchase = purchaseRes.json();

    const event = razorpayFailedEvent(purchase.providerReferenceId, `pay_gc_fail_${counter}`);
    const rawBody = JSON.stringify(event);
    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'x-razorpay-signature': signWebhook(rawBody), 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(webhookRes.statusCode).toBe(200);

    const dbPurchase = await testPrisma.giftCardPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(dbPurchase.status).toBe('FAILED');
    expect(dbPurchase.giftCardId).toBeNull();
    const giftCardCount = await testPrisma.giftCard.count();
    expect(giftCardCount).toBe(0);
  });

  it('20. gift-card issuance/redemption never writes to any other domain ledger (StoreCreditEntry/LoyaltyLedgerEntry untouched)', async () => {
    const ctx = await seedContext();
    const { skuId } = await setupCheckoutableSku(1000, ctx);
    const token = await financeToken();
    await app.inject({ method: 'POST', url: '/api/v1/gift-cards/issue', headers: { authorization: `Bearer ${token}` }, payload: { initialValue: 500, idempotencyKey: `isolation-issue-${counter}` } });

    const { code } = await giftCardWithBalance(500);
    const headers = { 'x-guest-session-id': `guest-isolation-${counter}` };
    await addToCart(skuId, headers);
    await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: checkoutPayload({ idempotencyKey: `idem-isolation-${counter}`, giftCardCode: code, giftCardAmountToApply: 300 }),
    });

    expect(await testPrisma.storeCreditEntry.count()).toBe(0);
    expect(await testPrisma.loyaltyLedgerEntry.count()).toBe(0);
  });

  // --- P1 decision D-2 (2026-10-01): staff choose gift-card compatibility ---
  // POST /promotions now accepts giftCardCompatible. Omitted keeps the
  // existing default (combinable); checkout reads only the persisted value.

  describe('D-2 promotion gift-card compatibility is set through the promotions API', () => {
    async function createPromotion(token: string, overrides: Record<string, unknown> = {}) {
      await testPrisma.promotionType.upsert({ where: { key: 'PROMOTIONAL' }, update: {}, create: { key: 'PROMOTIONAL', name: 'Promotional' } });
      return app.inject({
        method: 'POST',
        url: '/api/v1/promotions',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: `D2 promo ${counter}`,
          promotionTypeKey: 'PROMOTIONAL',
          isCoupon: true,
          couponCode: `D2C${counter}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date(Date.now() - 86_400_000).toISOString(),
          ...overrides,
        },
      });
    }

    async function checkoutWithCoupon(couponCode: string, extra: Record<string, unknown> = {}) {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const { giftCard, code } = await giftCardWithBalance(500);
      const headers = { 'x-guest-session-id': `guest-d2-${counter}-${Math.random().toString(36).slice(2, 6)}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-d2-${counter}-${Math.random()}`, couponCode, giftCardCode: code, giftCardAmountToApply: 300, ...extra }),
      });
      return { res, giftCard };
    }

    it('omitting giftCardCompatible keeps the existing default (true) and the read returns it', async () => {
      const token = await merchandisingToken();
      const res = await createPromotion(token);
      expect(res.statusCode).toBe(201);
      expect(res.json().giftCardCompatible).toBe(true);
      const read = await app.inject({ method: 'GET', url: `/api/v1/promotions/${res.json().id}`, headers: { authorization: `Bearer ${token}` } });
      expect(read.json().giftCardCompatible).toBe(true);
    });

    it('explicit false and explicit true are persisted as given', async () => {
      const token = await merchandisingToken();
      const off = await createPromotion(token, { giftCardCompatible: false });
      const on = await createPromotion(token, { giftCardCompatible: true });
      expect(off.statusCode).toBe(201);
      expect(on.statusCode).toBe(201);
      expect((await testPrisma.promotion.findUniqueOrThrow({ where: { id: off.json().id } })).giftCardCompatible).toBe(false);
      expect((await testPrisma.promotion.findUniqueOrThrow({ where: { id: on.json().id } })).giftCardCompatible).toBe(true);
    });

    it('rejects a non-boolean giftCardCompatible with 400 and creates nothing', async () => {
      const token = await merchandisingToken();
      for (const value of ['false', 0, 1, null, 'yes']) {
        const res = await createPromotion(token, { giftCardCompatible: value });
        expect(res.statusCode, JSON.stringify(value)).toBe(400);
      }
      expect(await testPrisma.promotion.count()).toBe(0);
    });

    it('a staff member without promotion:manage cannot create a promotion with the setting', async () => {
      await grantPermissions('MARKETING', ['promotion:read']);
      const { token } = await createAuthenticatedStaff(app, ['MARKETING']);
      const res = await createPromotion(token, { giftCardCompatible: false });
      expect(res.statusCode).toBe(403);
      expect(await testPrisma.promotion.count()).toBe(0);
    });

    it('checkout refuses a gift card with a promotion created as not combinable', async () => {
      const token = await merchandisingToken();
      const promo = (await createPromotion(token, { giftCardCompatible: false })).json();
      const { res, giftCard } = await checkoutWithCoupon(promo.couponCode);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/cannot be combined with a gift card/i);
      expect(await testPrisma.giftCardRedemptionHold.count({ where: { giftCardId: giftCard.id } })).toBe(0);
      expect(Number((await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } })).balance)).toBe(500);
    });

    it('checkout combines a gift card with a promotion created as combinable, and the gift card is debited once', async () => {
      const token = await merchandisingToken();
      const promo = (await createPromotion(token, { giftCardCompatible: true })).json();
      const { res, giftCard } = await checkoutWithCoupon(promo.couponCode);
      expect(res.statusCode).toBe(201);
      const order = await testPrisma.order.findFirstOrThrow({ where: { checkoutSessionId: res.json().id } });
      expect(await testPrisma.promotionRedemption.count({ where: { promotionId: promo.id, status: 'CONVERTED' } })).toBe(1);
      expect(Number((await testPrisma.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } })).balance)).toBe(200);
      expect(await testPrisma.giftCardLedgerEntry.count({ where: { giftCardId: giftCard.id, type: 'REDEEM' } })).toBe(1);
      expect(order.id).toBeDefined();
    });

    it('a checkout request cannot override the persisted setting', async () => {
      const token = await merchandisingToken();
      const promo = (await createPromotion(token, { giftCardCompatible: false })).json();
      const { res } = await checkoutWithCoupon(promo.couponCode, { giftCardCompatible: true, promotions: [{ id: promo.id, giftCardCompatible: true }] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/cannot be combined with a gift card/i);
    });

    it('a not-combinable promotion still applies normally when no gift card is used', async () => {
      const token = await merchandisingToken();
      const promo = (await createPromotion(token, { giftCardCompatible: false })).json();
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const headers = { 'x-guest-session-id': `guest-d2-nogc-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: checkoutPayload({ idempotencyKey: `idem-d2-nogc-${counter}`, couponCode: promo.couponCode }),
      });
      expect(res.statusCode).toBe(201);
      expect(await testPrisma.promotionRedemption.count({ where: { promotionId: promo.id, status: 'CONVERTED' } })).toBe(1);
    });
  });
});
