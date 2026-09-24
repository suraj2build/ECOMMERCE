import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { PaymentService } from '../../src/modules/payment/service.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

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
    // A distinct Razorpay order id per call, not per test (real Razorpay
    // never issues the same order id for two independent order-creation
    // requests, e.g. the original attempt and a later retry-payment
    // attempt on the same checkout session) - required for the webhook
    // handler's providerReferenceId correlation to unambiguously resolve
    // to the correct Payment row when a session has more than one.
    let callCounter = 0;
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith('/orders') && init?.method === 'POST') {
        callCounter += 1;
        return new Response(JSON.stringify({ id: `order_mock_${orderCounter}_${callCounter}` }), { status: 200 });
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

  /**
   * Independent-review finding #3 (BLOCKER): a genuine Razorpay capture
   * can arrive at (or after) the same moment `expireStalePayments`/
   * `InventoryService.expireStaleReservations` releases this same
   * payment's reservation for real abandonment/timeout - both are
   * legitimate, concurrently-running processes reacting to real events,
   * not a client bug. These tests force each side of that race
   * deterministically (forging `createdAt`/`expiresAt` into the past,
   * same technique as the expiry-sweep test above) and prove the
   * resulting payment/reservation/session state machine never (a)
   * silently loses a captured payment, (b) fabricates an allocation the
   * physical stock no longer backs, (c) oversells, (d) releases
   * inventory out from under a capture that legitimately won the race,
   * or (e) produces more than one terminal outcome for the same event.
   */
  describe('Payment capture / reservation-expiry reconciliation (independent-review finding #3)', () => {
    it('A: expiry wins the race - a payment expired before its capture webhook arrives is recorded as CAPTURED but flagged for manual reconciliation, never fake-allocated', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-race-a', 'idem-race-a');
      const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });

      // Force the payment stale and run the expiry sweep to completion
      // FIRST - it legitimately wins, releasing the reservation - before
      // the (genuinely real, just slow-to-arrive) capture webhook shows up.
      await testPrisma.payment.updateMany({ where: { checkoutSessionId: sessionId }, data: { createdAt: new Date(Date.now() - 1_000_000) } });
      const paymentService = new PaymentService(app);
      expect(await paymentService.expireStalePayments()).toBe(1);

      const expiredReservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      expect(expiredReservation.status).toBe('RELEASED');

      const captureBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_a_1'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) },
        payload: captureBody,
      });
      // The webhook delivery itself still succeeds (200) - Razorpay must
      // never see a failure for an event we handled and recorded.
      expect(res.statusCode).toBe(200);

      const finalPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(finalPayment.status).toBe('CAPTURED'); // money is never silently dropped

      const finalSession = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(finalSession.status).toBe('CAPTURE_RECONCILIATION_REQUIRED');
      expect(finalSession.reconciliationReason).toBeTruthy();

      // Never fake-allocated: no order, reservation stays released, not
      // silently re-converted.
      const order = await testPrisma.order.findUnique({ where: { checkoutSessionId: sessionId } });
      expect(order).toBeNull();
      const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: expiredReservation.id } });
      expect(reservation.status).toBe('RELEASED');

      // Financial event is auditable, not just a log line.
      const auditEntry = await testPrisma.auditLog.findFirst({ where: { action: 'payment.captured.reconciliation_required', entityId: payment.id } });
      expect(auditEntry).not.toBeNull();
    });

    it('B: capture wins the race - a normal, already-confirmed capture is never undone by a stale-payment sweep that runs afterward', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-race-b', 'idem-race-b');

      const captureBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_b_1'));
      const captureRes = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) },
        payload: captureBody,
      });
      expect(captureRes.statusCode).toBe(200);

      const capturedPayment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(capturedPayment.status).toBe('CAPTURED');
      const convertedReservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      expect(convertedReservation.status).toBe('CONVERTED');

      // Now force the (already-captured) payment to LOOK stale by
      // createdAt, and run the sweep - it must find nothing to expire,
      // since `expireStalePayments` only ever selects `status: 'INITIATED'`.
      await testPrisma.payment.updateMany({ where: { checkoutSessionId: sessionId }, data: { createdAt: new Date(Date.now() - 1_000_000) } });
      const paymentService = new PaymentService(app);
      expect(await paymentService.expireStalePayments()).toBe(0);

      const finalPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: capturedPayment.id } });
      expect(finalPayment.status).toBe('CAPTURED');
      const finalSession = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(finalSession.status).toBe('CONFIRMED');
      const finalReservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: convertedReservation.id } });
      expect(finalReservation.status).toBe('CONVERTED'); // never released out from under the capture

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(order.status).toBe('CONFIRMED');
    });

    it('C: a genuinely concurrent capture and expiry-sweep on the same payment reach exactly one consistent terminal outcome, never a mixed/inconsistent state', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-race-c', 'idem-race-c');
      const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      const originalReservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });

      await testPrisma.payment.updateMany({ where: { checkoutSessionId: sessionId }, data: { createdAt: new Date(Date.now() - 1_000_000) } });

      const paymentService = new PaymentService(app);
      const captureBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_c_1'));

      // Genuinely concurrent: both transactions race to lock the same
      // Payment row (and, if the capture reaches it, the same
      // InventoryReservation row) at the same instant.
      const [webhookRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/razorpay',
          headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) },
          payload: captureBody,
        }),
        paymentService.expireStalePayments(),
      ]);
      expect(webhookRes.statusCode).toBe(200);

      const finalPayment = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      // Exactly one terminal outcome, and money is never lost regardless
      // of which side won.
      expect(finalPayment.status).toBe('CAPTURED');

      const finalSession = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      const finalReservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: originalReservation.id } });
      const order = await testPrisma.order.findUnique({ where: { checkoutSessionId: sessionId } });

      if (finalSession.status === 'CONFIRMED') {
        // Capture won: a real order exists, the reservation converted
        // into a firm allocation - never released.
        expect(order).not.toBeNull();
        expect(finalReservation.status).toBe('CONVERTED');
      } else {
        // Expiry won: no fake allocation was fabricated for a reservation
        // that is genuinely gone - flagged for reconciliation instead.
        expect(finalSession.status).toBe('CAPTURE_RECONCILIATION_REQUIRED');
        expect(order).toBeNull();
        expect(finalReservation.status).toBe('RELEASED');
      }

      // Never oversell/double-account while reconciling: `reserved`
      // reflects the ONE reservation exactly once, whichever side won -
      // never double-released (negative-clamped away) and never left
      // reserved for a session that also got a fresh reservation.
      const location = await testPrisma.location.findFirst({ where: { isActive: true } });
      const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId, locationId: location!.id } },
      });
      expect(balance.reserved).toBe(finalReservation.status === 'CONVERTED' ? originalReservation.quantity : 0);
    });

    it('D: a capture arriving for a reservation already released by some other path (not the expiry sweep) is flagged for reconciliation, not force-allocated, and creates no order', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-race-d', 'idem-race-d');
      const reservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });

      // Simulate the reservation having already been given up on through
      // a path other than the payment-expiry sweep (e.g. its own
      // independent TTL sweep, InventoryService.expireStaleReservations)
      // - directly, deterministically, without needing to also force the
      // Payment's own timeout.
      const inventory = new InventoryService(app);
      await inventory.releaseReservation(reservation.id, 'reservation TTL expired');

      const captureBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_d_1'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) },
        payload: captureBody,
      });
      expect(res.statusCode).toBe(200);

      const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(payment.status).toBe('CAPTURED');
      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('CAPTURE_RECONCILIATION_REQUIRED');
      const order = await testPrisma.order.findUnique({ where: { checkoutSessionId: sessionId } });
      expect(order).toBeNull();
    });

    it('E: two different webhook deliveries reporting the same late capture are idempotent - still exactly one payment, one reconciliation record, one audit entry', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { sessionId, orderId } = await startPrepaidCheckout(skuId, 'guest-race-e', 'idem-race-e');
      const reservation = await testPrisma.inventoryReservation.findFirstOrThrow({ where: { skuId } });
      const inventory = new InventoryService(app);
      await inventory.releaseReservation(reservation.id, 'reservation TTL expired');

      // Two DISTINCT Razorpay event ids, both reporting the same
      // underlying capture - not merely the same event id retried
      // (already covered by the PaymentEvent-level dedup test above).
      const firstBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_e_1'));
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(firstBody) },
        payload: firstBody,
      });
      expect(firstRes.statusCode).toBe(200);

      const secondBody = JSON.stringify(razorpayOrderCapturedEvent(orderId, 'pay_race_e_1'));
      const secondEvent = JSON.parse(secondBody);
      secondEvent.id = 'evt_pay_race_e_1_captured_retry';
      const secondBodyStr = JSON.stringify(secondEvent);
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(secondBodyStr) },
        payload: secondBodyStr,
      });
      expect(secondRes.statusCode).toBe(200);

      const payments = await testPrisma.payment.findMany({ where: { checkoutSessionId: sessionId } });
      expect(payments).toHaveLength(1);
      expect(payments[0]!.status).toBe('CAPTURED');

      const session = await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('CAPTURE_RECONCILIATION_REQUIRED');

      const order = await testPrisma.order.findUnique({ where: { checkoutSessionId: sessionId } });
      expect(order).toBeNull(); // still no duplicate/fabricated order

      const auditEntries = await testPrisma.auditLog.findMany({
        where: { action: 'payment.captured.reconciliation_required', entityId: payments[0]!.id },
      });
      expect(auditEntries).toHaveLength(1); // the second delivery was a true no-op, not a second flag
    });
  });
});
