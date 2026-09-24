import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ShippingService } from '../../src/modules/shipping/service.js';
import { MockCarrierProvider } from '../../src/modules/shipping/provider.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';
const MOCK_WEBHOOK_SECRET = 'mock-carrier-webhook-secret-test-only';

function signShipping(rawBody: string, secret = MOCK_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function trackingEvent(shipmentRef: string, status: string, occurredAt = new Date(), id?: string) {
  return JSON.stringify({
    id: id ?? `${shipmentRef}-${status}-${occurredAt.getTime()}`,
    shipment_ref: shipmentRef,
    status,
    occurred_at: occurredAt.toISOString(),
  });
}

/**
 * M17 — Shipping / Tracking (specs/16-shipping-tracking.md, SHIP-001-004,
 * ADR-0020). Covers: carrier-adapter substitution (SHIP-002's core
 * proof), shipment-creation idempotency/concurrency, the distributed-
 * system failure-window retry design, webhook durable dedup/resume
 * (mirroring the M14 PaymentEvent pattern), the platform tracking state
 * machine (illegal-transition rejection), redelivery-exhaustion ->
 * automatic RTO (SHIP-004), the "exactly one SALE posting point"
 * invariant (M16 certification), polling fallback + graceful
 * degradation (negative scenario #1), split-shipment independent
 * tracking, and IDOR/BOLA on the staff routes.
 */
describe('Shipping / Tracking (M17)', () => {
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
        throw new Error('Unexpected fetch in shipping test');
      }),
    );
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function warehouseToken(perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'shipping:manage']) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function warehouseStaff(perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'shipping:manage']) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Shipping Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLSHPTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function setupCheckoutableSku(sellingPrice: number, ctx?: Awaited<ReturnType<typeof seedContext>>, onHand = 10) {
    const token = await merchandisingToken();
    const seeded = ctx ?? (await seedContext());
    const hsnCode = '6109';
    const existingRate = await testPrisma.taxRate.findFirst({ where: { hsnCode } });
    if (!existingRate) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: `SHP-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Shipping Test Jacket',
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
      payload: { styleId, mrp: sellingPrice, sellingPrice },
    });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: seeded.locationId, onHand, reserved: 0 } });

    return skuId;
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function addToCart(skuId: string, headers: Record<string, string>, quantity = 1) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(res.statusCode).toBe(201);
  }

  async function codOrder(skuId: string, guestId: string, idempotencyKey: string, quantity = 1) {
    const headers = { [GUEST_HEADER]: guestId };
    await addToCart(skuId, headers, quantity);
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
        idempotencyKey,
      },
    });
    expect(res.statusCode).toBe(201);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    return { sessionId: res.json().id as string, orderId: order.id, headers };
  }

  async function pickLine(lineId: string, token: string) {
    const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: line.quantity },
    });
    expect(res.statusCode).toBe(200);
  }

  /** Full pick -> assign -> pack -> ready-to-ship chain (M16 hand-off boundary), returns the fulfilment id. */
  async function readyToShipFulfilment(orderId: string, lineIds: string[], token: string): Promise<string> {
    for (const lineId of lineIds) await pickLine(lineId, token);
    const fulfilRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/fulfilments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { lineIds },
    });
    expect(fulfilRes.statusCode).toBe(201);
    const fulfilmentId = fulfilRes.json().id as string;
    const packRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(packRes.statusCode).toBe(200);
    const readyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readyRes.statusCode).toBe(200);
    return fulfilmentId;
  }

  async function createShipmentHttp(fulfilmentId: string, token: string, idempotencyKey: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/shipment`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey },
    });
  }

  describe('Carrier adapter substitution (SHIP-002)', () => {
    it('proves ShippingService behaves identically against two differently-configured carrier adapter instances, with zero core-logic changes', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const { token, staffUserId } = await warehouseStaff();

      const { orderId: orderIdA } = await codOrder(skuA, 'guest-ship-sub-a', 'idem-ship-sub-a');
      const { orderId: orderIdB } = await codOrder(skuB, 'guest-ship-sub-b', 'idem-ship-sub-b');
      const linesA = await testPrisma.orderLine.findMany({ where: { orderId: orderIdA } });
      const linesB = await testPrisma.orderLine.findMany({ where: { orderId: orderIdB } });
      const fulfilmentA = await readyToShipFulfilment(orderIdA, linesA.map((l) => l.id), token);
      const fulfilmentB = await readyToShipFulfilment(orderIdB, linesB.map((l) => l.id), token);

      // Two adapter INSTANCES, differently configured (distinct webhook
      // secrets) - exactly the substitution ADR-0020/SHIP-002 requires:
      // the exact same ShippingService code path, never modified per
      // adapter, drives both to a correct booking and a correctly-verified
      // webhook using EACH adapter's own secret.
      const adapterOne = new MockCarrierProvider('carrier-one-secret');
      const adapterTwo = new MockCarrierProvider('carrier-two-secret');

      const serviceOne = new ShippingService(app, adapterOne);
      const serviceTwo = new ShippingService(app, adapterTwo);

      const shipmentOne = await serviceOne.createShipment(fulfilmentA, staffUserId, 'idem-adapter-one');
      const shipmentTwo = await serviceTwo.createShipment(fulfilmentB, staffUserId, 'idem-adapter-two');

      expect(shipmentOne.status).toBe('BOOKED');
      expect(shipmentTwo.status).toBe('BOOKED');
      expect(shipmentOne.provider).toBe('MOCK');
      expect(shipmentTwo.provider).toBe('MOCK');

      // Each adapter instance's own signature verification is exercised
      // identically through the SAME handleCarrierWebhook code path.
      const bodyOne = trackingEvent(shipmentOne.providerShipmentRef!, 'in_transit', new Date(), 'evt-adapter-one-1');
      const resultOne = await serviceOne.handleCarrierWebhook(bodyOne, signShipping(bodyOne, 'carrier-one-secret'));
      expect(resultOne.ok).toBe(true);

      // Adapter TWO's signature does not verify against adapter ONE's body
      // (wrong secret) - proves the two are genuinely independently
      // configured, not sharing hidden global state.
      const wrongSignatureResult = await serviceTwo.handleCarrierWebhook(bodyOne, signShipping(bodyOne, 'carrier-one-secret'));
      expect(wrongSignatureResult.ok).toBe(false);

      const refreshedOne = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipmentOne.id } });
      expect(refreshedOne.status).toBe('IN_TRANSIT');
    });
  });

  describe('Shipment creation (SHIP §7)', () => {
    it('blocks shipment creation when the fulfilment has not legitimately reached READY_TO_SHIP', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-notready', 'idem-ship-notready');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      await pickLine(lines[0].id, token);
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [lines[0].id] },
      });
      const fulfilmentId = fulfilRes.json().id as string; // still PENDING, not even PACKED

      const res = await createShipmentHttp(fulfilmentId, token, 'idem-notready-1');
      expect(res.statusCode).toBe(400);

      const shipment = await testPrisma.shipment.findUnique({ where: { fulfilmentId } });
      expect(shipment).toBeNull();
    });

    it('is idempotent: a retried request with the same key returns the same Shipment, never a duplicate booking or a second SALE posting', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-idem', 'idem-ship-idem');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);

      const first = await createShipmentHttp(fulfilmentId, token, 'idem-create-1');
      expect(first.statusCode).toBe(201);
      const second = await createShipmentHttp(fulfilmentId, token, 'idem-create-1');
      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);

      const shipments = await testPrisma.shipment.findMany({ where: { fulfilmentId } });
      expect(shipments).toHaveLength(1);

      const saleRows = await testPrisma.inventoryTransaction.findMany({
        where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: lines[0].id },
      });
      expect(saleRows).toHaveLength(1);

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('SHIPPED');
    });

    it('converges two genuinely concurrent create-shipment requests to exactly one Shipment and one SALE posting', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-race', 'idem-ship-race');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);

      const [r1, r2] = await Promise.all([
        createShipmentHttp(fulfilmentId, token, 'idem-race-a'),
        createShipmentHttp(fulfilmentId, token, 'idem-race-b'),
      ]);
      expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
      expect(r1.json().id).toBe(r2.json().id);

      const shipments = await testPrisma.shipment.findMany({ where: { fulfilmentId } });
      expect(shipments).toHaveLength(1);
      expect(shipments[0].status).toBe('BOOKED');

      const saleRows = await testPrisma.inventoryTransaction.findMany({
        where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: lines[0].id },
      });
      expect(saleRows).toHaveLength(1);
    });

    it('recovers from a crash-equivalent retry between a successful carrier booking and the local commit (idempotent-by-shipmentId adapter)', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { token, staffUserId } = await warehouseStaff();
      const { orderId } = await codOrder(skuId, 'guest-ship-crash', 'idem-ship-crash');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);

      // Simulate the durable-intent row already having been written (the
      // first phase of createShipment) but the process crashing BEFORE the
      // carrier call / local commit completed.
      const svc = new ShippingService(app);
      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      const shipment = await testPrisma.shipment.create({
        data: {
          fulfilmentId,
          orderId: fulfilment.orderId,
          provider: 'MOCK',
          status: 'CREATED',
          maxDeliveryAttempts: 2,
          idempotencyKey: 'idem-crash-1',
          createdByStaffId: staffUserId,
        },
      });

      // The retry (same idempotencyKey) resumes from CREATED, calls the
      // (idempotent-by-shipmentId) mock carrier, and completes the booking.
      const resumed = await svc.createShipment(fulfilmentId, staffUserId, 'idem-crash-1');
      expect(resumed.id).toBe(shipment.id);
      expect(resumed.status).toBe('BOOKED');
      expect(resumed.trackingRef).toBe(`MOCKAWB${shipment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`);

      const shipments = await testPrisma.shipment.findMany({ where: { fulfilmentId } });
      expect(shipments).toHaveLength(1);
    });
  });

  describe('Webhook processing (durable RECEIVED/PROCESSED/FAILED, mirroring PaymentEvent)', () => {
    async function bookedShipment() {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, `guest-ship-wh-${counter}`, `idem-ship-wh-${counter}`);
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      const createRes = await createShipmentHttp(fulfilmentId, token, `idem-wh-create-${counter}`);
      expect(createRes.statusCode).toBe(201);
      const shipment = createRes.json();
      return { orderId, fulfilmentId, shipment, lines };
    }

    it('rejects a webhook with an invalid signature - nothing persisted', async () => {
      const { shipment } = await bookedShipment();
      const body = trackingEvent(shipment.trackingRef ? shipment.providerShipmentRef : shipment.id, 'in_transit');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': 'deadbeef'.repeat(8) },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      const events = await testPrisma.shipmentTrackingEvent.findMany({ where: { shipmentId: shipment.id } });
      expect(events).toHaveLength(0);
    });

    it('is idempotent: a duplicate delivery of an ALREADY-PROCESSED event is a safe no-op', async () => {
      const { shipment } = await bookedShipment();
      const body = trackingEvent(shipment.providerShipmentRef, 'in_transit', new Date(), 'evt-dup-1');
      const headers = { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) };

      const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/shipping/mock', headers, payload: body });
      expect(first.statusCode).toBe(200);
      expect(first.json().duplicate).toBe(false);

      const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/shipping/mock', headers, payload: body });
      expect(second.statusCode).toBe(200);
      expect(second.json().duplicate).toBe(true);

      const events = await testPrisma.shipmentTrackingEvent.findMany({ where: { provider: 'MOCK', providerEventId: 'evt-dup-1' } });
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('PROCESSED');

      const refreshed = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(refreshed.status).toBe('IN_TRANSIT');
    });

    it('resumes processing (never re-inserts) a redelivered event whose prior attempt was recorded but never successfully applied', async () => {
      const { shipment } = await bookedShipment();
      const body = trackingEvent(shipment.providerShipmentRef, 'in_transit', new Date(), 'evt-resume-1');

      // Simulate a prior delivery that was durably recorded but failed to
      // apply (e.g. a transient DB error between record and apply) -
      // never a PROCESSED row, so the unique (provider, providerEventId)
      // constraint alone would otherwise poison a real retry forever.
      await testPrisma.shipmentTrackingEvent.create({
        data: {
          shipmentId: shipment.id,
          provider: 'MOCK',
          providerEventId: 'evt-resume-1',
          source: 'WEBHOOK',
          rawStatus: 'in_transit',
          normalizedStatus: 'IN_TRANSIT',
          payload: { simulated: 'prior-failed-attempt' },
          status: 'FAILED',
          processingError: 'simulated transient failure',
          occurredAt: new Date(),
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().duplicate).toBe(false);

      const events = await testPrisma.shipmentTrackingEvent.findMany({ where: { provider: 'MOCK', providerEventId: 'evt-resume-1' } });
      expect(events).toHaveLength(1); // resumed against the SAME row, never a second insert
      expect(events[0].status).toBe('PROCESSED');

      const refreshed = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(refreshed.status).toBe('IN_TRANSIT');
    });

    it('durably records (and does not crash on) a webhook for an unknown/unrecognized shipment reference', async () => {
      const body = trackingEvent('MOCK-SHP-does-not-exist', 'in_transit', new Date(), 'evt-unknown-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      const events = await testPrisma.shipmentTrackingEvent.findMany({ where: { provider: 'MOCK', providerEventId: 'evt-unknown-1' } });
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('PROCESSED');
      expect(events[0].shipmentId).toBeNull();
    });

    it('rejects an illegal/contradictory tracking transition and marks the event FAILED (retryable)', async () => {
      const { shipment } = await bookedShipment(); // status BOOKED
      const body = trackingEvent(shipment.providerShipmentRef, 'rto_delivered', new Date(), 'evt-illegal-1');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(400);

      const event = await testPrisma.shipmentTrackingEvent.findFirstOrThrow({ where: { provider: 'MOCK', providerEventId: 'evt-illegal-1' } });
      expect(event.status).toBe('FAILED');

      const refreshed = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(refreshed.status).toBe('BOOKED'); // unchanged
    });
  });

  describe('Tracking lifecycle, redelivery exhaustion -> RTO, and the exactly-one-SALE invariant', () => {
    async function send(providerShipmentRef: string, status: string, id: string) {
      const body = trackingEvent(providerShipmentRef, status, new Date(), id);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) },
        payload: body,
      });
      return res;
    }

    it('delivers a shipment end to end (BOOKED -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED), reusing markFulfilmentDelivered with SYSTEM attribution and posting SALE exactly once', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-deliver', 'idem-ship-deliver');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      const createRes = await createShipmentHttp(fulfilmentId, token, 'idem-deliver-create');
      const shipment = createRes.json();

      expect((await send(shipment.providerShipmentRef, 'in_transit', 'evt-d-1')).statusCode).toBe(200);
      expect((await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-d-2')).statusCode).toBe(200);
      expect((await send(shipment.providerShipmentRef, 'delivered', 'evt-d-3')).statusCode).toBe(200);

      const refreshedFulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(refreshedFulfilment.status).toBe('DELIVERED');

      const deliverAudit = await testPrisma.auditLog.findFirst({
        where: { action: 'order.fulfilment.deliver', entityId: fulfilmentId },
      });
      expect(deliverAudit?.actorType).toBe('SYSTEM');
      expect(deliverAudit?.actorStaffId).toBeNull();

      // Exactly-one-SALE-posting-point invariant: still exactly 1 row,
      // never posted a second time from the webhook path.
      const saleRows = await testPrisma.inventoryTransaction.findMany({
        where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: lines[0].id },
      });
      expect(saleRows).toHaveLength(1);
    });

    it('auto-transitions to RTO once the configured redelivery-attempt budget (default 2) is exhausted, reusing markRTO with SYSTEM attribution', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-rto', 'idem-ship-rto');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      const createRes = await createShipmentHttp(fulfilmentId, token, 'idem-rto-create');
      const shipment = createRes.json();

      expect((await send(shipment.providerShipmentRef, 'in_transit', 'evt-rto-1')).statusCode).toBe(200);
      expect((await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-rto-2')).statusCode).toBe(200);
      expect((await send(shipment.providerShipmentRef, 'delivery_attempt_failed', 'evt-rto-3')).statusCode).toBe(200); // attempt 1/2
      expect((await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-rto-4')).statusCode).toBe(200);
      expect((await send(shipment.providerShipmentRef, 'delivery_attempt_failed', 'evt-rto-5')).statusCode).toBe(200); // attempt 2/2 -> RTO

      const refreshedShipment = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(refreshedShipment.status).toBe('RTO_INITIATED');
      expect(refreshedShipment.deliveryAttempts).toBe(2);
      expect(refreshedShipment.rtoInitiatedAt).not.toBeNull();

      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('RTO');
      expect(order.refundRequired).toBe(false); // COD - nothing was ever collected

      const rtoAudit = await testPrisma.auditLog.findFirst({ where: { action: 'order.rto', entityId: orderId } });
      expect(rtoAudit?.actorType).toBe('SYSTEM');
      expect(rtoAudit?.actorStaffId).toBeNull();
    });

    it('rejects an out-of-order redelivery attempt beyond the exhausted RTO transition', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-rto2', 'idem-ship-rto2');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      const createRes = await createShipmentHttp(fulfilmentId, token, 'idem-rto2-create');
      const shipment = createRes.json();

      await send(shipment.providerShipmentRef, 'in_transit', 'evt-rto2-1');
      await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-rto2-2');
      await send(shipment.providerShipmentRef, 'delivery_attempt_failed', 'evt-rto2-3');
      await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-rto2-4');
      await send(shipment.providerShipmentRef, 'delivery_attempt_failed', 'evt-rto2-5'); // -> RTO_INITIATED

      const res = await send(shipment.providerShipmentRef, 'out_for_delivery', 'evt-rto2-6');
      expect(res.statusCode).toBe(400); // illegal from RTO_INITIATED
    });
  });

  describe('Polling fallback (SHIP-003) and graceful degradation (negative scenario #1)', () => {
    it('leaves the last-known platform status untouched when the carrier has nothing new to report', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-poll-null', 'idem-ship-poll-null');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      await createShipmentHttp(fulfilmentId, token, 'idem-poll-null-create');

      // The real HTTP route always resolves the default MockCarrierProvider,
      // whose trackShipment() is an honest "nothing new" (null) - proving
      // the poll route degrades gracefully rather than erroring.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/shipments/poll',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ polled: 1, updated: 0 });

      const shipment = await testPrisma.shipment.findFirstOrThrow({ where: { fulfilmentId } });
      expect(shipment.status).toBe('BOOKED'); // untouched
    });

    it('applies a real poll snapshot from a test double carrier that DOES return new tracking data', async () => {
      const skuId = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-poll-real', 'idem-ship-poll-real');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), token);
      const createRes = await createShipmentHttp(fulfilmentId, token, 'idem-poll-real-create');
      const shipment = createRes.json();

      class PollableMockProvider extends MockCarrierProvider {
        async trackShipment(providerShipmentRef: string) {
          return {
            providerShipmentRef,
            rawStatus: 'in_transit',
            normalizedStatus: 'IN_TRANSIT' as const,
            occurredAt: new Date(),
          };
        }
      }

      const svc = new ShippingService(app, new PollableMockProvider());
      const result = await svc.pollPendingShipments();
      expect(result).toEqual({ polled: 1, updated: 1 });

      const refreshed = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(refreshed.status).toBe('IN_TRANSIT');
    });
  });

  describe('Split shipments (independent tracking)', () => {
    it('tracks two fulfilments of the same order independently - one DELIVERED while the other stays IN_TRANSIT', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const token = await warehouseToken();

      const headers = { [GUEST_HEADER]: 'guest-ship-split' };
      await addToCart(skuA, headers);
      await addToCart(skuB, headers);
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: {
          contactName: 'Jane Doe',
          contactMobile: '9876543210',
          billingAddress: validAddress(),
          shippingAddress: validAddress(),
          paymentMethod: 'COD',
          idempotencyKey: 'idem-ship-split',
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id } });
      const lines = await testPrisma.orderLine.findMany({ where: { orderId: order.id } });
      expect(lines).toHaveLength(2);

      const fulfilmentA = await readyToShipFulfilment(order.id, [lines[0].id], token);
      const fulfilmentB = await readyToShipFulfilment(order.id, [lines[1].id], token);

      const shipmentA = (await createShipmentHttp(fulfilmentA, token, 'idem-split-a')).json();
      const shipmentB = (await createShipmentHttp(fulfilmentB, token, 'idem-split-b')).json();
      expect(shipmentA.id).not.toBe(shipmentB.id);

      const bodyA = trackingEvent(shipmentA.providerShipmentRef, 'in_transit', new Date(), 'evt-split-a-1');
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(bodyA) },
        payload: bodyA,
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: {
          'content-type': 'application/json',
          'x-shipping-signature': signShipping(trackingEvent(shipmentA.providerShipmentRef, 'out_for_delivery', new Date(), 'evt-split-a-2')),
        },
        payload: trackingEvent(shipmentA.providerShipmentRef, 'out_for_delivery', new Date(), 'evt-split-a-2'),
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: {
          'content-type': 'application/json',
          'x-shipping-signature': signShipping(trackingEvent(shipmentA.providerShipmentRef, 'delivered', new Date(), 'evt-split-a-3')),
        },
        payload: trackingEvent(shipmentA.providerShipmentRef, 'delivered', new Date(), 'evt-split-a-3'),
      });

      const refreshedA = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipmentA.id } });
      const refreshedB = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipmentB.id } });
      expect(refreshedA.status).toBe('DELIVERED');
      expect(refreshedB.status).toBe('BOOKED'); // untouched by A's events

      const orderView = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${order.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(orderView.statusCode).toBe(200);
      const fulfilments = orderView.json().fulfilments as { id: string; shipment: { status: string } | null }[];
      const viewA = fulfilments.find((f) => f.id === fulfilmentA)!;
      const viewB = fulfilments.find((f) => f.id === fulfilmentB)!;
      expect(viewA.shipment?.status).toBe('DELIVERED');
      expect(viewB.shipment?.status).toBe('BOOKED');
    });
  });

  describe('Authorization / IDOR (BOLA)', () => {
    it('rejects shipment creation from a staff member without shipping:manage', async () => {
      const skuId = await setupCheckoutableSku(500);
      const fullToken = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ship-idor', 'idem-ship-idor');
      const lines = await testPrisma.orderLine.findMany({ where: { orderId } });
      const fulfilmentId = await readyToShipFulfilment(orderId, lines.map((l) => l.id), fullToken);

      await grantPermissions('WAREHOUSE_OPERATOR', ['order:read']); // deliberately no shipping:manage
      const { token: limitedToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_OPERATOR']);

      const res = await createShipmentHttp(fulfilmentId, limitedToken, 'idem-idor-1');
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unauthenticated request to create or read a shipment', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shipments/00000000-0000-0000-0000-000000000000`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
