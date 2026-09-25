import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';

/**
 * Returns (M19, specs/18-returns.md, RET-001-004; `RET-005` in
 * blueprint/DECISION_REGISTER.md) adversarial certification. Covers:
 * eligibility (window boundary/expiry, category/style policy override,
 * non-returnable, mandatory reason), initiation idempotency, customer/
 * guest/CS ownership and IDOR, reverse-pickup idempotency, warehouse
 * receipt, QC + disposition (all four outcomes) and the exactly-once
 * inventory-ledger invariant, the honest failed-QC refundEligible=false
 * DECISION_REQUIRED boundary, concurrency (double-receive, double-QC,
 * concurrent QC on different lines), and M00-M18 regression.
 */
describe('Returns (M19)', () => {
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

  async function csToken(perms: string[] = ['order:read', 'return:read', 'return:initiate']) {
    await grantPermissions('CUSTOMER_SERVICE', perms);
    return (await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE'])).token;
  }

  async function warehouseToken(
    perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'warehouse:pack', 'return:read', 'return:receive', 'return:qc'],
  ) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Returns Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLRETTST${counter}A1Z${counter % 10}`,
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
        styleCode: `RET-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Returns Test Jacket',
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

    return { skuId, styleId, categoryId: seeded.categoryId, locationId: seeded.locationId };
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
    return { orderId: order.id, headers };
  }

  /** Drives one order's single line all the way to DELIVERED, returns the delivered OrderLine id and the fulfilment id. */
  async function deliverOrderLine(orderId: string, token: string): Promise<{ lineId: string; fulfilmentId: string }> {
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;

    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: order.lines[0]!.quantity },
    });
    const fulfilRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/fulfilments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { lineIds: [lineId] },
    });
    const fulfilmentId = fulfilRes.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    const deliverRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${token}` } });
    expect(deliverRes.statusCode).toBe(200);

    return { lineId, fulfilmentId };
  }

  async function setDeliveredDaysAgo(fulfilmentId: string, days: number) {
    await testPrisma.orderFulfilment.update({
      where: { id: fulfilmentId },
      data: { deliveredAt: new Date(Date.now() - days * 86_400_000) },
    });
  }

  function initiateReturn(orderId: string, lines: { orderLineId: string; reason: string }[], token: string, idempotencyKey: string, method: 'PICKUP' | 'DROP_OFF' = 'DROP_OFF') {
    return app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId, lines, method, idempotencyKey },
    });
  }

  function initiateReturnAsCustomer(orderId: string, lines: { orderLineId: string; reason: string }[], headers: Record<string, string>, idempotencyKey: string, method: 'PICKUP' | 'DROP_OFF' = 'DROP_OFF') {
    return app.inject({
      method: 'POST',
      url: '/api/v1/storefront/returns',
      headers,
      payload: { orderId, lines, method, idempotencyKey },
    });
  }

  // --- 1-6: eligibility ---

  describe('Eligibility', () => {
    it('1. an eligible return within the window succeeds end to end (RECEIVED -> QC PASS -> DISPOSITIONED)', async () => {
      const { skuId, locationId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-1', 'idem-ret-1');
      const { lineId } = await deliverOrderLine(orderId, token);

      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Did not fit' }], headers, 'idem-ret-init-1');
      expect(initRes.statusCode).toBe(201);
      const returnId = initRes.json().id as string;
      expect(initRes.json().status).toBe('REQUESTED');

      const receiveRes = await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      expect(receiveRes.statusCode).toBe(200);
      expect(receiveRes.json().status).toBe('RECEIVED');

      const returnLine = await testPrisma.returnLine.findUniqueOrThrow({ where: { orderLineId: lineId } });
      const qcRes = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLine.id}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });
      expect(qcRes.statusCode).toBe(200);
      expect(qcRes.json().refundEligible).toBe(true);

      const finalReturn = await testPrisma.return.findUniqueOrThrow({ where: { id: returnId } });
      expect(finalReturn.status).toBe('DISPOSITIONED');

      const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(balance.returnPending).toBe(0);
      // 10 loaded -> SALE at ship (-1 = 9) -> RETURN_QC_PASS restocks it (+1 = 10, net unchanged - a full round trip).
      expect(balance.onHand).toBe(10);
    });

    it('2. exact window boundary (delivered exactly windowDays ago) still succeeds', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-boundary', 'idem-ret-boundary');
      const { lineId, fulfilmentId } = await deliverOrderLine(orderId, token);
      await setDeliveredDaysAgo(fulfilmentId, 7); // platform default RETURN_WINDOW_DEFAULT_DAYS

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Wrong size' }], headers, 'idem-ret-boundary-1');
      expect(res.statusCode).toBe(201);
    });

    it('3. a return requested after the window has expired is blocked', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-expired', 'idem-ret-expired');
      const { lineId, fulfilmentId } = await deliverOrderLine(orderId, token);
      await setDeliveredDaysAgo(fulfilmentId, 8);

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Too late' }], headers, 'idem-ret-expired-1');
      expect(res.statusCode).toBe(400);
      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
      expect(line.returnLine).toBeUndefined();
    });

    it('4. a category-level non-returnable policy blocks return initiation', async () => {
      const ctx = await seedContext();
      const { skuId, categoryId } = await setupCheckoutableSku(500, ctx);
      const token = await warehouseToken();
      await testPrisma.returnPolicy.create({ data: { categoryId, windowDays: 7, returnable: false } });

      const { orderId, headers } = await codOrder(skuId, 'guest-ret-nonreturnable', 'idem-ret-nonret');
      const { lineId } = await deliverOrderLine(orderId, token);

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Changed my mind' }], headers, 'idem-ret-nonret-1');
      expect(res.statusCode).toBe(400);
    });

    it('5. a style-level policy overrides a category-level policy', async () => {
      const ctx = await seedContext();
      const { skuId, styleId, categoryId } = await setupCheckoutableSku(500, ctx);
      const token = await warehouseToken();
      // Category says non-returnable, but this specific style overrides it back to returnable with a longer window.
      await testPrisma.returnPolicy.create({ data: { categoryId, windowDays: 7, returnable: false } });
      await testPrisma.returnPolicy.create({ data: { styleId, windowDays: 14, returnable: true } });

      const { orderId, headers } = await codOrder(skuId, 'guest-ret-styleoverride', 'idem-ret-style');
      const { lineId, fulfilmentId } = await deliverOrderLine(orderId, token);
      await setDeliveredDaysAgo(fulfilmentId, 10); // past the category's 7 days, within the style's 14

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Wrong colour' }], headers, 'idem-ret-style-1');
      expect(res.statusCode).toBe(201);
    });

    it('6. a return request without a reason is rejected (RET-002, mandatory unlike M18 cancellation)', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-noreason', 'idem-ret-noreason');
      const { lineId } = await deliverOrderLine(orderId, token);

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: '' }], headers, 'idem-ret-noreason-1');
      expect(res.statusCode).toBe(400);
    });

    it('7. a non-delivered line (still ALLOCATED) cannot be returned', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-notdelivered', 'idem-ret-notdelivered');
      const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: order.lines[0]!.id, reason: 'Too early' }], headers, 'idem-ret-notdelivered-1');
      expect(res.statusCode).toBe(400);
    });
  });

  // --- 8-9: duplicate/idempotency at initiation ---

  describe('Initiation idempotency', () => {
    it('8. an order line already returned once cannot be returned again', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-dup', 'idem-ret-dup');
      const { lineId } = await deliverOrderLine(orderId, token);

      const first = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'First attempt' }], headers, 'idem-ret-dup-1');
      expect(first.statusCode).toBe(201);

      const second = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Second attempt, different key' }], headers, 'idem-ret-dup-2');
      expect(second.statusCode).toBe(409);
    });

    it('9. a retried initiation request (same idempotency key) is a safe no-op, never a second Return row', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-retry', 'idem-ret-retry');
      const { lineId } = await deliverOrderLine(orderId, token);

      const first = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Retry test' }], headers, 'idem-ret-retry-1');
      const second = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Retry test' }], headers, 'idem-ret-retry-1');
      expect(first.json().id).toBe(second.json().id);

      const returns = await testPrisma.return.count({ where: { orderId } });
      expect(returns).toBe(1);
    });

    it('10. two genuinely concurrent initiation requests for the same line converge to exactly one Return', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-conc', 'idem-ret-conc');
      const { lineId } = await deliverOrderLine(orderId, token);

      const [r1, r2] = await Promise.all([
        initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'A' }], headers, 'idem-ret-conc-a'),
        initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'B' }], headers, 'idem-ret-conc-b'),
      ]);
      const statuses = [r1.statusCode, r2.statusCode].sort();
      expect(statuses).toEqual([201, 409]);

      const returns = await testPrisma.return.count({ where: { orderId } });
      expect(returns).toBe(1);
    });
  });

  // --- 11-14: ownership / IDOR / RBAC ---

  describe('Customer ownership, IDOR, and staff RBAC', () => {
    it('11. customer can initiate a return for their own delivered order', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-own', 'idem-ret-own');
      const { lineId } = await deliverOrderLine(orderId, token);

      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Mine' }], headers, 'idem-ret-own-1');
      expect(res.statusCode).toBe(201);
    });

    it('12. customer cannot initiate a return against another guest/customer order - clean 404, not a distinguishable 403', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ret-victim', 'idem-ret-victim');
      const { lineId } = await deliverOrderLine(orderId, token);

      const attackerHeaders = { [GUEST_HEADER]: 'guest-ret-attacker' };
      const res = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Not mine' }], attackerHeaders, 'idem-ret-attack-1');
      expect(res.statusCode).toBe(404);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
      expect(line.returnLine).toBeUndefined();
    });

    it('13. CS-assisted return initiation is recorded with STAFF attribution', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const wToken = await warehouseToken();
      const cToken = await csToken();
      const { orderId } = await codOrder(skuId, 'guest-ret-cs', 'idem-ret-cs');
      const { lineId } = await deliverOrderLine(orderId, wToken);

      const res = await initiateReturn(orderId, [{ orderLineId: lineId, reason: 'CS assisted' }], cToken, 'idem-ret-cs-1');
      expect(res.statusCode).toBe(201);
      expect(res.json().initiatedBy).toBe('STAFF');

      const auditRow = await testPrisma.auditLog.findFirst({ where: { action: 'return.initiate', entityId: res.json().id } });
      expect(auditRow?.actorType).toBe('STAFF');
    });

    it('14. a staff member without return:initiate is rejected', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const wToken = await warehouseToken();
      const { orderId } = await codOrder(skuId, 'guest-ret-unauth', 'idem-ret-unauth');
      const { lineId } = await deliverOrderLine(orderId, wToken);

      await grantPermissions('MARKETING', ['marketing:manage']);
      const { token: marketingToken } = await createAuthenticatedStaff(app, ['MARKETING']);

      const res = await initiateReturn(orderId, [{ orderLineId: lineId, reason: 'Should fail' }], marketingToken, 'idem-ret-unauth-1');
      expect(res.statusCode).toBe(403);
    });
  });

  // --- 15-16: reverse pickup idempotency ---

  describe('Reverse pickup (RET-004)', () => {
    it('15. scheduling a pickup is idempotent - a retried request with the same key returns the same ReturnPickup, never a duplicate booking', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-pickup', 'idem-ret-pickup');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Pickup test' }], headers, 'idem-ret-pickup-init', 'PICKUP');
      const returnId = initRes.json().id as string;

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/pickup`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'idem-ret-pickup-book-1' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/pickup`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'idem-ret-pickup-book-1' },
      });
      expect(first.json().id).toBe(second.json().id);

      const pickups = await testPrisma.returnPickup.count({ where: { returnId } });
      expect(pickups).toBe(1);
    });

    it('16. two genuinely concurrent pickup-scheduling requests (different keys) converge to exactly one ReturnPickup', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-pickup-conc', 'idem-ret-pickup-conc');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Concurrency test' }], headers, 'idem-ret-pickup-conc-init', 'PICKUP');
      const returnId = initRes.json().id as string;

      const [p1, p2] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/pickup`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'idem-ret-pickup-conc-a' } }),
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/pickup`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'idem-ret-pickup-conc-b' } }),
      ]);
      expect([p1.statusCode, p2.statusCode]).toEqual([200, 200]);

      const pickups = await testPrisma.returnPickup.count({ where: { returnId } });
      expect(pickups).toBe(1);
    });
  });

  // --- 17-19: warehouse receipt ---

  describe('Warehouse receipt', () => {
    it('17. marking a return received posts RETURN_RECEIVED - returnPending increments, onHand/damaged untouched', async () => {
      const { skuId, locationId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-receive', 'idem-ret-receive');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Receive test' }], headers, 'idem-ret-receive-init');
      const returnId = initRes.json().id as string;

      const balanceBefore = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });

      const res = await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);

      const balanceAfter = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(balanceAfter.returnPending).toBe(balanceBefore.returnPending + 1);
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
      expect(balanceAfter.damaged).toBe(balanceBefore.damaged);

      const rows = await testPrisma.inventoryTransaction.findMany({ where: { skuId, type: 'RETURN_RECEIVED' } });
      expect(rows).toHaveLength(1);
    });

    it('18. two genuinely concurrent markReceived calls converge to exactly one RETURN_RECEIVED ledger effect', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-receive-conc', 'idem-ret-receive-conc');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Concurrent receive' }], headers, 'idem-ret-receive-conc-init');
      const returnId = initRes.json().id as string;

      const [r1, r2] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } }),
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } }),
      ]);
      expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);

      const rows = await testPrisma.inventoryTransaction.findMany({ where: { skuId, type: 'RETURN_RECEIVED' } });
      expect(rows).toHaveLength(1);
    });

    it('19. a drop-off return can be marked received directly from REQUESTED (no pickup step required)', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-dropoff', 'idem-ret-dropoff');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Drop-off test' }], headers, 'idem-ret-dropoff-init', 'DROP_OFF');
      const returnId = initRes.json().id as string;

      const res = await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  // --- 20-27: QC + disposition ---

  describe('QC and disposition', () => {
    async function receivedReturn(reason = 'QC test') {
      const { skuId, locationId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, `guest-ret-qc-${Math.random()}`, `idem-ret-qc-${Math.random()}`);
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason }], headers, `idem-ret-qc-init-${Math.random()}`);
      const returnId = initRes.json().id as string;
      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      const returnLine = await testPrisma.returnLine.findUniqueOrThrow({ where: { orderLineId: lineId } });
      return { skuId, locationId, returnId, returnLineId: returnLine.id, token };
    }

    it('20. QC PASS with RESTOCK_SELLABLE: onHand increments, returnPending decrements, refundEligible true', async () => {
      const { skuId, locationId, returnId, returnLineId, token } = await receivedReturn();
      const before = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().refundEligible).toBe(true);

      const after = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(after.onHand).toBe(before.onHand + 1);
      expect(after.returnPending).toBe(before.returnPending - 1);
      expect(after.damaged).toBe(before.damaged);
    });

    it('21. QC FAIL with RESTOCK_DAMAGED: damaged increments, returnPending decrements, refundEligible false (DECISION_REQUIRED honored)', async () => {
      const { skuId, locationId, returnId, returnLineId, token } = await receivedReturn();
      const before = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'FAIL', disposition: 'RESTOCK_DAMAGED', notes: 'Minor stain' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().refundEligible).toBe(false); // no automatic financial consequence - the genuinely undefined branch

      const after = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(after.damaged).toBe(before.damaged + 1);
      expect(after.returnPending).toBe(before.returnPending - 1);
      expect(after.onHand).toBe(before.onHand);
    });

    it('22. QC FAIL with WRITE_OFF: neither onHand nor damaged changes, returnPending decrements only - stock genuinely leaves the ledger', async () => {
      const { skuId, locationId, returnId, returnLineId, token } = await receivedReturn();
      const before = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'FAIL', disposition: 'WRITE_OFF', notes: 'Irreparably damaged' },
      });
      expect(res.statusCode).toBe(200);

      const after = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(after.onHand).toBe(before.onHand);
      expect(after.damaged).toBe(before.damaged);
      expect(after.returnPending).toBe(before.returnPending - 1);

      const disposedRows = await testPrisma.inventoryTransaction.findMany({ where: { skuId, type: 'RETURN_DISPOSED' } });
      expect(disposedRows).toHaveLength(1);
    });

    it('23. QC FAIL with RETURN_TO_SUPPLIER: same balance effect as WRITE_OFF, distinguished on the ReturnLine record', async () => {
      const { skuId, locationId, returnId, returnLineId, token } = await receivedReturn();
      const before = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });

      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'FAIL', disposition: 'RETURN_TO_SUPPLIER' },
      });

      const after = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId } } });
      expect(after.onHand).toBe(before.onHand);
      expect(after.damaged).toBe(before.damaged);

      const line = await testPrisma.returnLine.findUniqueOrThrow({ where: { id: returnLineId } });
      expect(line.disposition).toBe('RETURN_TO_SUPPLIER');
    });

    it('24. a PASS result cannot use a non-sellable disposition, and a FAIL result cannot use RESTOCK_SELLABLE', async () => {
      const { returnId, returnLineId, token } = await receivedReturn();
      const bad1 = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'WRITE_OFF' },
      });
      expect(bad1.statusCode).toBe(400);

      const bad2 = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'FAIL', disposition: 'RESTOCK_SELLABLE' },
      });
      expect(bad2.statusCode).toBe(400);
    });

    it('25. a duplicate QC submission for an already-resolved line is an idempotent no-op, never double-posting', async () => {
      const { skuId, returnId, returnLineId, token } = await receivedReturn();
      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });
      expect(second.statusCode).toBe(200);

      const rows = await testPrisma.inventoryTransaction.findMany({ where: { skuId, type: 'RETURN_QC_PASS' } });
      expect(rows).toHaveLength(1);
    });

    it('26. the Return only rolls up to DISPOSITIONED once every line has a disposition (multi-line return)', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(500, ctx);
      const { skuId: skuId2 } = await setupCheckoutableSku(700, ctx);
      const token = await warehouseToken();

      const headers = { [GUEST_HEADER]: 'guest-ret-multiline' };
      await addToCart(skuId, headers);
      await addToCart(skuId2, headers);
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
          idempotencyKey: 'idem-ret-multiline',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      // Deliver both lines independently (each becomes its own fulfilment/pick task here since deliverOrderLine only handles line[0] - drive both manually).
      for (const line of order.lines) {
        const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });
        await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: `pick-${line.id}`, outcome: 'FULL', pickedQuantity: line.quantity } });
        const fulfilRes = await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/fulfilments`, headers: { authorization: `Bearer ${token}` }, payload: { lineIds: [line.id] } });
        const fulfilmentId = fulfilRes.json().id as string;
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${token}` } });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${token}` }, payload: {} });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${token}` } });
      }

      const initRes = await initiateReturnAsCustomer(
        order.id,
        order.lines.map((l) => ({ orderLineId: l.id, reason: 'Multi-line return' })),
        headers,
        'idem-ret-multiline-init',
      );
      expect(initRes.statusCode).toBe(201);
      const returnId = initRes.json().id as string;

      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      const returnLines = await testPrisma.returnLine.findMany({ where: { returnId } });
      expect(returnLines).toHaveLength(2);

      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLines[0]!.id}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });

      const mid = await testPrisma.return.findUniqueOrThrow({ where: { id: returnId } });
      expect(mid.status).toBe('RECEIVED'); // NOT yet dispositioned - one line still unresolved

      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLines[1]!.id}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });

      const final = await testPrisma.return.findUniqueOrThrow({ where: { id: returnId } });
      expect(final.status).toBe('DISPOSITIONED');
    });

    it('27. concurrent QC submissions on two DIFFERENT lines of the same Return never deadlock and both resolve correctly', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(500, ctx);
      const { skuId: skuId2 } = await setupCheckoutableSku(700, ctx);
      const token = await warehouseToken();

      const headers = { [GUEST_HEADER]: 'guest-ret-conc-qc' };
      await addToCart(skuId, headers);
      await addToCart(skuId2, headers);
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: { contactName: 'Jane Doe', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey: 'idem-ret-conc-qc' },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      for (const line of order.lines) {
        const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });
        await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: `pick-${line.id}`, outcome: 'FULL', pickedQuantity: line.quantity } });
        const fulfilRes = await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/fulfilments`, headers: { authorization: `Bearer ${token}` }, payload: { lineIds: [line.id] } });
        const fulfilmentId = fulfilRes.json().id as string;
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${token}` } });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${token}` }, payload: {} });
        await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${token}` } });
      }

      const initRes = await initiateReturnAsCustomer(order.id, order.lines.map((l) => ({ orderLineId: l.id, reason: 'Concurrent QC' })), headers, 'idem-ret-conc-qc-init');
      const returnId = initRes.json().id as string;
      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      const returnLines = await testPrisma.returnLine.findMany({ where: { returnId } });

      const [q1, q2] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/lines/${returnLines[0]!.id}/qc`, headers: { authorization: `Bearer ${token}` }, payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } }),
        app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/lines/${returnLines[1]!.id}/qc`, headers: { authorization: `Bearer ${token}` }, payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } }),
      ]);
      expect([q1.statusCode, q2.statusCode]).toEqual([200, 200]);

      const finalReturn = await testPrisma.return.findUniqueOrThrow({ where: { id: returnId } });
      expect(finalReturn.status).toBe('DISPOSITIONED');
    });
  });

  // --- 28-29: cancellation ---

  describe('Return cancellation', () => {
    it('28. a return can be cancelled before receipt', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-cancel', 'idem-ret-cancel');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Cancel test' }], headers, 'idem-ret-cancel-init');
      const returnId = initRes.json().id as string;

      const res = await app.inject({ method: 'POST', url: `/api/v1/storefront/returns/${returnId}/cancel`, headers, payload: { reason: 'Changed my mind about returning' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('CANCELLED');
    });

    it('29. a return already RECEIVED cannot be cancelled - must go through the warehouse QC/disposition flow', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();
      const { orderId, headers } = await codOrder(skuId, 'guest-ret-cancel-late', 'idem-ret-cancel-late');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Cancel-after-receive test' }], headers, 'idem-ret-cancel-late-init');
      const returnId = initRes.json().id as string;
      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });

      const res = await app.inject({ method: 'POST', url: `/api/v1/storefront/returns/${returnId}/cancel`, headers, payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  // --- 30-31: reconciliation + regression ---

  describe('Ledger reconciliation and M00-M18 regression', () => {
    it('30. InventoryService.reconcileBalance matches after a full return-to-disposition lifecycle (also the regression proof for the SALE-must-decrement-reserved-too fix reconcileBalance needed once this test exercised the RESERVATION -> ALLOCATION -> SALE chain)', async () => {
      const { skuId, locationId } = await setupCheckoutableSku(500);
      const token = await warehouseToken();

      // setupCheckoutableSku seeds InventoryBalance directly (a test-only
      // convenience shared across every integration test file in this
      // repo) without a backing ledger row - reconcileBalance replays
      // ONLY the ledger, so a genuine reconciliation proof needs the
      // opening balance to itself be ledger-backed (a real RECEIPT),
      // not the synthetic direct seed.
      const { InventoryService } = await import('../../src/modules/inventory/service.js');
      const inventory = new InventoryService(app);
      await testPrisma.inventoryBalance.delete({ where: { skuId_locationId: { skuId, locationId } } });
      await inventory.postReceipt({ skuId, locationId, quantity: 10, referenceType: 'TEST', referenceId: 'reconcile-seed' });

      const { orderId, headers } = await codOrder(skuId, 'guest-ret-reconcile', 'idem-ret-reconcile');
      const { lineId } = await deliverOrderLine(orderId, token);
      const initRes = await initiateReturnAsCustomer(orderId, [{ orderLineId: lineId, reason: 'Reconciliation test' }], headers, 'idem-ret-reconcile-init');
      const returnId = initRes.json().id as string;
      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${token}` } });
      const returnLine = await testPrisma.returnLine.findUniqueOrThrow({ where: { orderLineId: lineId } });
      await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLine.id}/qc`,
        headers: { authorization: `Bearer ${token}` },
        payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
      });

      const result = await inventory.reconcileBalance(skuId, locationId);
      expect(result.matches).toBe(true);
    });

    it('31. M00-M18 regression: a normal end-to-end order flow (COD -> pick -> pack -> ship -> deliver -> cancellation on an untouched second line) still works after M19', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(500, ctx);
      const { skuId: skuId2 } = await setupCheckoutableSku(300, ctx);
      const token = await warehouseToken(['order:read', 'order:fulfil', 'order:cancel', 'warehouse:read', 'warehouse:pick', 'warehouse:pack']);

      const headers = { [GUEST_HEADER]: 'guest-regression' };
      await addToCart(skuId, headers);
      await addToCart(skuId2, headers);
      const checkoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: { contactName: 'Jane Doe', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey: 'idem-regression' },
      });
      expect(checkoutRes.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/lines/${order.lines[1]!.id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'Regression check', idempotencyKey: 'idem-regression-cancel' },
      });
      expect(cancelRes.statusCode).toBe(200);

      const { fulfilmentId } = await deliverOrderLine(order.id, token);
      const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
      expect(fulfilment.status).toBe('DELIVERED');

      const finalOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(finalOrder.status).not.toBe('CANCELLED'); // one line delivered, one cancelled - order itself never force-cancelled
    });
  });
});
