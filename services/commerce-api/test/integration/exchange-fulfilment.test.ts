import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110004';
const MOCK_WEBHOOK_SECRET = 'mock-carrier-webhook-secret-test-only';

function signShipping(rawBody: string, secret = MOCK_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
function trackingEvent(shipmentRef: string, status: string, occurredAt = new Date(), id?: string) {
  return JSON.stringify({ id: id ?? `${shipmentRef}-${status}-${occurredAt.getTime()}`, shipment_ref: shipmentRef, status, occurred_at: occurredAt.toISOString() });
}

/**
 * EXC-004 Option 2 repair (2026-09-26, Product Owner decision) -
 * Exchange replacement physical fulfilment, generalizing M16/M17's
 * certified PickTask/OrderFulfilment/Shipment pipeline to serve an
 * Exchange replacement as an alternate fulfilment source (nullable
 * dual-source FKs - PickTask.orderLineId XOR PickTask.exchangeId,
 * same-row CHECK; OrderFulfilment.exchangeId vs its child order_lines,
 * cross-table trigger pair). Covers the full target lifecycle
 * (reservation -> QC/payment settlement -> allocation -> pick -> pack ->
 * READY_TO_SHIP -> ship -> tracking -> delivered -> Exchange COMPLETED),
 * the new EXCHANGE_DISPATCH ledger type (never a second SALE), every
 * certified M16/M17 invariant preserved unchanged for normal OrderLine
 * fulfilment, and the required adversarial matrix (concurrency,
 * idempotency, IDOR/BOLA, RBAC, webhook dedup, cross-exchange
 * isolation).
 */
describe('Exchange replacement fulfilment (EXC-004 Option 2)', () => {
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
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }
  async function warehouseToken(
    perms: string[] = [
      'order:read',
      'order:fulfil',
      'warehouse:read',
      'warehouse:pick',
      'warehouse:pack',
      'shipping:manage',
      'exchange:read',
      'exchange:initiate',
      'exchange:receive',
      'exchange:qc',
      'exchange:fulfil',
    ],
  ) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }
  async function operatorToken(
    perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'shipping:manage', 'exchange:read', 'exchange:receive'],
  ) {
    await grantPermissions('WAREHOUSE_OPERATOR', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_OPERATOR'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Exchange Fulfilment Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLEXFTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    const secondSize = await testPrisma.size.create({ data: { label: `L-${counter}`, sortOrder: 1 } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, secondSizeId: secondSize.id, locationId: location.id };
  }

  async function setupExchangeableStyle(sellingPrice: number, ctx?: Awaited<ReturnType<typeof seedContext>>) {
    const token = await merchandisingToken();
    const seeded = ctx ?? (await seedContext());
    const hsnCode = '6109';
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: `EXF-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, name: 'Exchange Fulfilment Test Hoodie', brandId: seeded.brandId, categoryId: seeded.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = styleRes.json().id as string;
    const blackRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'Black', colourCode: 'BLK' } });
    const blackId = blackRes.json().id as string;

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${token}` }, payload: { sizeIds: [seeded.sizeId, seeded.secondSizeId] } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId: blackId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });

    const skuM = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: seeded.sizeId } });
    const skuL = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: seeded.secondSizeId } });
    for (const sku of [skuM, skuL]) {
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: seeded.locationId, onHand: 10, reserved: 0 } });
    }
    return { styleId, locationId: seeded.locationId, skuM, skuL };
  }

  function validAddress() {
    return { line1: '9 Exchange Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }
  async function addToCart(skuId: string, headers: Record<string, string>) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });
    expect(res.statusCode).toBe(201);
  }
  async function codOrder(skuId: string, guestId: string, idempotencyKey: string) {
    const headers = { [GUEST_HEADER]: guestId };
    await addToCart(skuId, headers);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: { contactName: 'Jane Doe', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey },
    });
    expect(res.statusCode).toBe(201);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    return { orderId: order.id, headers };
  }

  async function deliverOrderLine(orderId: string, token: string): Promise<{ lineId: string }> {
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: order.lines[0]!.quantity } });
    const fulfilRes = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/fulfilments`, headers: { authorization: `Bearer ${token}` }, payload: { lineIds: [lineId] } });
    const fulfilmentId = fulfilRes.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    const deliverRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${token}` } });
    expect(deliverRes.statusCode).toBe(200);
    return { lineId };
  }

  function initiateExchange(orderId: string, orderLineId: string, replacementSkuId: string, token: string, idempotencyKey: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/exchanges',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId, orderLineId, replacementSkuId, reason: 'Wrong size', method: 'DROP_OFF', idempotencyKey },
    });
  }
  async function receiveAndQcPass(exchangeId: string, token: string) {
    await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchangeId}/receive`, headers: { authorization: `Bearer ${token}` } });
    const qcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/exchanges/${exchangeId}/qc`,
      headers: { authorization: `Bearer ${token}` },
      payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
    });
    expect(qcRes.statusCode).toBe(200);
    return qcRes.json();
  }

  /** Drives one full same-size/size-exchange fixture to REPLACEMENT_ALLOCATED (its own auto-created PickTask included). */
  async function toReplacementAllocated(token: string, guestSuffix: string, ctx?: Awaited<ReturnType<typeof seedContext>>) {
    const fixture = await setupExchangeableStyle(1500, ctx);
    const { orderId } = await codOrder(fixture.skuM.id, `guest-exf-${guestSuffix}-${counter}`, `idem-exf-${guestSuffix}-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);
    const initRes = await initiateExchange(orderId, lineId, fixture.skuL.id, token, `exc-exf-${guestSuffix}-${counter}`);
    expect(initRes.statusCode).toBe(201);
    const exchange = initRes.json();
    const allocated = await receiveAndQcPass(exchange.id, token);
    expect(allocated.status).toBe('REPLACEMENT_ALLOCATED');
    return { exchangeId: exchange.id as string, orderId, fixture };
  }

  async function pickReplacement(exchangeId: string, token: string) {
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { exchangeId } });
    return app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: `pick-exc-${exchangeId}`, outcome: 'FULL', pickedQuantity: task.allocatedQuantity },
    });
  }
  function assignReplacementToFulfilment(exchangeId: string, token: string) {
    return app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchangeId}/fulfilment`, headers: { authorization: `Bearer ${token}` } });
  }
  async function readyToShipReplacement(exchangeId: string, token: string): Promise<string> {
    const pickRes = await pickReplacement(exchangeId, token);
    expect(pickRes.statusCode).toBe(200);
    const assignRes = await assignReplacementToFulfilment(exchangeId, token);
    expect(assignRes.statusCode).toBe(201);
    const fulfilmentId = assignRes.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${token}` } });
    const readyRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${token}` } });
    expect(readyRes.statusCode).toBe(200);
    return fulfilmentId;
  }
  function shipManually(fulfilmentId: string, token: string) {
    return app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${token}` }, payload: {} });
  }
  function deliverManually(fulfilmentId: string, token: string) {
    return app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${token}` } });
  }
  function createShipmentHttp(fulfilmentId: string, token: string, idempotencyKey: string) {
    return app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/shipment`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey } });
  }
  function sendTracking(providerShipmentRef: string, status: string, id: string) {
    const body = trackingEvent(providerShipmentRef, status, new Date(), id);
    return app.inject({ method: 'POST', url: '/api/v1/webhooks/shipping/mock', headers: { 'content-type': 'application/json', 'x-shipping-signature': signShipping(body) }, payload: body });
  }

  // --- 1. Normal OrderLine fulfilment remains unchanged ---

  it('normal OrderLine fulfilment behaves exactly as before (unaffected by the generalized pipeline)', async () => {
    const token = await warehouseToken();
    const fixture = await setupExchangeableStyle(1200);
    const { orderId } = await codOrder(fixture.skuM.id, `guest-normal-${counter}`, `idem-normal-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);

    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('DELIVERED');
    const saleRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: lineId } });
    expect(saleRows).toHaveLength(1);
    const fulfilment = await testPrisma.orderFulfilment.findFirstOrThrow({ where: { orderId } });
    expect(fulfilment.exchangeId).toBeNull();
  });

  // --- 2. Happy path: pick -> pack -> ready -> ship -> deliver -> Exchange COMPLETED automatically ---

  it('drives an Exchange replacement through pick/pack/ship/deliver, posting EXCHANGE_DISPATCH (never SALE) and completing the Exchange automatically on delivery', async () => {
    const token = await warehouseToken();
    const { exchangeId, fixture } = await toReplacementAllocated(token, 'happy');

    const fulfilmentId = await readyToShipReplacement(exchangeId, token);
    const fulfilmentBefore = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    expect(fulfilmentBefore.exchangeId).toBe(exchangeId);
    const childLines = await testPrisma.orderLine.count({ where: { fulfilmentId } });
    expect(childLines).toBe(0); // exclusivity: an exchange-anchored fulfilment has zero child OrderLines

    const shipRes = await shipManually(fulfilmentId, token);
    expect(shipRes.statusCode).toBe(200);

    const dispatchRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'EXCHANGE_DISPATCH', referenceType: 'EXCHANGE', referenceId: exchangeId } });
    expect(dispatchRows).toHaveLength(1);
    expect(dispatchRows[0]!.skuId).toBe(fixture.skuL.id);
    const saleRowsForExchange = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', skuId: fixture.skuL.id } });
    expect(saleRowsForExchange).toHaveLength(0); // never a second SALE for the replacement

    const midway = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    expect(midway.status).toBe('REPLACEMENT_ALLOCATED'); // shipped, not yet delivered - still not COMPLETED

    const deliverRes = await deliverManually(fulfilmentId, token);
    expect(deliverRes.statusCode).toBe(200);

    const completed = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.replacementFulfilledAt).toBeTruthy();
    expect(completed.replacementFulfilledByStaffId).toBeTruthy(); // staff-triggered manual /deliver route

    const autoAudit = await testPrisma.auditLog.findFirst({ where: { action: 'exchange.replacement_fulfilled.auto', entityId: exchangeId } });
    expect(autoAudit).toBeTruthy();
  });

  // --- 3. Replacement cannot ship before allocation ---

  it('rejects assigning a replacement to a fulfilment before its Exchange reaches REPLACEMENT_ALLOCATED (no PickTask exists yet)', async () => {
    const token = await warehouseToken();
    const fixture = await setupExchangeableStyle(1200);
    const { orderId } = await codOrder(fixture.skuM.id, `guest-tooearly-${counter}`, `idem-tooearly-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);
    const initRes = await initiateExchange(orderId, lineId, fixture.skuL.id, token, `exc-tooearly-${counter}`);
    const exchange = initRes.json();
    expect(exchange.status).toBe('REQUESTED');

    const noPickTask = await testPrisma.pickTask.findUnique({ where: { exchangeId: exchange.id } });
    expect(noPickTask).toBeNull();

    const assignRes = await assignReplacementToFulfilment(exchange.id, token);
    expect(assignRes.statusCode).toBe(400);
    expect(assignRes.json().error.message).toMatch(/no pick task yet/i);
  });

  // --- 4. No duplicate warehouse work ---

  it('assigning the same exchange to a fulfilment twice is idempotent - never creates two OrderFulfilment rows', async () => {
    const token = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(token, 'nodupe');
    const pickRes = await pickReplacement(exchangeId, token);
    expect(pickRes.statusCode).toBe(200);

    const first = await assignReplacementToFulfilment(exchangeId, token);
    const second = await assignReplacementToFulfilment(exchangeId, token);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).toBe(second.json().id);

    const fulfilments = await testPrisma.orderFulfilment.findMany({ where: { exchangeId } });
    expect(fulfilments).toHaveLength(1);
  });

  // --- 5. Concurrent pick ---

  it('two concurrent pick attempts on the same replacement PickTask - exactly one wins', async () => {
    const token = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(token, 'concpick');
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { exchangeId } });

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'concurrent-a', outcome: 'FULL', pickedQuantity: task.allocatedQuantity } }),
      app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'concurrent-b', outcome: 'FULL', pickedQuantity: task.allocatedQuantity } }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const finalTask = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(finalTask.status).toBe('PICKED');
  });

  // --- 6. Concurrent pack (assign-to-fulfilment) ---

  it('two concurrent assign-to-fulfilment requests for the same exchange converge to exactly one fulfilment', async () => {
    const token = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(token, 'concpack');
    await pickReplacement(exchangeId, token);

    const [a, b] = await Promise.all([assignReplacementToFulfilment(exchangeId, token), assignReplacementToFulfilment(exchangeId, token)]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().id).toBe(b.json().id);
    const fulfilments = await testPrisma.orderFulfilment.findMany({ where: { exchangeId } });
    expect(fulfilments).toHaveLength(1);
  });

  // --- 7. Concurrent shipment creation ---

  it('two concurrent create-shipment requests for the same exchange-anchored fulfilment converge to exactly one Shipment', async () => {
    const token = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(token, 'concship');
    const fulfilmentId = await readyToShipReplacement(exchangeId, token);

    const [a, b] = await Promise.all([createShipmentHttp(fulfilmentId, token, 'idem-race-a'), createShipmentHttp(fulfilmentId, token, 'idem-race-b')]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses[0]).toBeGreaterThanOrEqual(200);
    const shipments = await testPrisma.shipment.findMany({ where: { fulfilmentId } });
    expect(shipments).toHaveLength(1);
    expect(shipments[0]!.orderId).toBe((await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchangeId } })).orderId);
  });

  // --- 8 & 17 & 18. Duplicate delivery webhook, tracking visible to owning customer, COMPLETED only after DELIVERED ---

  it('delivers an exchange replacement via real carrier tracking, exposes tracking to the owning customer, is safe against a duplicate delivered webhook, and completes ONLY on delivery', async () => {
    const token = await warehouseToken();
    const guestId = `guest-track-${counter}`;
    const fixture = await setupExchangeableStyle(1400);
    const { orderId } = await codOrder(fixture.skuM.id, guestId, `idem-track-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);
    const initRes = await initiateExchange(orderId, lineId, fixture.skuL.id, token, `exc-track-${counter}`);
    const exchange = initRes.json();
    await receiveAndQcPass(exchange.id, token);

    const fulfilmentId = await readyToShipReplacement(exchange.id, token);
    const shipRes = await createShipmentHttp(fulfilmentId, token, `idem-track-ship-${counter}`);
    expect(shipRes.statusCode).toBe(201);
    const shipment = shipRes.json();

    // In transit - tracking visible to the owning guest, Exchange not yet COMPLETED.
    expect((await sendTracking(shipment.providerShipmentRef, 'in_transit', `evt-track-1-${counter}`)).statusCode).toBe(200);
    const midViewRes = await app.inject({ method: 'GET', url: `/api/v1/storefront/exchanges/${exchange.id}`, headers: { [GUEST_HEADER]: guestId } });
    expect(midViewRes.statusCode).toBe(200);
    const midView = midViewRes.json();
    expect(midView.status).toBe('REPLACEMENT_ALLOCATED');
    expect(midView.replacementFulfilment.fulfilment.shipment.status).toBe('IN_TRANSIT');
    expect(midView.replacementFulfilment.fulfilment.shipment.trackingRef).toBeTruthy();

    // A different guest cannot see this exchange's tracking - clean 404.
    const otherGuestRes = await app.inject({ method: 'GET', url: `/api/v1/storefront/exchanges/${exchange.id}`, headers: { [GUEST_HEADER]: `guest-not-owner-${counter}` } });
    expect(otherGuestRes.statusCode).toBe(404);

    expect((await sendTracking(shipment.providerShipmentRef, 'out_for_delivery', `evt-track-2-${counter}`)).statusCode).toBe(200);
    expect((await sendTracking(shipment.providerShipmentRef, 'delivered', `evt-track-3-${counter}`)).statusCode).toBe(200);

    const delivered = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(delivered.status).toBe('COMPLETED');
    expect(delivered.replacementFulfilledByStaffId).toBeNull(); // SYSTEM-attributed (carrier webhook), not a staff action

    // Duplicate delivered webhook - safe no-op, no double completion/dispatch.
    const dupRes = await sendTracking(shipment.providerShipmentRef, 'delivered', `evt-track-3-${counter}`);
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().duplicate).toBe(true);
    const stillCompleted = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(stillCompleted.status).toBe('COMPLETED');
    const dispatchRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'EXCHANGE_DISPATCH', referenceType: 'EXCHANGE', referenceId: exchange.id } });
    expect(dispatchRows).toHaveLength(1);
    const autoAudits = await testPrisma.auditLog.findMany({ where: { action: 'exchange.replacement_fulfilled.auto', entityId: exchange.id } });
    expect(autoAudits).toHaveLength(1);

    const finalView = await app.inject({ method: 'GET', url: `/api/v1/storefront/exchanges/${exchange.id}`, headers: { [GUEST_HEADER]: guestId } });
    expect(finalView.json().replacementFulfilment.fulfilment.shipment.status).toBe('DELIVERED');
  });

  // --- 9 & 10 & 11. Exactly-once dispatch, never a second SALE, normal SALE invariant unchanged ---

  it('posts EXCHANGE_DISPATCH exactly once and never touches the ORDER_LINE SALE invariant of the original (or any other) order', async () => {
    const token = await warehouseToken();
    const { exchangeId, orderId, fixture } = await toReplacementAllocated(token, 'invariant');
    const originalLine = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId } });
    const originalSaleBefore = await testPrisma.inventoryTransaction.count({ where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: originalLine.id } });
    expect(originalSaleBefore).toBe(1); // posted when the ORIGINAL line shipped, before the exchange even existed

    const fulfilmentId = await readyToShipReplacement(exchangeId, token);
    await shipManually(fulfilmentId, token);

    const dispatchRows = await testPrisma.inventoryTransaction.findMany({ where: { type: 'EXCHANGE_DISPATCH', referenceType: 'EXCHANGE', referenceId: exchangeId } });
    expect(dispatchRows).toHaveLength(1);
    // The original order's own SALE row is untouched - still exactly one, same row.
    const originalSaleAfter = await testPrisma.inventoryTransaction.findMany({ where: { type: 'SALE', referenceType: 'ORDER_LINE', referenceId: originalLine.id } });
    expect(originalSaleAfter).toHaveLength(1);
    // A second attempt to ship the same (already-SHIPPED) fulfilment is rejected, never posts a second dispatch.
    const reShipRes = await shipManually(fulfilmentId, token);
    expect(reShipRes.statusCode).toBe(400);
    const dispatchRowsAfter = await testPrisma.inventoryTransaction.findMany({ where: { type: 'EXCHANGE_DISPATCH', referenceType: 'EXCHANGE', referenceId: exchangeId } });
    expect(dispatchRowsAfter).toHaveLength(1);
    void fixture;
  });

  // --- 12. Replacement unavailable before fulfilment (pick shortfall/exception on an exchange PickTask) ---

  it('a pick exception on the replacement PickTask flips the Exchange to REPLACEMENT_UNAVAILABLE, never a silent order-level EXCEPTION', async () => {
    const token = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(token, 'pickfail');
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { exchangeId } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: 'exc-pick-exception', outcome: 'EXCEPTION', exceptionType: 'STOCK_NOT_FOUND', exceptionReason: 'Replacement unit missing from bin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('EXCEPTION');

    const exchange = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    expect(exchange.status).toBe('REPLACEMENT_UNAVAILABLE');
    const unavailableAudit = await testPrisma.auditLog.findFirst({ where: { action: 'exchange.replacement.unavailable', entityId: exchangeId } });
    expect(unavailableAudit).toBeTruthy();

    // Cannot then be assigned to a fulfilment - the pick task is terminal (EXCEPTION), not PICKED.
    const assignRes = await assignReplacementToFulfilment(exchangeId, token);
    expect(assignRes.statusCode).toBe(400);
  });

  // --- 13. Cancellation/terminal exchange cannot enter warehouse flow ---

  it('a QC_FAILED exchange never gets a PickTask and cannot enter the warehouse flow', async () => {
    const token = await warehouseToken();
    const fixture = await setupExchangeableStyle(1200);
    const { orderId } = await codOrder(fixture.skuM.id, `guest-qcfail-${counter}`, `idem-qcfail-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);
    const initRes = await initiateExchange(orderId, lineId, fixture.skuL.id, token, `exc-qcfail-${counter}`);
    const exchange = initRes.json();

    await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchange.id}/receive`, headers: { authorization: `Bearer ${token}` } });
    const qcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/exchanges/${exchange.id}/qc`,
      headers: { authorization: `Bearer ${token}` },
      payload: { qcResult: 'FAIL', disposition: 'WRITE_OFF' },
    });
    expect(qcRes.json().status).toBe('QC_FAILED');

    const pickTask = await testPrisma.pickTask.findUnique({ where: { exchangeId: exchange.id } });
    expect(pickTask).toBeNull();
    const assignRes = await assignReplacementToFulfilment(exchange.id, token);
    expect(assignRes.statusCode).toBe(400);
  });

  it('a CANCELLED exchange never gets a PickTask and cannot enter the warehouse flow', async () => {
    const token = await warehouseToken();
    const fixture = await setupExchangeableStyle(1200);
    const { orderId } = await codOrder(fixture.skuM.id, `guest-cancel-${counter}`, `idem-cancel-${counter}`);
    const { lineId } = await deliverOrderLine(orderId, token);
    const initRes = await initiateExchange(orderId, lineId, fixture.skuL.id, token, `exc-cancel-${counter}`);
    const exchange = initRes.json();

    const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchange.id}/cancel`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(cancelRes.json().status).toBe('CANCELLED');

    const pickTask = await testPrisma.pickTask.findUnique({ where: { exchangeId: exchange.id } });
    expect(pickTask).toBeNull();
    const assignRes = await assignReplacementToFulfilment(exchange.id, token);
    expect(assignRes.statusCode).toBe(400);
  });

  // --- 14 & 15. IDOR/BOLA and RBAC ---

  it('rejects assign-to-fulfilment from a staff member without exchange:fulfil (RBAC), and from an unauthenticated caller (401)', async () => {
    const managerToken = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(managerToken, 'rbac');
    await pickReplacement(exchangeId, managerToken);

    const opToken = await operatorToken(); // lacks exchange:fulfil (has exchange:read/receive only)
    const forbiddenRes = await assignReplacementToFulfilment(exchangeId, opToken);
    expect(forbiddenRes.statusCode).toBe(403);

    const unauthRes = await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchangeId}/fulfilment` });
    expect(unauthRes.statusCode).toBe(401);

    // The manager (who genuinely holds exchange:fulfil) can still complete it.
    const okRes = await assignReplacementToFulfilment(exchangeId, managerToken);
    expect(okRes.statusCode).toBe(201);
  });

  it('rejects picking/packing an exchange-anchored task from a staff member without the base warehouse:pick/order:fulfil permissions - not silently exempted by the generalization', async () => {
    const managerToken = await warehouseToken();
    const { exchangeId } = await toReplacementAllocated(managerToken, 'idor');
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { exchangeId } });

    // CATALOG's own seeded permissions (product:*, inventory:read) include
    // no warehouse:*/order:fulfil/exchange:* permission at all.
    const { token: noPermToken } = await createAuthenticatedStaff(app, ['CATALOG']);
    const pickRes = await app.inject({
      method: 'POST',
      url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
      headers: { authorization: `Bearer ${noPermToken}` },
      payload: { idempotencyKey: 'idor-pick', outcome: 'FULL', pickedQuantity: task.allocatedQuantity },
    });
    expect(pickRes.statusCode).toBe(403);
  });

  // --- 16. Retry / process restart (idempotency-key replay) ---

  it('a retried pick request (same idempotencyKey) against the replacement PickTask is a safe no-op, never a re-execution', async () => {
    const token = await warehouseToken();
    const { exchangeId, fixture } = await toReplacementAllocated(token, 'retry');
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { exchangeId } });

    const first = await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'retry-key-1', outcome: 'FULL', pickedQuantity: task.allocatedQuantity } });
    const second = await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'retry-key-1', outcome: 'FULL', pickedQuantity: task.allocatedQuantity } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual(second.json());

    const balance = await testPrisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: fixture.skuL.id, locationId: fixture.locationId } } });
    expect(balance.reserved).toBe(1); // still just the one converted allocation - a retried pick never double-adjusts inventory
  });

  // --- 19. Unrelated Order/Exchange concurrency ---

  it('two unrelated exchanges on two different orders progress independently under concurrency - no cross-exchange lock contention', async () => {
    const token = await warehouseToken();
    const ctx = await seedContext();
    const first = await toReplacementAllocated(token, 'unrelated-a', ctx);
    const second = await toReplacementAllocated(token, 'unrelated-b', ctx);

    const [pickA, pickB] = await Promise.all([pickReplacement(first.exchangeId, token), pickReplacement(second.exchangeId, token)]);
    expect(pickA.statusCode).toBe(200);
    expect(pickB.statusCode).toBe(200);

    const [assignA, assignB] = await Promise.all([assignReplacementToFulfilment(first.exchangeId, token), assignReplacementToFulfilment(second.exchangeId, token)]);
    expect(assignA.statusCode).toBe(201);
    expect(assignB.statusCode).toBe(201);
    expect(assignA.json().id).not.toBe(assignB.json().id);

    const exchangeA = await testPrisma.exchange.findUniqueOrThrow({ where: { id: first.exchangeId } });
    const exchangeB = await testPrisma.exchange.findUniqueOrThrow({ where: { id: second.exchangeId } });
    expect(exchangeA.orderId).not.toBe(exchangeB.orderId);
  });
});
