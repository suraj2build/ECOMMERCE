import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';
const MOCK_WEBHOOK_SECRET = 'mock-carrier-webhook-secret-test-only';

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}

function signShipping(rawBody: string): string {
  return createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

function capturedEvent(orderId: string, paymentEntityId: string) {
  return {
    id: `evt_${paymentEntityId}_captured`,
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } },
  };
}

/**
 * M18 — Cancellation (specs/17-cancellation.md, CAN-001-003) adversarial
 * certification. Evolves M15's cancelOrderLine in place rather than a
 * competing engine - covers the 30-point matrix the M18 build
 * instruction requires: eligibility/partial cancellation, the
 * shipment boundary, idempotency, concurrency (cancel vs pick/pack/
 * ready-to-ship/shipment-creation/ship), inventory-ledger exactness,
 * warehouse-work invalidation, prepaid/COD refund branching, split-
 * fulfilment isolation, customer ownership/IDOR, staff RBAC, audit,
 * and immutable-price credit-note integration.
 */
describe('Cancellation (M18)', () => {
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
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        if (href.endsWith('/orders') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: `order_mock_${counter}` }), { status: 200 });
        }
        throw new Error(`Unexpected fetch in test: ${href}`);
      }),
    );
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function csToken(perms: string[] = ['order:read', 'order:cancel']) {
    await grantPermissions('CUSTOMER_SERVICE', perms);
    return (await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE'])).token;
  }

  async function warehouseToken(perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'shipping:manage']) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Cancellation Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLCANTST${counter}A1Z${counter % 10}`,
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
        styleCode: `CAN-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Cancellation Test Jacket',
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

  async function prepaidCapturedOrder(skuId: string, guestId: string, idempotencyKey: string) {
    const headers = { [GUEST_HEADER]: guestId };
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
        idempotencyKey,
      },
    });
    expect(res.statusCode).toBe(201);
    const sessionId = res.json().id as string;
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });

    const body = JSON.stringify(capturedEvent(payment.providerReferenceId!, `pay_${idempotencyKey}`));
    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) },
      payload: body,
    });
    expect(webhookRes.statusCode).toBe(200);

    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
    return { sessionId, orderId: order.id, headers };
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
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
    const readyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readyRes.statusCode).toBe(200);
    return fulfilmentId;
  }

  async function cancelLine(orderId: string, lineId: string, token: string, idempotencyKey: string, reason?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason, idempotencyKey },
    });
  }

  async function cancelLineAsCustomer(orderId: string, lineId: string, headers: Record<string, string>, idempotencyKey: string, reason?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/storefront/orders/${orderId}/lines/${lineId}/cancel`,
      headers,
      payload: { reason, idempotencyKey },
    });
  }

  // --- 1-3: eligibility / full / partial / all-lines ---

  describe('Eligibility and partial cancellation', () => {
    it('1. eligible full cancellation (single-line order) cancels the line and the order', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-full', 'idem-can-full');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();

      const res = await cancelLine(orderId, order.lines[0]!.id, token, 'idem-cancel-full-1', 'no longer needed');
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.status).toBe('CANCELLED');
    });

    it('2. eligible partial line cancellation on a multi-line order leaves the other line active', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const headers = { [GUEST_HEADER]: 'guest-can-partial' };
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
          idempotencyKey: 'idem-can-partial',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });
      const token = await csToken();

      const res = await cancelLine(order.id, order.lines[0]!.id, token, 'idem-cancel-partial-1');
      expect(res.statusCode).toBe(200);

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('PROCESSING'); // line-level truth preserved (§16/#19)

      const remaining = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[1]!.id } });
      expect(remaining.status).toBe('ALLOCATED');
    });

    it('3. all-lines cancellation cancels every line and the order rolls up to CANCELLED', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const headers = { [GUEST_HEADER]: 'guest-can-all' };
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
          idempotencyKey: 'idem-can-all',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });
      const token = await csToken();

      await cancelLine(order.id, order.lines[0]!.id, token, 'idem-cancel-all-1');
      await cancelLine(order.id, order.lines[1]!.id, token, 'idem-cancel-all-2');

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('CANCELLED');
    });

    it('4. blocks cancellation once a line has shipped - routes to return instead', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-blocked', 'idem-can-blocked');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();

      const fulfilmentId = await readyToShipFulfilment(orderId, [order.lines[0]!.id], wToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${wToken}` } });

      const res = await cancelLine(orderId, order.lines[0]!.id, token, 'idem-cancel-blocked-1');
      expect(res.statusCode).toBe(400);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('SHIPPED');
    });
  });

  // --- 5-8: idempotency ---

  describe('Idempotency', () => {
    it('5. duplicate same-key cancellation is idempotent (no double effect)', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-idem1', 'idem-can-idem1');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const lineId = order.lines[0]!.id;

      const first = await cancelLine(orderId, lineId, token, 'idem-dup-1');
      expect(first.statusCode).toBe(200);
      const second = await cancelLine(orderId, lineId, token, 'idem-dup-1');
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(lineId);

      const events = await testPrisma.auditLog.findMany({ where: { action: 'order.line.cancel', entityId: lineId } });
      expect(events).toHaveLength(1);

      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', skuId } });
      expect(cancellationRows).toHaveLength(1);
    });

    it('6. same key + different target is rejected', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const { orderId: orderA } = await codOrder(skuA, 'guest-can-idem2a', 'idem-can-idem2a');
      const { orderId: orderB } = await codOrder(skuB, 'guest-can-idem2b', 'idem-can-idem2b');
      const lineA = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderA } })).id;
      const lineB = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderB } })).id;
      const token = await csToken();

      const first = await cancelLine(orderA, lineA, token, 'idem-shared-key');
      expect(first.statusCode).toBe(200);

      const second = await cancelLine(orderB, lineB, token, 'idem-shared-key');
      expect(second.statusCode).toBe(409);

      const lineBRow = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineB } });
      expect(lineBRow.status).not.toBe('CANCELLED');
    });

    it('7. concurrent duplicate cancellation (same key) converges to one effect', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-conc1', 'idem-can-conc1');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const lineId = order.lines[0]!.id;

      const [r1, r2] = await Promise.all([
        cancelLine(orderId, lineId, token, 'idem-conc-same'),
        cancelLine(orderId, lineId, token, 'idem-conc-same'),
      ]);
      expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);

      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', skuId } });
      expect(cancellationRows).toHaveLength(1);
    });

    it('8. two different idempotency keys racing the same line still converge to one cancellation effect', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-conc2', 'idem-can-conc2');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const lineId = order.lines[0]!.id;

      const [r1, r2] = await Promise.all([
        cancelLine(orderId, lineId, token, 'idem-conc-a'),
        cancelLine(orderId, lineId, token, 'idem-conc-b'),
      ]);
      expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
      expect(line.status).toBe('CANCELLED');

      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', skuId } });
      expect(cancellationRows).toHaveLength(1);

      const auditRows = await testPrisma.auditLog.findMany({ where: { action: 'order.line.cancel', entityId: lineId } });
      expect(auditRows).toHaveLength(1);
    });
  });

  // --- 9-12: concurrency against the warehouse/shipping lifecycle ---

  describe('Concurrency against warehouse/shipping transitions', () => {
    it('9. cancellation racing a concurrent pick converges to a safe, consistent outcome', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-vs-pick', 'idem-can-vs-pick');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();
      const line = order.lines[0]!;
      const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });

      const [pickRes, cancelRes] = await Promise.allSettled([
        app.inject({
          method: 'POST',
          url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
          headers: { authorization: `Bearer ${wToken}` },
          payload: { idempotencyKey: `pick-${line.id}`, outcome: 'FULL', pickedQuantity: line.quantity },
        }),
        cancelLine(orderId, line.id, token, 'idem-vs-pick-1'),
      ]);

      // Whichever order they landed in, the final state is internally
      // consistent: the line is either CANCELLED (pick task also
      // CANCELLED, no orphaned actionable work) or PICKED (pick genuinely
      // completed - cancellation still succeeds independently, since
      // PICKED remains pre-shipment/cancellable).
      const finalLine = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
      const finalTask = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });
      expect(['CANCELLED', 'PICKED', 'ALLOCATED']).toContain(finalLine.status);
      if (finalLine.status === 'CANCELLED') {
        expect(['CANCELLED', 'PICKED']).toContain(finalTask.status); // never left PENDING/actionable
      }
      expect(pickRes.status).toBe('fulfilled');
      expect(cancelRes.status).toBe('fulfilled');
    });

    it('10. cancellation racing a concurrent pack/ready-to-ship transition never corrupts state', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-vs-pack', 'idem-can-vs-pack');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();
      const line = order.lines[0]!;

      await pickLine(line.id, wToken);
      const fulfilRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/fulfilments`,
        headers: { authorization: `Bearer ${wToken}` },
        payload: { lineIds: [line.id] },
      });
      const fulfilmentId = fulfilRes.json().id as string;

      const [packRes, cancelRes] = await Promise.allSettled([
        app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${wToken}` } }),
        cancelLine(orderId, line.id, token, 'idem-vs-pack-1'),
      ]);
      expect(packRes.status).toBe('fulfilled');
      expect(cancelRes.status).toBe('fulfilled');

      const finalLine = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(['CANCELLED', 'PACKED']).toContain(finalLine.status);
      // If cancelled, the reservation was genuinely released exactly once.
      if (finalLine.status === 'CANCELLED') {
        const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: line.reservationId! } });
        expect(reservation.status).toBe('RELEASED');
      }
    });

    it('11. cancellation racing concurrent shipment creation never double-consumes or double-releases inventory', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-vs-shipcreate', 'idem-can-vs-shipcreate');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();
      const line = order.lines[0]!;
      const fulfilmentId = await readyToShipFulfilment(orderId, [line.id], wToken);

      const [shipRes, cancelRes] = await Promise.allSettled([
        app.inject({
          method: 'POST',
          url: `/api/v1/orders/fulfilments/${fulfilmentId}/shipment`,
          headers: { authorization: `Bearer ${wToken}` },
          payload: { idempotencyKey: 'idem-shipcreate-race-1' },
        }),
        cancelLine(orderId, line.id, token, 'idem-vs-shipcreate-1'),
      ]);
      expect(shipRes.status).toBe('fulfilled');
      expect(cancelRes.status).toBe('fulfilled');

      // The safety invariant: never both a SALE and a CANCELLATION ledger
      // row for the same reservation - whichever genuinely won, inventory
      // was adjusted exactly once, never double-consumed or double-released.
      const saleRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: line.id } });
      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', referenceId: line.reservationId! } });
      expect(saleRows.length + cancellationRows.length).toBeGreaterThanOrEqual(1);
      expect(saleRows.length).toBeLessThanOrEqual(1);
      expect(cancellationRows.length).toBeLessThanOrEqual(1);
      // Never both - a shipment can never consume inventory a cancellation
      // already released, and vice versa (M18 §6/§8).
      expect(saleRows.length === 1 && cancellationRows.length === 1).toBe(false);

      const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId, locationId: line.locationId } },
      });
      expect(balance.reserved).toBeGreaterThanOrEqual(0);
      expect(balance.onHand).toBeGreaterThanOrEqual(0);
    });

    it('12. cancellation racing the staff ship (SALE-posting) transition never double-decrements or double-releases', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-vs-ship', 'idem-can-vs-ship');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();
      const line = order.lines[0]!;
      const fulfilmentId = await readyToShipFulfilment(orderId, [line.id], wToken);

      const [shipRes, cancelRes] = await Promise.allSettled([
        app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${wToken}` } }),
        cancelLine(orderId, line.id, token, 'idem-vs-ship-1'),
      ]);
      expect(shipRes.status).toBe('fulfilled');
      expect(cancelRes.status).toBe('fulfilled');

      const finalLine = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(['CANCELLED', 'SHIPPED']).toContain(finalLine.status);

      const saleRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: line.id } });
      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', referenceId: line.reservationId! } });
      // Exactly one legal ledger outcome - never both.
      expect(saleRows.length + cancellationRows.length).toBe(1);

      if (finalLine.status === 'SHIPPED') {
        expect(saleRows).toHaveLength(1);
        expect(cancellationRows).toHaveLength(0);
      } else {
        expect(cancellationRows).toHaveLength(1);
        expect(saleRows).toHaveLength(0);
      }

      const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId, locationId: line.locationId } },
      });
      expect(balance.reserved).toBeGreaterThanOrEqual(0);
      expect(balance.onHand).toBeGreaterThanOrEqual(0);
    });
  });

  // --- 13-15: inventory ledger exactness ---

  describe('Inventory ledger exactness', () => {
    it('13. exactly one cancellation inventory-ledger effect for a normal cancel', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-ledger1', 'idem-can-ledger1');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();

      const cancelRes = await cancelLine(orderId, order.lines[0]!.id, token, 'idem-ledger-1');
      expect(cancelRes.statusCode).toBe(200);

      const rows = await testPrisma.inventoryTransaction.findMany({ where: { skuId } });
      const types = rows.map((r) => r.type).sort();
      // RESERVATION at add-to-cart/checkout, ALLOCATION when the order is
      // created (reservation converts to allocation), CANCELLATION when
      // this line is cancelled - exactly one of each, no duplicates.
      expect(types).toEqual(['ALLOCATION', 'CANCELLATION', 'RESERVATION']);
    });

    it('14. no duplicate SALE or CANCELLATION mutation across repeated cancel attempts', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-ledger2', 'idem-can-ledger2');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const lineId = order.lines[0]!.id;

      await cancelLine(orderId, lineId, token, 'idem-ledger2-a');
      await cancelLine(orderId, lineId, token, 'idem-ledger2-b'); // different key, already-cancelled - idempotent no-op
      await cancelLine(orderId, lineId, token, 'idem-ledger2-a'); // same key replay

      const cancellationRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'CANCELLATION', skuId } });
      expect(cancellationRows).toHaveLength(1);
    });

    it('15. never leaves negative onHand/reserved after cancellation', async () => {
      const skuId = await setupCheckoutableSku(500, undefined, 3);
      const { orderId } = await codOrder(skuId, 'guest-can-ledger3', 'idem-can-ledger3', 2);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();

      await cancelLine(orderId, order.lines[0]!.id, token, 'idem-ledger3-1');

      const line = order.lines[0]!;
      const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId, locationId: line.locationId } },
      });
      expect(balance.onHand).toBeGreaterThanOrEqual(0);
      expect(balance.reserved).toBeGreaterThanOrEqual(0);
      expect(balance.onHand).toBe(3); // COD cancel never touches onHand - only the reservation's `reserved` hold is released
      expect(balance.reserved).toBe(0);
    });
  });

  // --- 16: warehouse effects ---

  describe('Warehouse effects', () => {
    it('16. cancelled work cannot remain actionable in the warehouse queue', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-warehouse', 'idem-can-warehouse');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();
      const token = await csToken();
      const line = order.lines[0]!;

      await cancelLine(orderId, line.id, token, 'idem-warehouse-1');

      const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });
      expect(task.status).toBe('CANCELLED');

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/warehouse/pick-tasks?status=PENDING',
        headers: { authorization: `Bearer ${wToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const ids = (listRes.json().items ?? listRes.json()) as { id: string }[];
      expect(Array.isArray(ids) ? ids.find((t) => t.id === task.id) : undefined).toBeUndefined();
    });
  });

  // --- 17-18: prepaid vs COD ---

  describe('Prepaid vs COD financial consequence', () => {
    it('17. prepaid cancellation sets refundRequired and issues an engineering credit note against the invoice', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-can-prepaid', 'idem-can-prepaid');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const line = order.lines[0]!;

      const res = await cancelLine(orderId, line.id, token, 'idem-prepaid-1', 'changed mind');
      expect(res.statusCode).toBe(200);

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.refundRequired).toBe(true);
      expect(updatedOrder.invoiceId).not.toBeNull();

      const invoiceLine = await testPrisma.invoiceLine.findUnique({ where: { orderLineId: line.id } });
      expect(invoiceLine).not.toBeNull();

      const creditNote = await testPrisma.creditNote.findFirst({ where: { originalInvoiceId: updatedOrder.invoiceId! } });
      expect(creditNote).not.toBeNull();
      expect(creditNote!.reason).toBe('changed mind');

      const creditNoteLine = await testPrisma.creditNoteLine.findFirst({ where: { creditNoteId: creditNote!.id } });
      expect(creditNoteLine!.invoiceLineId).toBe(invoiceLine!.id);
      // Immutable original transaction price used - never re-derived from
      // current catalog/tax config (M18 §17).
      expect(Number(creditNoteLine!.taxableValueReduction)).toBeCloseTo(Number(invoiceLine!.taxableValue), 2);
    });

    it('18. COD cancellation does not manufacture a refund - refundRequired stays false, no credit note issued', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-cod-norefund', 'idem-can-cod-norefund');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();

      await cancelLine(orderId, order.lines[0]!.id, token, 'idem-cod-norefund-1');

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.refundRequired).toBe(false);

      const creditNotes = await testPrisma.creditNote.findMany({ where: { originalInvoiceId: updatedOrder.invoiceId ?? undefined } });
      expect(creditNotes).toHaveLength(0);
    });

    it('duplicate credit-note issuance is prevented across repeated prepaid cancellation attempts', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-can-prepaid-dup', 'idem-can-prepaid-dup');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const token = await csToken();
      const lineId = order.lines[0]!.id;

      await cancelLine(orderId, lineId, token, 'idem-prepaid-dup-1');
      await cancelLine(orderId, lineId, token, 'idem-prepaid-dup-1'); // exact replay
      await cancelLine(orderId, lineId, token, 'idem-prepaid-dup-2'); // different key, already-cancelled

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const creditNotes = await testPrisma.creditNote.findMany({ where: { originalInvoiceId: updatedOrder.invoiceId! } });
      expect(creditNotes).toHaveLength(1);
    });
  });

  // --- 19-20: order rollup / split fulfilment ---

  describe('Order rollup and split-fulfilment isolation', () => {
    it('19. partial cancellation does not cancel the surviving line, and rolls up correctly', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const wToken = await warehouseToken();
      const token = await csToken();

      const headers = { [GUEST_HEADER]: 'guest-can-rollup' };
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
          idempotencyKey: 'idem-can-rollup',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      // Ship line B, cancel line A - "one line cancelled + another shipped".
      const fulfilmentB = await readyToShipFulfilment(order.id, [order.lines[1]!.id], wToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentB}/ship`, headers: { authorization: `Bearer ${wToken}` } });
      await cancelLine(order.id, order.lines[0]!.id, token, 'idem-rollup-1');

      const finalOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).toBe('PROCESSING'); // not CANCELLED - one line still shipped/active

      const lineB = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[1]!.id } });
      expect(lineB.status).toBe('SHIPPED');
    });

    it('20. split-fulfilment cancellation isolation: cancelling one fulfilment-linked line never affects a sibling fulfilment', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const wToken = await warehouseToken();
      const token = await csToken();

      const headers = { [GUEST_HEADER]: 'guest-can-split' };
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
          idempotencyKey: 'idem-can-split',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      const fulfilmentA = await readyToShipFulfilment(order.id, [order.lines[0]!.id], wToken);
      const fulfilmentB = await readyToShipFulfilment(order.id, [order.lines[1]!.id], wToken);

      await cancelLine(order.id, order.lines[0]!.id, token, 'idem-split-1');

      const fulfilmentBRow = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentB } });
      expect(fulfilmentBRow.status).toBe('READY_TO_SHIP'); // sibling fulfilment completely untouched

      const fulfilmentARow = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentA } });
      const remainingLines = await testPrisma.orderLine.findMany({ where: { fulfilmentId: fulfilmentARow.id } });
      expect(remainingLines).toHaveLength(0); // the cancelled line detached from its own fulfilment
    });
  });

  // --- 21-23: customer ownership / IDOR / guest isolation ---

  describe('Customer ownership and IDOR', () => {
    it('21. customer can cancel their own eligible order via the storefront route', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId, headers } = await codOrder(skuId, 'guest-can-self', 'idem-can-self');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      const res = await cancelLineAsCustomer(orderId, order.lines[0]!.id, headers, 'idem-self-1', 'self-service cancel');
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');

      const auditRow = await testPrisma.auditLog.findFirst({ where: { action: 'order.line.cancel', entityId: order.lines[0]!.id } });
      expect(auditRow?.actorType).toBe('CUSTOMER');
      expect(auditRow?.actorStaffId).toBeNull();
    });

    it('22. customer cannot cancel another customer/guest order - clean 404, not a distinguishable 403', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-victim', 'idem-can-victim');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      const attackerHeaders = { [GUEST_HEADER]: 'guest-can-attacker' };
      const res = await cancelLineAsCustomer(orderId, order.lines[0]!.id, attackerHeaders, 'idem-attack-1');
      expect(res.statusCode).toBe(404);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).not.toBe('CANCELLED');
    });

    it('23. guest ownership isolation holds for two different guest sessions on separate orders', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const { orderId: orderA, headers: headersA } = await codOrder(skuA, 'guest-can-iso-a', 'idem-can-iso-a');
      const { orderId: orderB, headers: headersB } = await codOrder(skuB, 'guest-can-iso-b', 'idem-can-iso-b');
      const lineA = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderA } })).id;
      const lineB = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderB } })).id;

      const crossRes = await cancelLineAsCustomer(orderB, lineB, headersA, 'idem-iso-cross-1');
      expect(crossRes.statusCode).toBe(404);

      const ownRes = await cancelLineAsCustomer(orderA, lineA, headersA, 'idem-iso-own-1');
      expect(ownRes.statusCode).toBe(200);

      // Symmetric check: B's own session can still cancel B's own order.
      const ownResB = await cancelLineAsCustomer(orderB, lineB, headersB, 'idem-iso-own-b-1');
      expect(ownResB.statusCode).toBe(200);
    });

    it('an authenticated customer can cancel their own order placed while logged in', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { customerId, token: customerToken } = await createAuthenticatedCustomer(app);
      const headers = { authorization: `Bearer ${customerToken}` };
      await addToCart(skuId, headers);
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
          idempotencyKey: 'idem-can-authed',
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });
      expect(order.customerId).toBe(customerId);

      const res = await cancelLineAsCustomer(order.id, order.lines[0]!.id, headers, 'idem-authed-1');
      expect(res.statusCode).toBe(200);
    });
  });

  // --- 24-26: staff RBAC and audit ---

  describe('Staff RBAC and audit', () => {
    it('24. unauthorized staff (no order:cancel permission) is rejected', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-rbac', 'idem-can-rbac');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      await grantPermissions('MARKETING', ['marketing:manage']); // deliberately no order:cancel
      const { token } = await createAuthenticatedStaff(app, ['MARKETING']);

      const res = await cancelLine(orderId, order.lines[0]!.id, token, 'idem-rbac-1');
      expect(res.statusCode).toBe(403);
    });

    it('25. authorized staff cancellation is audited with the acting staff member as actor', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-audit-staff', 'idem-can-audit-staff');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { staffUserId, token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      await cancelLine(orderId, order.lines[0]!.id, token, 'idem-audit-staff-1');

      const auditRow = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'order.line.cancel', entityId: order.lines[0]!.id } });
      expect(auditRow.actorType).toBe('STAFF');
      expect(auditRow.actorStaffId).toBe(staffUserId);
      expect(auditRow.reference).toBe(orderId);
    });

    it('26. cancellation reason is recorded when provided, and honestly null when omitted', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const { orderId: orderA } = await codOrder(skuA, 'guest-can-reason-a', 'idem-can-reason-a');
      const { orderId: orderB } = await codOrder(skuB, 'guest-can-reason-b', 'idem-can-reason-b');
      const lineA = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderA } })).id;
      const lineB = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderB } })).id;
      const token = await csToken();

      await cancelLine(orderA, lineA, token, 'idem-reason-with', 'wrong size ordered');
      await cancelLine(orderB, lineB, token, 'idem-reason-without'); // no reason - CAN-003 "optional, not mandatory"

      const lineARow = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineA } });
      expect(lineARow.cancelledReason).toBe('wrong size ordered');

      const lineBRow = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineB } });
      expect(lineBRow.status).toBe('CANCELLED');
      expect(lineBRow.cancelledReason).toBeNull();
    });
  });

  // --- 27: financial correctness ---

  describe('Financial correctness', () => {
    it('27. uses the immutable original transaction price, never a recomputed/current one', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-can-price', 'idem-can-price');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const originalLineTotal = Number(order.lines[0]!.lineTotalInclusive);
      const token = await csToken();

      // Change the live catalog price AFTER the order was placed - the
      // cancellation/credit-note flow must never re-derive from this.
      const merchToken = await merchandisingToken();
      const style = await testPrisma.style.findFirstOrThrow({ where: {} });
      await app.inject({
        method: 'POST',
        url: '/api/v1/catalog/prices',
        headers: { authorization: `Bearer ${merchToken}` },
        payload: { styleId: style.id, mrp: 999, sellingPrice: 999 },
      });

      await cancelLine(orderId, order.lines[0]!.id, token, 'idem-price-1');

      const lineAfter = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(Number(lineAfter.lineTotalInclusive)).toBe(originalLineTotal); // unchanged - a frozen snapshot

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const creditNote = await testPrisma.creditNote.findFirstOrThrow({ where: { originalInvoiceId: updatedOrder.invoiceId! } });
      const invoiceLine = await testPrisma.invoiceLine.findUniqueOrThrow({ where: { orderLineId: order.lines[0]!.id } });
      expect(Number(creditNote.totalTaxableValueReduction)).toBeCloseTo(Number(invoiceLine.taxableValue), 2);
    });
  });

  // --- 28-29: M17 shipment history preservation ---

  describe('M17 shipment/tracking history preservation', () => {
    it('28. cancelling a not-yet-shipped line never mutates a sibling fulfilment\'s existing Shipment/tracking history', async () => {
      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const wToken = await warehouseToken();
      const token = await csToken();

      const headers = { [GUEST_HEADER]: 'guest-can-shiphistory' };
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
          idempotencyKey: 'idem-can-shiphistory',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      const fulfilmentB = await readyToShipFulfilment(order.id, [order.lines[1]!.id], wToken);
      const shipRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/fulfilments/${fulfilmentB}/shipment`,
        headers: { authorization: `Bearer ${wToken}` },
        payload: { idempotencyKey: 'idem-shiphistory-book-1' },
      });
      expect(shipRes.statusCode).toBe(201);
      const shipmentId = shipRes.json().id as string;

      const bookedBody = JSON.stringify({ shipment_ref: shipRes.json().providerShipmentRef, status: 'in_transit', id: 'evt-shiphistory-1' });
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/shipping/mock',
        headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(bookedBody) },
        payload: bookedBody,
      });

      await cancelLine(order.id, order.lines[0]!.id, token, 'idem-shiphistory-1');

      const shipmentAfter = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
      expect(shipmentAfter.status).toBe('IN_TRANSIT'); // untouched
      const events = await testPrisma.shipmentTrackingEvent.findMany({ where: { shipmentId } });
      expect(events.length).toBeGreaterThan(0); // history never deleted
    });

    it('29. M00-M17 style/inventory/order/warehouse/shipping regression: a normal end-to-end order flow still works after M18', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-can-regression', 'idem-can-regression');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const wToken = await warehouseToken();

      const fulfilmentId = await readyToShipFulfilment(orderId, [order.lines[0]!.id], wToken);
      const shipRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${wToken}` } });
      expect(shipRes.statusCode).toBe(200);
      const deliverRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${wToken}` } });
      expect(deliverRes.statusCode).toBe(200);

      const finalOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(finalOrder.status).toBe('DELIVERED');
    });
  });
});
