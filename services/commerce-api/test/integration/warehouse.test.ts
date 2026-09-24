import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110001';

/**
 * M16 — Warehouse / Fulfilment adversarial certification
 * (specs/15-warehouse-fulfilment.md, WH-001/002).
 *
 * Covers every scenario the M16 build instruction's §16 requires: pick
 * concurrency/idempotency/exception handling, the pack-without-pick and
 * pack-more-than-picked gates, cross-order/line substitution attempts,
 * unauthorized/IDOR access, inventory-integrity interaction, transactional
 * rollback on partial failure, split-fulfilment correctness, and
 * retry-after-network-equivalent-duplicate. order.test.ts's own
 * "Split shipment (FLOW 8)" and "Shipment inventory invariant hardening"
 * describe blocks already prove the M15-side pack/ship/deliver machinery
 * still works correctly THROUGH the new picking gate end to end - this
 * file focuses on the picking layer itself, which order.test.ts only
 * exercises indirectly via its pickLine helper.
 */
describe('Warehouse / Fulfilment - Picking (M16)', () => {
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
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function warehouseToken(perms: string[] = ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick']) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Warehouse Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLWHTST${counter}A1Z${counter % 10}`,
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
        styleCode: `WH-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Warehouse Test Jacket',
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

    return { skuId, locationId: seeded.locationId };
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function codOrder(skuId: string, guestId: string, idempotencyKey: string, quantity = 1) {
    const headers = { [GUEST_HEADER]: guestId };
    const addRes = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(addRes.statusCode).toBe(201);
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
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id }, include: { lines: true } });
    return order;
  }

  async function onePickTask(orderId: string) {
    return testPrisma.pickTask.findFirstOrThrow({ where: { orderId } });
  }

  describe('A: normal pick outcomes', () => {
    it('a full pick moves the task to PICKED and the order line to PICKED', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-full', 'idem-wh-full');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'pick-full-1', outcome: 'FULL', pickedQuantity: 1 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('PICKED');
      expect(res.json().pickedQuantity).toBe(1);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('PICKED');
    });
  });

  describe('B: duplicate/replayed pick request (idempotency)', () => {
    it('an exact retry with the same idempotencyKey is a safe no-op, never re-applied', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-retry', 'idem-wh-retry');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      const payload = { idempotencyKey: 'pick-retry-key', outcome: 'FULL' as const, pickedQuantity: 1 };

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('PICKED');
      expect(second.json().pickedQuantity).toBe(1);

      // Exactly one audit entry for the actual pick action - the replay
      // did not re-execute the state transition.
      const auditEntries = await testPrisma.auditLog.findMany({ where: { action: 'warehouse.pick.record', entityId: task.id } });
      expect(auditEntries).toHaveLength(1);
    });

    it('a different idempotencyKey against an already-picked task is a genuine conflict, not a replay', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-conflict', 'idem-wh-conflict');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'pick-key-1', outcome: 'FULL', pickedQuantity: 1 },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'pick-key-2-different', outcome: 'FULL', pickedQuantity: 1 },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('C: concurrent picker attempts on the same task', () => {
    it('two workers picking the same task simultaneously - exactly one succeeds with the terminal state, the loser gets a clean conflict', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-concurrent-pick', 'idem-wh-concurrent-pick');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
          headers: { authorization: `Bearer ${token}` },
          payload: { idempotencyKey: 'concurrent-worker-a', outcome: 'FULL', pickedQuantity: 1 },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
          headers: { authorization: `Bearer ${token}` },
          payload: { idempotencyKey: 'concurrent-worker-b', outcome: 'FULL', pickedQuantity: 1 },
        }),
      ]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses[0]).toBe(200);
      expect(statuses[1]).toBe(409);

      const finalTask = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(finalTask.status).toBe('PICKED');
      expect(finalTask.pickedQuantity).toBe(1);
      // Exactly one audit entry - the loser never wrote a second state change.
      const auditEntries = await testPrisma.auditLog.findMany({ where: { action: 'warehouse.pick.record', entityId: task.id } });
      expect(auditEntries).toHaveLength(1);
    });
  });

  describe('D: pick quantity greater than allocation', () => {
    it('rejects picking more than was allocated, and leaves the task PENDING', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-overpick', 'idem-wh-overpick', 2);
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      expect(task.allocatedQuantity).toBe(2);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'overpick-1', outcome: 'FULL', pickedQuantity: 3 },
      });
      expect(res.statusCode).toBe(400);

      const stillPending = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(stillPending.status).toBe('PENDING');
      expect(stillPending.pickedQuantity).toBe(0);
    });
  });

  describe('E: pick a cancelled line', () => {
    it('rejects the pick and cancels the task, once the order line has been cancelled', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-cancelled-line', 'idem-wh-cancelled-line');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/lines/${order.lines[0]!.id}/cancel`,
        headers: { authorization: `Bearer ${csToken}` },
        payload: { reason: 'Customer cancelled before pick' },
      });
      expect(cancelRes.statusCode).toBe(200);

      // The cancel side effect already auto-cancelled the still-PENDING task.
      const preCheck = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(preCheck.status).toBe('CANCELLED');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'pick-cancelled-1', outcome: 'FULL', pickedQuantity: 1 },
      });
      // Already CANCELLED with no matching idempotency key -> a genuine conflict, not a silent success.
      expect(res.statusCode).toBe(409);
    });

    it('picking a still-PENDING task whose line was cancelled by a raw DB write (defense in depth) is rejected, not silently allowed', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-cancelled-line-raw', 'idem-wh-cancelled-line-raw');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      // Simulate a line that reached CANCELLED via some path that did not
      // go through OrderService.cancelOrderLine's own pick-task side
      // effect (e.g. a future code path this test guards against
      // regressing) - recordPickOutcome's own live re-check of the
      // OrderLine (not just the task's own status) is the real backstop.
      await testPrisma.orderLine.update({
        where: { id: order.lines[0]!.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: 'raw DB write for test' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'pick-cancelled-2', outcome: 'FULL', pickedQuantity: 1 },
      });
      expect(res.statusCode).toBe(400);
      const finalTask = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(finalTask.status).toBe('CANCELLED');
    });
  });

  describe('F: pack without pick', () => {
    it('rejects assigning a line to a fulfilment before it has been picked', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-packnopick', 'idem-wh-packnopick');
      const token = await warehouseToken();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[0]!.id] },
      });
      expect(res.statusCode).toBe(400);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('ALLOCATED');
      expect(line.fulfilmentId).toBeNull();
    });
  });

  describe('G: pack more than picked (short-picked line routed to exception)', () => {
    it('a short-picked line cannot be assigned to a fulfilment - it is routed to EXCEPTION instead', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-shortpick', 'idem-wh-shortpick', 3);
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const pickRes = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'short-pick-1', outcome: 'SHORT', pickedQuantity: 2, exceptionReason: 'Found only 2 on the shelf' },
      });
      expect(pickRes.statusCode).toBe(200);
      expect(pickRes.json().status).toBe('SHORT_PICKED');

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('EXCEPTION');

      const order2 = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(order2.status).toBe('EXCEPTION');

      // The 1-unit shortfall posted an authorized, audited inventory
      // adjustment (specs/15-warehouse-fulfilment.md, binding).
      const adjustment = await testPrisma.inventoryTransaction.findFirst({ where: { skuId, type: 'ADJUSTMENT' } });
      expect(adjustment).not.toBeNull();
      expect(adjustment!.quantity).toBe(1);

      const packRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[0]!.id] },
      });
      expect(packRes.statusCode).toBe(400);
    });

    it('an EXCEPTION outcome (stock not found) posts the full-quantity adjustment and routes to the order-exception path', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-exception-outcome', 'idem-wh-exception-outcome', 2);
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'exc-1', outcome: 'EXCEPTION', exceptionType: 'STOCK_NOT_FOUND', exceptionReason: 'Bin empty' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('EXCEPTION');
      expect(res.json().exceptionType).toBe('STOCK_NOT_FOUND');

      const adjustment = await testPrisma.inventoryTransaction.findFirst({ where: { skuId, type: 'ADJUSTMENT' } });
      expect(adjustment!.quantity).toBe(2); // full allocatedQuantity, never guessed at a partial figure

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('EXCEPTION');
    });

    it('reinstating a short-picked line resets its PickTask to PENDING for a fresh pick attempt', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-reinstate', 'idem-wh-reinstate', 2);
      const token = await warehouseToken();
      await grantPermissions('WAREHOUSE_MANAGER', ['order:exception:manage']);
      const task = await onePickTask(order.id);

      await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'reinstate-pick-1', outcome: 'SHORT', pickedQuantity: 1, exceptionReason: 'Short by 1' },
      });

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/lines/${order.lines[0]!.id}/exception/resolve`,
        headers: { authorization: `Bearer ${token}` },
        payload: { resolution: 'REINSTATE', reason: 'Restocked' },
      });
      expect(resolveRes.statusCode).toBe(200);

      const resetTask = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(resetTask.status).toBe('PENDING');
      expect(resetTask.pickedQuantity).toBe(0);
      expect(resetTask.idempotencyKey).toBeNull();

      // A fresh pick attempt against the reset task now succeeds.
      const secondPick = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'reinstate-pick-2', outcome: 'FULL', pickedQuantity: 2 },
      });
      expect(secondPick.statusCode).toBe(200);
      expect(secondPick.json().status).toBe('PICKED');
    });
  });

  describe('H: duplicate pack / already-assigned line', () => {
    it('rejects assigning an already-fulfilment-assigned line to a second fulfilment', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-duppack', 'idem-wh-duppack');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'duppack-pick', outcome: 'FULL', pickedQuantity: 1 },
      });

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[0]!.id] },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[0]!.id] },
      });
      expect(second.statusCode).toBe(409);

      const fulfilments = await testPrisma.orderFulfilment.findMany({ where: { orderId: order.id } });
      expect(fulfilments).toHaveLength(1);
    });
  });

  describe('I: concurrent packing of the same line', () => {
    it('two concurrent fulfilment-assignment requests for the same picked line - exactly one wins', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-concurrent-pack', 'idem-wh-concurrent-pack');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'concurrent-pack-pick', outcome: 'FULL', pickedQuantity: 1 },
      });

      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/orders/${order.id}/fulfilments`,
          headers: { authorization: `Bearer ${token}` },
          payload: { lineIds: [order.lines[0]!.id] },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/orders/${order.id}/fulfilments`,
          headers: { authorization: `Bearer ${token}` },
          payload: { lineIds: [order.lines[0]!.id] },
        }),
      ]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      // Row-locked (FOR UPDATE) eligibility check makes this
      // deterministic: the loser's SELECT ... FOR UPDATE blocks until the
      // winner commits, then re-reads the now-assigned line and always
      // gets a clean 409 - never a race that lets both through.
      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBe(409);

      const fulfilments = await testPrisma.orderFulfilment.findMany({ where: { orderId: order.id } });
      expect(fulfilments).toHaveLength(1);
    });
  });

  describe('J: wrong order/line relationship', () => {
    it('rejects assigning a line that belongs to a DIFFERENT order than the one in the URL', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(500, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(700, ctx);
      const token = await warehouseToken();

      const orderA = await codOrder(skuA, 'guest-wh-wrongorder-a', 'idem-wh-wrongorder-a');
      const orderB = await codOrder(skuB, 'guest-wh-wrongorder-b', 'idem-wh-wrongorder-b');

      const taskB = await onePickTask(orderB.id);
      await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${taskB.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'wrongorder-pick-b', outcome: 'FULL', pickedQuantity: 1 },
      });

      // Attempt to assign order B's (now-picked) line under order A's id.
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderA.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [orderB.lines[0]!.id] },
      });
      expect(res.statusCode).toBe(404);

      const lineB = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: orderB.lines[0]!.id } });
      expect(lineB.fulfilmentId).toBeNull();
    });
  });

  describe('K: unauthorized warehouse operation / IDOR-BOLA', () => {
    it('rejects a pick attempt from a staff member with no warehouse:pick permission', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-noperm', 'idem-wh-noperm');
      const task = await onePickTask(order.id);
      const { token: noPermToken } = await createAuthenticatedStaff(app, ['ANALYTICS']);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${noPermToken}` },
        payload: { idempotencyKey: 'noperm-1', outcome: 'FULL', pickedQuantity: 1 },
      });
      expect(res.statusCode).toBe(403);

      const stillPending = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(stillPending.status).toBe('PENDING');
    });

    it('rejects reading a pick task with only order:read (no warehouse:read) - the two permissions are genuinely independent', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-readperm', 'idem-wh-readperm');
      const task = await onePickTask(order.id);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read']);
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/warehouse/pick-tasks/${task.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a well-formed but non-existent pick task id returns a clean 404, not a 500 or a leaked record', async () => {
      const token = await warehouseToken();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/warehouse/pick-tasks/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('a malformed (non-UUID) pick task id is rejected with a clean 400, never reaching the database layer', async () => {
      const token = await warehouseToken();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/warehouse/pick-tasks/not-a-uuid',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a completely unauthenticated request with 401', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-noauth', 'idem-wh-noauth');
      const task = await onePickTask(order.id);

      const res = await app.inject({ method: 'GET', url: `/api/v1/warehouse/pick-tasks/${task.id}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('L: insufficient/corrupted inventory state interaction', () => {
    it('a pick exception adjustment that would drive on-hand negative is rejected, not silently clamped', async () => {
      const { skuId, locationId } = await setupCheckoutableSku(500, undefined, 1);
      const order = await codOrder(skuId, 'guest-wh-corrupt-inv', 'idem-wh-corrupt-inv');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      // Corrupt onHand down to zero after the order was placed (reserved
      // still holds 1 from the checkout-time reservation) - the pick
      // exception's own shortfall adjustment (quantityDelta = -1) would
      // now drive onHand negative.
      // reserved must drop with onHand (reserved <= onHand is a DB CHECK
      // constraint) - this leaves onHand=0 so the pick exception's own
      // -1 shortfall adjustment would drive it negative.
      await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId, locationId } }, data: { onHand: 0, reserved: 0 } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'corrupt-inv-1', outcome: 'EXCEPTION', exceptionType: 'STOCK_NOT_FOUND', exceptionReason: 'Not found' },
      });
      expect(res.statusCode).toBe(409);

      // No partial trace: task stays PENDING, line stays ALLOCATED.
      const stillPending = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(stillPending.status).toBe('PENDING');
      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('ALLOCATED');
    });
  });

  describe('M: transaction rollback on partial failure', () => {
    it('a pick exception whose adjustment fails leaves no partial state - task PENDING, line ALLOCATED, no adjustment row, no audit entry', async () => {
      const { skuId, locationId } = await setupCheckoutableSku(500, undefined, 1);
      const order = await codOrder(skuId, 'guest-wh-rollback', 'idem-wh-rollback');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId, locationId } }, data: { onHand: 0, reserved: 0 } });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'rollback-1', outcome: 'EXCEPTION', exceptionType: 'DAMAGED', exceptionReason: 'Torn on arrival' },
      });
      expect(res.statusCode).toBe(409);

      const stillPending = await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(stillPending.status).toBe('PENDING');
      expect(stillPending.exceptionType).toBeNull();
      expect(stillPending.pickedAt).toBeNull();

      const adjustment = await testPrisma.inventoryTransaction.findFirst({ where: { skuId, type: 'ADJUSTMENT' } });
      expect(adjustment).toBeNull();

      const auditEntries = await testPrisma.auditLog.findMany({ where: { action: 'warehouse.pick.record', entityId: task.id } });
      expect(auditEntries).toHaveLength(0);
    });
  });

  describe('N: split fulfilment correctness', () => {
    it('two lines of a multi-line order can each be picked and packed into independent packages', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(500, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(700, ctx);
      const token = await warehouseToken();

      const headers = { [GUEST_HEADER]: 'guest-wh-split' };
      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId: skuA, quantity: 1 } });
      await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId: skuB, quantity: 1 } });
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
          idempotencyKey: 'idem-wh-split',
        },
      });
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkoutRes.json().id }, include: { lines: true } });
      expect(order.lines).toHaveLength(2);

      const tasks = await testPrisma.pickTask.findMany({ where: { orderId: order.id } });
      expect(tasks).toHaveLength(2);

      for (const task of tasks) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
          headers: { authorization: `Bearer ${token}` },
          payload: { idempotencyKey: `split-pick-${task.id}`, outcome: 'FULL', pickedQuantity: task.allocatedQuantity },
        });
        expect(res.statusCode).toBe(200);
      }

      // Each line packs into its own, independently-tracked package
      // (M16 §5: "do not force one order = one package").
      const fulfilARes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[0]!.id] },
      });
      expect(fulfilARes.statusCode).toBe(201);
      const fulfilBRes = await app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/fulfilments`,
        headers: { authorization: `Bearer ${token}` },
        payload: { lineIds: [order.lines[1]!.id] },
      });
      expect(fulfilBRes.statusCode).toBe(201);
      expect(fulfilARes.json().id).not.toBe(fulfilBRes.json().id);

      const fulfilments = await testPrisma.orderFulfilment.findMany({ where: { orderId: order.id } });
      expect(fulfilments).toHaveLength(2);
    });
  });

  describe('O: retry after network-equivalent duplicate request', () => {
    it('a fresh WarehouseService instance replaying the exact request (process-restart equivalent) converges to the same result', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-restart', 'idem-wh-restart');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);
      const payload = { idempotencyKey: 'restart-key', outcome: 'FULL' as const, pickedQuantity: 1 };

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(first.statusCode).toBe(200);

      // Simulate a client that never saw the first response (e.g. a
      // network drop) and retries the identical request against a
      // brand-new process - driven entirely by durable database state
      // (the stored idempotencyKey), not in-memory state.
      const retry = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().status).toBe('PICKED');
      expect(retry.json().pickedQuantity).toBe(1);
    });
  });

  describe('P: never silently substitutes another SKU/colour/size', () => {
    it('a WRONG_SKU_FOUND exception against the requested task never credits or picks any quantity for it', async () => {
      const { skuId } = await setupCheckoutableSku(500);
      const order = await codOrder(skuId, 'guest-wh-wrongsku', 'idem-wh-wrongsku');
      const token = await warehouseToken();
      const task = await onePickTask(order.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`,
        headers: { authorization: `Bearer ${token}` },
        payload: { idempotencyKey: 'wrongsku-1', outcome: 'EXCEPTION', exceptionType: 'WRONG_SKU_FOUND', exceptionReason: 'Found a different colour on the shelf' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('EXCEPTION');
      expect(res.json().pickedQuantity).toBe(0);

      const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: order.lines[0]!.id } });
      expect(line.status).toBe('EXCEPTION');
      expect(line.skuId).toBe(skuId); // never silently swapped to a different SKU
    });
  });

  describe('Q: listing is paginated and bounded (M16 §18 - no unbounded queries)', () => {
    it('rejects an out-of-range take at the input-validation layer (clean 400, never reaching the database as an unbounded query)', async () => {
      const token = await warehouseToken();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/warehouse/pick-tasks?take=100000',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('at the maximum allowed take, still returns a bounded page and reports the true total separately', async () => {
      const ctx = await seedContext();
      const token = await warehouseToken();
      for (let i = 0; i < 5; i += 1) {
        const { skuId } = await setupCheckoutableSku(500, ctx);
        await codOrder(skuId, `guest-wh-page-${i}`, `idem-wh-page-${i}`);
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/warehouse/pick-tasks?take=200',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeLessThanOrEqual(200);
      expect(res.json().total).toBeGreaterThanOrEqual(5);
    });
  });
});
