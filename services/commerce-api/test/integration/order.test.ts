import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';
import { OrderService } from '../../src/modules/order/service.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}

function capturedEvent(orderId: string, paymentEntityId: string) {
  return {
    id: `evt_${paymentEntityId}_captured`,
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } },
  };
}

/**
 * M15 Order Management (specs/14-order-management.md, ORD-001-006).
 * Order is created in-process at genuine payment success (never via a
 * public endpoint) - both the COD path (CheckoutService) and the
 * PREPAID/Razorpay-capture path (PaymentService) are exercised here,
 * proving the same Order model results from either trigger.
 */
describe('Order Management (M15)', () => {
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
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith('/orders') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: `order_mock_${counter}` }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Order Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLORDTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function setupCheckoutableSku(sellingPrice: number, ctx?: Awaited<ReturnType<typeof seedContext>>) {
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
        styleCode: `ORD-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Order Test Jacket',
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
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: seeded.locationId, onHand: 10, reserved: 0 } });

    return skuId;
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function addToCart(skuId: string, headers: Record<string, string>, quantity = 1) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(res.statusCode).toBe(201);
  }

  /** COD checkout - genuinely CONFIRMED at submission, so an Order exists immediately. */
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

  /** PREPAID checkout, then a Razorpay capture webhook - the other order-creation trigger. */
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

  /**
   * Same PREPAID checkout as prepaidCapturedOrder, but stops BEFORE
   * sending the capture webhook - gives tests a real window between "a
   * legitimate payment/order trigger is about to fire" and "it fires",
   * in which to simulate a transient invoicing failure (e.g. a GST
   * registration briefly deactivated) without touching
   * OrderService/InvoiceService internals directly.
   */
  async function startPrepaidCheckoutPendingCapture(skuId: string, guestId: string, idempotencyKey: string) {
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
    return { sessionId, headers, providerReferenceId: payment.providerReferenceId! };
  }

  async function sendCaptureWebhook(providerReferenceId: string, idempotencyKey: string) {
    const body = JSON.stringify(capturedEvent(providerReferenceId, `pay_${idempotencyKey}`));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  }

  /**
   * M16: OrderService.assignLinesToFulfilment now requires PICKED, not
   * M15-original ALLOCATED - every pre-existing test that assigns lines
   * to a fulfilment must first genuinely pick them through the real HTTP
   * pick-task endpoint (not a direct DB write), proving the M16 gate
   * itself works end to end for every one of M15's own scenarios, not
   * just M16's own dedicated test file.
   */
  async function pickLine(lineId: string, warehouseToken: string) {
    const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${warehouseToken}` },
      payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: line.quantity },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PICKED');
  }

  /** Full pick -> assign -> pack -> ready-to-ship chain, returns the fulfilment id (now READY_TO_SHIP). */
  async function readyToShipFulfilment(orderId: string, lineIds: string[], warehouseToken: string): Promise<string> {
    for (const lineId of lineIds) {
      await pickLine(lineId, warehouseToken);
    }
    const fulfilRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/fulfilments`,
      headers: { authorization: `Bearer ${warehouseToken}` },
      payload: { lineIds },
    });
    expect(fulfilRes.statusCode).toBe(201);
    const fulfilmentId = fulfilRes.json().id as string;
    const packRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`,
      headers: { authorization: `Bearer ${warehouseToken}` },
    });
    expect(packRes.statusCode).toBe(200);
    const readyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`,
      headers: { authorization: `Bearer ${warehouseToken}` },
    });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().status).toBe('READY_TO_SHIP');
    return fulfilmentId;
  }

  describe('Order creation trigger', () => {
    it('creates an Order + invoice when a COD checkout is accepted, converting the reservation to a committed allocation', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-cod', 'idem-ord-cod');

      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      expect(order.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
      expect(order.status).toBe('CONFIRMED');
      expect(order.paymentMethod).toBe('COD');
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0]!.status).toBe('ALLOCATED');
      expect(order.invoiceId).not.toBeNull();

      const invoice = await testPrisma.invoice.findUniqueOrThrow({ where: { id: order.invoiceId! } });
      expect(invoice.orderId).toBe(order.id);

      const ledgerEntry = await testPrisma.inventoryTransaction.findFirst({ where: { skuId, type: 'ALLOCATION' } });
      expect(ledgerEntry).not.toBeNull();
    });

    it('creates an Order when a Razorpay payment is captured via webhook (PREPAID trigger)', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-ord-prepaid', 'idem-ord-prepaid');

      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('CONFIRMED');
      expect(order.paymentMethod).toBe('PREPAID');
      expect(order.invoiceId).not.toBeNull();
    });
  });

  describe('Split shipment (FLOW 8)', () => {
    it('two lines of a multi-line order can be packed/shipped/delivered independently, posting a SALE transaction per shipment', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const headers = { [GUEST_HEADER]: 'guest-ord-split' };
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
          idempotencyKey: 'idem-ord-split',
        },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({
        where: { checkoutSessionId: checkoutRes.json().id },
        include: { lines: true },
      });
      expect(order.lines).toHaveLength(2);
      const [lineA, lineB] = order.lines;

      // Ship line A immediately.
      const fulfilmentAId = await readyToShipFulfilment(order.id, [lineA!.id], warehouseToken);
      const shipARes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/fulfilments/${fulfilmentAId}/ship`,
        headers: { authorization: `Bearer ${warehouseToken}` },
        payload: { carrierName: 'BlueDart', trackingRef: 'BD123' },
      });
      expect(shipARes.statusCode).toBe(200);
      expect(shipARes.json().status).toBe('SHIPPED');

      // Line B is "back-ordered" - not yet fulfilled at all.
      let orderView = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: { authorization: `Bearer ${warehouseToken}` } });
      expect(orderView.json().status).toBe('PROCESSING');
      const lineBView = orderView.json().lines.find((l: { id: string }) => l.id === lineB!.id);
      expect(lineBView.status).toBe('ALLOCATED');

      // SALE posted for the shipped line only.
      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE' } });
      expect(saleTxns).toHaveLength(1);
      expect(saleTxns[0]!.skuId).toBe(lineA!.skuId);

      const balanceA = await testPrisma.inventoryBalance.findFirst({ where: { skuId: lineA!.skuId } });
      expect(balanceA!.onHand).toBe(9); // decremented on sale
      expect(balanceA!.reserved).toBe(0);

      // Now line B ships as its own, independently-tracked second shipment.
      const fulfilmentBId = await readyToShipFulfilment(order.id, [lineB!.id], warehouseToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentBId}/ship`, headers: { authorization: `Bearer ${warehouseToken}` } });

      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentAId}/deliver`, headers: { authorization: `Bearer ${warehouseToken}` } });
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentBId}/deliver`, headers: { authorization: `Bearer ${warehouseToken}` } });

      orderView = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: { authorization: `Bearer ${warehouseToken}` } });
      expect(orderView.json().status).toBe('DELIVERED');
      expect(orderView.json().fulfilments).toHaveLength(2);
    });

    it('rejects packing a fulfilment for a role lacking order:fulfil', async () => {
      const { token } = await createAuthenticatedStaff(app, ['ANALYTICS']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/orders/fulfilments/00000000-0000-0000-0000-000000000000/pack',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  /**
   * Independent-review finding #5 (BLOCKER/HIGH): InventoryService.
   * recordSale() previously clamped its onHand/reserved decrements with
   * `Math.max(0, ...)`, which prevents a negative column value but
   * silently MASKS a shipment that expects to move more stock than is
   * genuinely on hand/reserved/allocated - it would still "succeed",
   * quietly writing a SALE row for less than the requested quantity.
   * These tests force each corruption/mismatch scenario directly (not
   * relying on OrderService ever actually producing bad data - the
   * review's own point is that InventoryService must not assume it
   * will) and prove the whole shipment transaction is rejected
   * atomically: no SALE row, fulfilment/line stay PACKED (not SHIPPED),
   * and balances are byte-for-byte unchanged.
   */
  describe('Shipment inventory invariant hardening (independent-review finding #5)', () => {
    /** Picks, packs, and advances to READY_TO_SHIP - the precondition markFulfilmentShipped now requires (M16). */
    async function packedFulfilment(orderId: string, lineId: string, warehouseToken: string) {
      return readyToShipFulfilment(orderId, [lineId], warehouseToken);
    }

    async function shipFulfilment(fulfilmentId: string, warehouseToken: string) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`,
        headers: { authorization: `Bearer ${warehouseToken}` },
        payload: {},
      });
    }

    it('A: rejects shipment when on-hand stock is insufficient for the order line quantity, leaving no partial trace', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-onhand', 'idem-inv5-onhand');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      // Simulate onHand having been corrupted/drawn down by something
      // else to below what this shipment expects to move - InventoryService
      // must catch this itself, not trust the caller. reserved must drop
      // with it (reserved <= onHand is a DB CHECK constraint) - the
      // reserved-insufficient case is covered separately by test B.
      await testPrisma.inventoryBalance.update({
        where: { skuId_locationId: { skuId, locationId: line.locationId } },
        data: { onHand: 0, reserved: 0 },
      });

      const shipRes = await shipFulfilment(fulfilmentId, warehouseToken);
      expect(shipRes.statusCode).toBe(409);
      expect(shipRes.json().error.code).toBe('INVENTORY_INTEGRITY_VIOLATION');

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('READY_TO_SHIP'); // never advanced to SHIPPED
      const refreshedLine = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
      expect(refreshedLine.status).toBe('PACKED');
      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId } });
      expect(saleTxns).toHaveLength(0);
      const balanceAfter = await testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId } });
      // Untouched by the shipment attempt itself - still exactly the
      // (corrupted, pre-attempt) values, not further mutated.
      expect(balanceAfter.onHand).toBe(0);
      expect(balanceAfter.reserved).toBe(0);
    });

    it('B: rejects shipment when reserved stock is insufficient for the order line quantity, leaving no partial trace', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-reserved', 'idem-inv5-reserved');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      const balanceBefore = await testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId } });
      // onHand is plenty, but reserved has been corrupted down to zero -
      // this line's allocation is no longer backed by a real reservation
      // count, even though physical stock exists.
      await testPrisma.inventoryBalance.update({
        where: { skuId_locationId: { skuId, locationId: line.locationId } },
        data: { reserved: 0 },
      });

      const shipRes = await shipFulfilment(fulfilmentId, warehouseToken);
      expect(shipRes.statusCode).toBe(409);
      expect(shipRes.json().error.code).toBe('INVENTORY_INTEGRITY_VIOLATION');

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('READY_TO_SHIP');
      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId } });
      expect(saleTxns).toHaveLength(0);
      const balanceAfter = await testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId } });
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand); // untouched
    });

    it('C: rejects shipment when the order line\'s backing reservation is missing (deleted/corrupted), leaving no partial trace', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-missing-res', 'idem-inv5-missing-res');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      // Corrupt the order line to point at a reservation id that does
      // not exist - the allocation this shipment claims to fulfil is
      // not real.
      await testPrisma.orderLine.update({ where: { id: line.id }, data: { reservationId: '00000000-0000-0000-0000-000000000000' } });

      const shipRes = await shipFulfilment(fulfilmentId, warehouseToken);
      expect(shipRes.statusCode).toBe(409);
      expect(shipRes.json().error.code).toBe('INVENTORY_INTEGRITY_VIOLATION');

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('READY_TO_SHIP');
      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId } });
      expect(saleTxns).toHaveLength(0);
    });

    it('D: rejects shipment when the backing reservation was never actually converted into a firm allocation (still ACTIVE)', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-active-res', 'idem-inv5-active-res');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      // Corrupt the reservation's status back to ACTIVE, as if it had
      // never genuinely been converted into a firm order allocation -
      // InventoryService must not trust the order line's ALLOCATED/
      // PACKED status alone.
      await testPrisma.inventoryReservation.update({ where: { id: line.reservationId! }, data: { status: 'ACTIVE' } });

      const shipRes = await shipFulfilment(fulfilmentId, warehouseToken);
      expect(shipRes.statusCode).toBe(409);
      expect(shipRes.json().error.code).toBe('INVENTORY_INTEGRITY_VIOLATION');

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('READY_TO_SHIP');
      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId } });
      expect(saleTxns).toHaveLength(0);
    });

    it('E: rejects shipment when the backing reservation allocated fewer units than this shipment claims', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-undersized', 'idem-inv5-undersized', 2);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      expect(line.quantity).toBe(2);
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      // The reservation genuinely allocated fewer units (1) than the
      // order line claims to ship (2) - a data-integrity mismatch, not
      // a normal state (still a valid positive reservation quantity, so
      // this exercises the undersized-allocation check specifically,
      // distinct from test C's "no reservation at all").
      await testPrisma.inventoryReservation.update({ where: { id: line.reservationId! }, data: { quantity: 1 } });

      const shipRes = await shipFulfilment(fulfilmentId, warehouseToken);
      expect(shipRes.statusCode).toBe(409);
      expect(shipRes.json().error.code).toBe('INVENTORY_INTEGRITY_VIOLATION');

      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('READY_TO_SHIP');
    });

    it('F: a genuinely concurrent double-ship attempt on the same fulfilment posts exactly one SALE and decrements the balance exactly once', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-inv5-concurrent-ship', 'idem-inv5-concurrent-ship');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      const fulfilmentId = await packedFulfilment(orderId, line.id, warehouseToken);

      const [resA, resB] = await Promise.all([shipFulfilment(fulfilmentId, warehouseToken), shipFulfilment(fulfilmentId, warehouseToken)]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      // Exactly one wins (200). The loser's rejection code depends on
      // exact timing: markFulfilmentShipped's own READY_TO_SHIP-status
      // read is not itself row-locked, so both callers can occasionally pass it
      // before either commits - but recordSale's own invariant checks
      // (this finding) are the real backstop either way: the loser then
      // either finds the fulfilment already SHIPPED (400) or, having
      // raced past that check too, hits recordSale's now-insufficient
      // reserved/onHand check directly (409) - never a silent double-sale.
      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]);

      const saleTxns = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId } });
      expect(saleTxns).toHaveLength(1);
      const balance = await testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId } });
      expect(balance.onHand).toBe(9); // decremented exactly once, not twice
      expect(balance.reserved).toBe(0);
    });
  });

  describe('Partial cancellation (FLOW 7)', () => {
    it('cancelling a pre-shipment line releases its allocation and flags refund required for a PREPAID order', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-ord-cancel-prepaid', 'idem-ord-cancel-prepaid');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${line.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Customer requested cancellation' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');

      const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: line.reservationId! } });
      expect(reservation.status).toBe('RELEASED');

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.status).toBe('CANCELLED'); // only line, and it's the only line
      expect(updatedOrder.refundRequired).toBe(true);

      const ledgerEntry = await testPrisma.inventoryTransaction.findFirst({ where: { skuId, type: 'CANCELLATION' } });
      expect(ledgerEntry).not.toBeNull();
    });

    it('cancelling a line on a COD order does not require a refund (nothing was collected)', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-cancel-cod', 'idem-ord-cancel-cod');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${order.lines[0]!.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Out of stock at pick time' },
      });
      expect(res.statusCode).toBe(200);

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.refundRequired).toBe(false);
    });

    it('the remaining line proceeds unaffected when one line of a multi-line order is cancelled', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const ctx = await seedContext();
      const skuA = await setupCheckoutableSku(500, ctx);
      const skuB = await setupCheckoutableSku(700, ctx);
      const headers = { [GUEST_HEADER]: 'guest-ord-partial-cancel' };
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
          idempotencyKey: 'idem-ord-partial-cancel',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({
        where: { checkoutSessionId: checkoutRes.json().id },
        include: { lines: true },
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/lines/${order.lines[0]!.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Customer changed mind on one item' },
      });

      const updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      // Not CANCELLED - the other line is still active/proceeding.
      expect(updatedOrder.status).toBe('PROCESSING');

      const remainingLine = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[1]!.id } });
      expect(remainingLine.status).toBe('ALLOCATED');
    });
  });

  describe('Negative scenario #1: cannot cancel a shipped line', () => {
    it('blocks cancellation once a line has shipped - routes to return instead', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-blocked-cancel', 'idem-ord-blocked-cancel');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;

      const fulfilmentId = await readyToShipFulfilment(orderId, [line.id], warehouseToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${warehouseToken}` } });

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${line.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Too late attempt' },
      });
      expect(cancelRes.statusCode).toBe(400);
    });
  });

  describe('Negative scenario #2: order exception handling', () => {
    it('flags a pick-shortfall exception, which is not silently stuck and can be resolved', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:exception:manage']);
      const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-exception', 'idem-ord-exception');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;

      const flagRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${line.id}/exception`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'Pick shortfall - short by 1 unit' },
      });
      expect(flagRes.statusCode).toBe(200);
      expect(flagRes.json().status).toBe('EXCEPTION');

      let updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.status).toBe('EXCEPTION');

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${line.id}/exception/resolve`,
        headers: { authorization: `Bearer ${token}` },
        payload: { resolution: 'REINSTATE', reason: 'Stock found on re-count' },
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json().status).toBe('ALLOCATED');

      updatedOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(updatedOrder.status).toBe('PROCESSING');
    });
  });

  describe('RTO (FLOW 15)', () => {
    it('closes a COD order with no refund on RTO', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:rto']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-rto-cod', 'idem-ord-rto-cod');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;

      const fulfilmentId = await readyToShipFulfilment(orderId, [line.id], warehouseToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${warehouseToken}` } });

      const rtoRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/rto`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Repeated failed delivery attempts, carrier reported RTO' },
      });
      expect(rtoRes.statusCode).toBe(200);
      expect(rtoRes.json().status).toBe('RTO');
      expect(rtoRes.json().refundRequired).toBe(false);
    });

    it('flags refund required on RTO for a PREPAID order', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:rto']);
      const { token: warehouseToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await prepaidCapturedOrder(skuId, 'guest-ord-rto-prepaid', 'idem-ord-rto-prepaid');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;

      const fulfilmentId = await readyToShipFulfilment(orderId, [line.id], warehouseToken);
      await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${warehouseToken}` } });

      const rtoRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/rto`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Carrier reported RTO' },
      });
      expect(rtoRes.statusCode).toBe(200);
      expect(rtoRes.json().refundRequired).toBe(true);
    });

    it('rejects RTO on an order that has not shipped', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:rto']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-rto-tooearly', 'idem-ord-rto-tooearly');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/rto`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Premature attempt' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Data integrity: allocation traceability', () => {
    it('every order line traces back to the exact reservation it converted from', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-traceability', 'idem-ord-traceability');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
      const line = order.lines[0]!;
      expect(line.reservationId).not.toBeNull();

      const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: line.reservationId! } });
      expect(reservation.skuId).toBe(skuId);
      expect(reservation.status).toBe('CONVERTED');
    });
  });

  describe('Auditability: full order history retained', () => {
    it('logs every state transition with an entity/action pair queryable by order id', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const skuId = await setupCheckoutableSku(500);
      const { orderId } = await codOrder(skuId, 'guest-ord-audit', 'idem-ord-audit');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/lines/${order.lines[0]!.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Audit trail check' },
      });

      const createEntry = await testPrisma.auditLog.findFirst({ where: { action: 'order.create', entityId: orderId } });
      expect(createEntry).not.toBeNull();
      expect(createEntry!.actorType).toBe('SYSTEM');

      const cancelEntry = await testPrisma.auditLog.findFirst({ where: { action: 'order.line.cancel', reference: orderId } });
      expect(cancelEntry).not.toBeNull();
      expect(cancelEntry!.actorType).toBe('STAFF');
    });
  });

  describe('Storefront: customer order history', () => {
    it('lets the owning guest read their own order, and no one else', async () => {
      const skuId = await setupCheckoutableSku(500);
      const { orderId, headers } = await codOrder(skuId, 'guest-ord-owner', 'idem-ord-owner-read');

      const ownRes = await app.inject({ method: 'GET', url: `/api/v1/storefront/orders/${orderId}`, headers });
      expect(ownRes.statusCode).toBe(200);
      expect(ownRes.json().id).toBe(orderId);

      const listRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/orders', headers });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json()).toHaveLength(1);

      const otherRes = await app.inject({
        method: 'GET',
        url: `/api/v1/storefront/orders/${orderId}`,
        headers: { [GUEST_HEADER]: 'guest-ord-not-owner' },
      });
      expect(otherRes.statusCode).toBe(404);

      const { token: customerToken } = await createAuthenticatedCustomer(app);
      const customerRes = await app.inject({
        method: 'GET',
        url: `/api/v1/storefront/orders/${orderId}`,
        headers: { authorization: `Bearer ${customerToken}` },
      });
      expect(customerRes.statusCode).toBe(404);
    });
  });

  /**
   * Independent-review finding #2 (BLOCKER): a confirmed/paid order must
   * never exist permanently without its required invoice. The original
   * design logged-and-swallowed a transient invoice-issuance failure,
   * leaving Order.invoiceId null with no durable trace to recover from.
   * These six tests (A-F per the review) inject a REAL, deterministic
   * failure - deactivating the GST registration in the real gap between
   * "checkout confirms payment" and "the capture webhook triggers order
   * creation" (see startPrepaidCheckoutPendingCapture/sendCaptureWebhook
   * above) - then prove the durable recovery path.
   */
  describe('Durable invoice recovery (independent-review finding #2)', () => {
    async function seedContextWithGstRegistrationId() {
      const ctx = await seedContext();
      const location = await testPrisma.location.findUniqueOrThrow({ where: { id: ctx.locationId } });
      return { ...ctx, gstRegistrationId: location.gstRegistrationId! };
    }

    it('A: a normal order results in exactly one linked, ISSUED invoice', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { orderId } = await codOrder(skuId, 'guest-inv-normal', 'idem-inv-normal');

      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.invoiceStatus).toBe('ISSUED');
      expect(order.invoiceId).not.toBeNull();
      const invoices = await testPrisma.invoice.findMany({ where: { orderId } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]!.id).toBe(order.invoiceId);
    });

    it('B: a forced invoice failure leaves the order valid, with a durable failure record (not just a log line)', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-fail', 'idem-inv-fail');

      // Simulate a transient invoicing failure in the real gap between
      // checkout confirming payment intent and the capture webhook
      // triggering order+invoice creation.
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });

      await sendCaptureWebhook(providerReferenceId, 'idem-inv-fail');

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      // The order itself is NOT lost or rolled back - payment was genuinely captured.
      expect(order.status).toBe('CONFIRMED');
      expect(order.invoiceId).toBeNull();
      expect(order.invoiceStatus).toBe('FAILED');
      expect(order.invoiceFailureReason).toBeTruthy();
      expect(order.invoiceAttempts).toBe(1);

      const invoices = await testPrisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(0);
    });

    it('C: retrying after the transient condition clears creates and links exactly one invoice', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-retry', 'idem-inv-retry');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });
      await sendCaptureWebhook(providerReferenceId, 'idem-inv-retry');

      let order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(order.invoiceStatus).toBe('FAILED');

      // The transient condition clears.
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'ACTIVE' } });

      const orderService = new OrderService(app);
      await orderService.retryOrderInvoice(order.id);

      order = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(order.invoiceStatus).toBe('ISSUED');
      expect(order.invoiceId).not.toBeNull();
      const invoices = await testPrisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
    });

    it('D: retrying an already-recovered order repeatedly still produces exactly one invoice', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-repeat', 'idem-inv-repeat');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });
      await sendCaptureWebhook(providerReferenceId, 'idem-inv-repeat');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'ACTIVE' } });

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      const orderService = new OrderService(app);
      await orderService.retryOrderInvoice(order.id);
      await orderService.retryOrderInvoice(order.id);
      await orderService.retryOrderInvoice(order.id);

      const invoices = await testPrisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
      const finalOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.invoiceId).toBe(invoices[0]!.id);
    });

    it('E: two genuinely concurrent recovery attempts for the same order still produce exactly one invoice', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-concurrent', 'idem-inv-concurrent');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });
      await sendCaptureWebhook(providerReferenceId, 'idem-inv-concurrent');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'ACTIVE' } });

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      const serviceA = new OrderService(app);
      const serviceB = new OrderService(app);
      await Promise.all([serviceA.retryOrderInvoice(order.id), serviceB.retryOrderInvoice(order.id)]);

      const invoices = await testPrisma.invoice.findMany({ where: { orderId: order.id } });
      expect(invoices).toHaveLength(1);
      const finalOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.invoiceStatus).toBe('ISSUED');
      expect(finalOrder.invoiceId).toBe(invoices[0]!.id);
    });

    it('F: recovery is driven entirely by durable database state, not in-memory state - proven with a fresh OrderService instance (process-restart simulation)', async () => {
      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-restart', 'idem-inv-restart');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });
      await sendCaptureWebhook(providerReferenceId, 'idem-inv-restart');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'ACTIVE' } });

      const failedOrder = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
      expect(failedOrder.invoiceStatus).toBe('FAILED');

      // A brand-new OrderService instance, with no reference to (or
      // memory of) the original request/webhook that caused the
      // failure - the only thing driving recovery is the order row's
      // own invoiceStatus/invoiceId columns.
      const freshProcessOrderService = new OrderService(app);
      const result = await freshProcessOrderService.reconcilePendingInvoices();
      expect(result.attempted).toBeGreaterThanOrEqual(1);
      expect(result.succeeded).toBeGreaterThanOrEqual(1);

      const recovered = await testPrisma.order.findUniqueOrThrow({ where: { id: failedOrder.id } });
      expect(recovered.invoiceStatus).toBe('ISSUED');
      expect(recovered.invoiceId).not.toBeNull();
    });

    it('lists orders with a failed invoice via the staff query filter, and lets staff manually retry via the route', async () => {
      await grantPermissions('FINANCE', ['order:read', 'invoice:create']);
      const { token } = await createAuthenticatedStaff(app, ['FINANCE']);

      const ctx = await seedContextWithGstRegistrationId();
      const skuId = await setupCheckoutableSku(500, ctx);
      const { sessionId, providerReferenceId } = await startPrepaidCheckoutPendingCapture(skuId, 'guest-inv-route', 'idem-inv-route');
      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'PENDING' } });
      await sendCaptureWebhook(providerReferenceId, 'idem-inv-route');

      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/orders?invoiceStatus=FAILED',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().items.map((o: { id: string }) => o.id)).toContain(order.id);

      await testPrisma.gstRegistration.update({ where: { id: ctx.gstRegistrationId }, data: { status: 'ACTIVE' } });

      const retryRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/retry-invoice`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().invoiceStatus).toBe('ISSUED');
    });
  });
});
