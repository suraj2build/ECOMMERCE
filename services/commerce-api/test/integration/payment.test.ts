import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

// RazorpayPaymentProvider only fails safe to UNAVAILABLE when these are
// unset (@fcp/config's own default) - set before the first loadEnv()
// call in this file (buildApp(), in beforeAll) so RAZORPAY calls in
// these tests exercise the real code path (mocked at the fetch
// boundary, per ADR-0011's own stated testing approach), not the
// "coming soon" fallback the M13 checkout tests deliberately exercise.
process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.PAYMENT_TIMEOUT_SECONDS = '900';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}

function razorpayOrderCapturedEvent(orderId: string, paymentEntityId: string) {
  return {
    id: `evt_${paymentEntityId}_captured`,
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } },
  };
}

function razorpayOrderFailedEvent(orderId: string, paymentEntityId: string) {
  return {
    id: `evt_${paymentEntityId}_failed`,
    event: 'payment.failed',
    payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } },
  };
}

/**
 * M14 Payment (specs/13-payment.md, PAY-001..006). Financial-integrity
 * tests (idempotency, duplicate-webhook safety, signature verification)
 * are the highest-priority requirement of this milestone
 * (acceptance/m14-payment.md) - mandatory, automated, run in CI, not
 * manually verified once. Razorpay's HTTP boundary is mocked via
 * global.fetch (ADR-0011's own stated testing approach), never hitting
 * the real network.
 */
describe('Payment (M14)', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;
  let orderCounter = 0;

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

    orderCounter += 1;
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith('/orders') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: `order_mock_${orderCounter}` }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function seedCheckoutContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Payment Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLPAYTST${orderCounter}A1Z${orderCounter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function setupCheckoutableSku(sellingPrice: number) {
    const token = await merchandisingToken();
    const ctx = await seedCheckoutContext();

    const hsnCode = '6109';
    await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: `PAY-${Date.now()}-${orderCounter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Payment Test Jacket',
        brandId: ctx.brandId,
        categoryId: ctx.categoryId,
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
      payload: { styleId, mrp: sellingPrice, sellingPrice },
    });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: ctx.locationId, onHand: 10, reserved: 0 } });

    return skuId;
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  /** Starts a PREPAID checkout and returns its session id + the mocked Razorpay order id. */
  async function startPrepaidCheckout(skuId: string, guestId: string, idempotencyKey: string) {
    const headers = { [GUEST_HEADER]: guestId };
    await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });

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
        idempotencyKey,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('RESERVED');
    expect(body.payment.status).toBe('INITIATED');

    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: body.id } });
    return { sessionId: body.id as string, orderId: payment.providerReferenceId as string, headers };
  }

  describe('Razorpay order creation (real REST contract, mocked HTTP boundary)', () => {
    it('calls Razorpay to create an order and stores the order id as the correlation reference', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await startPrepaidCheckout(skuId, 'guest-pay-initiate', 'idem-pay-initiate');
      expect(orderId).toMatch(/^order_mock_/);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/orders'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('Webhook signature verification (PAY-002/003, negative scenario #3)', () => {
    it('rejects a webhook with an invalid signature, logs it, and makes no state change', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-pay-badsig', 'idem-pay-badsig');
      const body = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_badsig_1'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'not-a-real-signature' },
        payload: body,
      });
      expect(res.statusCode).toBe(400);

      const events = await testPrisma.paymentEvent.findMany();
      expect(events).toHaveLength(0);
      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('RESERVED');
    });

    it('rejects a webhook with no signature header at all', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await startPrepaidCheckout(skuId, 'guest-pay-nosig', 'idem-pay-nosig');
      const body = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_nosig_1'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Webhook capture flow', () => {
    it('a valid payment.captured webhook confirms the session and captures the payment', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-pay-capture', 'idem-pay-capture');
      const body = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_capture_1'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);

      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('CONFIRMED');
      expect(session.confirmedAt).not.toBeNull();

      const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(payment.status).toBe('CAPTURED');
      // Correlation id swapped from the order id to the actual payment id on capture.
      expect(payment.providerReferenceId).toBe('pay_capture_1');

      // CONVERTED, not ACTIVE - M15 converts the reservation to a
      // committed allocation in-process the moment capture confirms the
      // session (see checkout.test.ts's equivalent COD assertion).
      const reservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      expect(reservation.status).toBe('CONVERTED');
    });

    it('a duplicate delivery of the same captured webhook is a safe no-op (negative scenario #2)', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-pay-dupe', 'idem-pay-dupe');
      const body = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_dupe_1'));
      const headers = { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) };

      const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers, payload: body });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers, payload: body });
      expect(second.statusCode).toBe(200);
      expect(second.json().duplicate).toBe(true);

      const events = await testPrisma.paymentEvent.findMany({ where: { providerEventId: `evt_pay_dupe_1_captured` } });
      expect(events).toHaveLength(1);

      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('CONFIRMED');

      const auditEntries = await testPrisma.auditLog.findMany({ where: { action: 'payment.captured', entityId: (await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } })).id } });
      expect(auditEntries).toHaveLength(1);
    });
  });

  describe('Webhook failure flow + retry (PAY-005, negative scenario #1)', () => {
    it('a failed payment does not release the reservation, and the customer can retry successfully from the same session', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId, headers } = await startPrepaidCheckout(skuId, 'guest-pay-retry', 'idem-pay-retry');
      const failBody = JSON.stringify(razorpayOrderFailedEvent(orderId, 'pay_retry_fail_1'));

      const failRes = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(failBody) },
        payload: failBody,
      });
      expect(failRes.statusCode).toBe(200);

      let session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('PAYMENT_FAILED');
      const failedPayment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(failedPayment.status).toBe('FAILED');

      // Reservation preserved through the retry window - not released by a failed attempt.
      const reservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      expect(reservation.status).toBe('ACTIVE');

      const retryRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/checkout/${sessionId}/retry-payment`,
        headers,
        payload: { idempotencyKey: 'idem-pay-retry-2' },
      });
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().status).toBe('RESERVED');
      expect(retryRes.json().payment.status).toBe('INITIATED');

      session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('RESERVED');

      // Exactly one CheckoutSession exists throughout (no new order created by retry).
      const sessions = await testPrisma.checkoutSession.findMany({ where: { customerId: null, guestSessionId: 'guest-pay-retry' } });
      expect(sessions).toHaveLength(1);

      // Two Payment rows now exist for this session (the failed attempt + the retry) - same reservation throughout.
      const payments = await testPrisma.payment.findMany({ where: { checkoutSessionId: sessionId }, orderBy: { createdAt: 'asc' } });
      expect(payments).toHaveLength(2);
      expect(payments[0]!.status).toBe('FAILED');
      expect(payments[1]!.status).toBe('INITIATED');

      const reservationsAfterRetry = await testPrisma.inventoryReservation.findMany({ where: { skuId } });
      expect(reservationsAfterRetry).toHaveLength(1); // still the original single reservation

      // Now actually complete the retried payment via a capture webhook, proving the full retry-then-succeed path.
      const captureBody = JSON.stringify(razorpayOrderCapturedEvent(payments[1]!.providerReferenceId!, 'pay_retry_capture_1'));
      const captureRes = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) },
        payload: captureBody,
      });
      expect(captureRes.statusCode).toBe(200);
      session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('CONFIRMED');
    });

    it('rejects a retry attempt on a session that was never in a failed/retriable state', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, headers } = await startPrepaidCheckout(skuId, 'guest-pay-badretry', 'idem-pay-badretry');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/checkout/${sessionId}/retry-payment`,
        headers,
        payload: { idempotencyKey: 'idem-pay-badretry-2' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Payment expiry sweep (PAY-005, negative scenario #4)', () => {
    it('expires a Payment stuck in INITIATED beyond the configured timeout, distinct from FAILED, and releases its reservation', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId } = await startPrepaidCheckout(skuId, 'guest-pay-expire', 'idem-pay-expire');

      // Force the payment to look stale without waiting real time.
      await testPrisma.payment.updateMany({
        where: { checkoutSessionId: sessionId },
        data: { createdAt: new Date(Date.now() - 1_000_000) },
      });

      const { PaymentService } = await import('../../src/modules/payment/service.js');
      const paymentService = new PaymentService(app);
      const count = await paymentService.expireStalePayments();
      expect(count).toBe(1);

      const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(payment.status).toBe('EXPIRED');
      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('EXPIRED');

      const reservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      expect(reservation.status).toBe('RELEASED');
    });
  });
});
