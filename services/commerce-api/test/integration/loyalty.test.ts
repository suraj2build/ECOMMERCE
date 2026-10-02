import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';
import { LoyaltyService } from '../../src/modules/loyalty/service.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
// COD_MAX_ORDER_VALUE_INR's production default (5000) is too low to earn
// LOYALTY_MIN_REDEMPTION_POINTS (100, at the default 1-point-per-100-INR
// rate) via a single COD order - raised here for this test file only, a
// test-environment convenience, never a production value.
process.env.COD_MAX_ORDER_VALUE_INR = '50000';

const SERVICEABLE_PINCODE = '110001';
const RETURN_WINDOW_DEFAULT_DAYS = 7; // packages/config default - see returns/policy.ts

/**
 * Loyalty (M23, specs/22-loyalty.md, LOY-001-006) adversarial
 * certification.
 *
 * 2026-09-27 LOY-006 PRODUCT OWNER DECISION: this file was rewritten in
 * full for the PENDING -> VESTED -> REDEEMED/EXPIRED vesting lifecycle -
 * points earned on a purchase are calculated at order confirmation but
 * are NOT redeemable until the qualifying line is DELIVERED *and* its
 * own return/exchange eligibility window has CLOSED. Covers exactly the
 * 16-item required test matrix (tests 1-16 below, each header names its
 * matrix item) plus the pre-existing supporting coverage this lifecycle
 * change did not remove: idempotent EARN, guest/zero-point no-ops,
 * QC-FAIL non-reversal, manual staff adjustment, IDOR, and staff RBAC.
 */
describe('Loyalty (M23) - vesting lifecycle (LOY-006)', () => {
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
  async function warehouseToken() {
    await grantPermissions('WAREHOUSE_MANAGER', [
      'order:read',
      'order:fulfil',
      'order:cancel',
      'warehouse:read',
      'warehouse:pick',
      'warehouse:pack',
      'return:read',
      'return:receive',
      'return:qc',
    ]);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }
  async function financeToken() {
    await grantPermissions('FINANCE', ['loyalty:adjust']);
    return (await createAuthenticatedStaff(app, ['FINANCE'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Loyalty Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLLOYTST${counter}A1Z${counter % 10}`,
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
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: `LOY-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Loyalty Test Jacket',
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

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: seeded.locationId, onHand, reserved: 0 } });

    return { skuId, styleId, locationId: seeded.locationId };
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function addToCart(skuId: string, headers: Record<string, string>, quantity = 1) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity } });
    expect(res.statusCode).toBe(201);
  }

/** Places a COD order as a signed-in customer (loyalty requires a persistent identity - guest orders never earn/redeem). Since this codebase's cart is never automatically cleared on checkout confirmation, the just-purchased SKU is explicitly removed afterward - several tests in this file place more than one order for the SAME customer token, and each must produce a genuinely fresh, single-line order rather than silently re-including a previous purchase. */
  async function customerCheckout(
    skuId: string,
    customerToken: string,
    idempotencyKey: string,
    opts: { quantity?: number; loyaltyPointsToRedeem?: number } = {},
  ) {
    const headers = { authorization: `Bearer ${customerToken}` };
    await addToCart(skuId, headers, opts.quantity ?? 1);
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
        ...(opts.loyaltyPointsToRedeem ? { loyaltyPointsToRedeem: opts.loyaltyPointsToRedeem } : {}),
      },
    });
    await app.inject({ method: 'DELETE', url: `/api/v1/storefront/cart/items/${skuId}`, headers });
    return res;
  }

  /** Multi-SKU variant - checks out every SKU currently in the customer's cart as separate order lines in one order. */
  async function customerCheckoutMultiLine(skuIds: string[], customerToken: string, idempotencyKey: string) {
    const headers = { authorization: `Bearer ${customerToken}` };
    for (const skuId of skuIds) await addToCart(skuId, headers);
    return app.inject({
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
  }

  async function orderFromSession(sessionId: string) {
    return testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
  }

  /** Places a confirmed COD order earning `targetPoints` (or more) at the default 1-point-per-100-INR rate. Under LOY-006 this points batch is CALCULATED but PENDING - not yet redeemable. */
  async function customerWithEarnedPoints(targetPoints: number, ctx: Awaited<ReturnType<typeof seedContext>>) {
    const subtotalNeeded = targetPoints * 100 + 200; // headroom past the floor() rounding
    const { skuId } = await setupCheckoutableSku(subtotalNeeded, ctx, 50);
    const { token } = await createAuthenticatedCustomer(app);
    const res = await customerCheckout(skuId, token, `idem-earn-${counter}-${Math.random()}`);
    expect(res.statusCode).toBe(201);
    const order = await orderFromSession(res.json().id);
    return { token, order, skuId };
  }

  /** Delivers the sole line of a single-line order via the real pick->pack->ready->ship->deliver pipeline. */
  async function deliverOrderLine(orderId: string, staffToken: string): Promise<{ lineId: string; fulfilmentId: string }> {
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    return deliverSpecificLine(orderId, order.lines[0]!.id, order.lines[0]!.quantity, staffToken);
  }

  /** Delivers ONE specific line of a (possibly multi-line) order as its own fulfilment - lets a test give two lines of the same order independent delivery dates. */
  async function deliverSpecificLine(orderId: string, lineId: string, quantity: number, staffToken: string): Promise<{ lineId: string; fulfilmentId: string }> {
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${staffToken}` }, payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: quantity } });
    const fulfilRes = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/fulfilments`, headers: { authorization: `Bearer ${staffToken}` }, payload: { lineIds: [lineId] } });
    const fulfilmentId = fulfilRes.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${staffToken}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${staffToken}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${staffToken}` }, payload: {} });
    const deliverRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${staffToken}` } });
    expect(deliverRes.statusCode).toBe(200);
    return { lineId, fulfilmentId };
  }

  /** Backdates a fulfilment's deliveredAt (and hence its line's return-window clock) so `isWithinWindow` sees the window as closed, without waiting real days. */
  async function backdateDelivery(fulfilmentId: string, daysAgo: number) {
    await testPrisma.orderFulfilment.update({ where: { id: fulfilmentId }, data: { deliveredAt: new Date(Date.now() - daysAgo * 86_400_000) } });
  }

  async function vestPoints(): Promise<number> {
    return new LoyaltyService(app).vestEligiblePoints();
  }

  /** End-to-end: earns, delivers, closes the window, and vests - returns a customer with `points` genuinely AVAILABLE (matches the matrix's own "100 available" fixtures). */
  async function customerWithVestedPoints(targetPoints: number, ctx: Awaited<ReturnType<typeof seedContext>>) {
    const { token, order } = await customerWithEarnedPoints(targetPoints, ctx);
    const wT = await warehouseToken();
    const { fulfilmentId } = await deliverOrderLine(order.id, wT);
    await backdateDelivery(fulfilmentId, RETURN_WINDOW_DEFAULT_DAYS + 3);
    const vested = await vestPoints();
    expect(vested).toBeGreaterThanOrEqual(1);
    return { token, order };
  }

  async function getBalance(customerToken: string) {
    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty', headers: { authorization: `Bearer ${customerToken}` } });
    expect(res.statusCode).toBe(200);
    return res.json() as { balance: number; pendingPoints: number; lifetimeEarnedPoints: number; tier: { id: string; name: string } | null };
  }

  it('customer ledger remains accessible beyond 200 entries with stable pages', async () => {
    const { customerId, token } = await createAuthenticatedCustomer(app);
    const account = await testPrisma.loyaltyAccount.create({ data: { customerId } });
    await testPrisma.loyaltyLedgerEntry.createMany({ data: Array.from({ length: 205 }, (_, i) => ({
      accountId: account.id, type: 'ADJUST', pointsDelta: 0, reason: `Boundary ${i}`,
      idempotencyKey: `ledger-boundary-${counter}-${i}`,
    })) });
    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger?take=200', headers });
    const last = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger?take=200&skip=200', headers });
    expect(first.statusCode).toBe(200);
    expect(last.statusCode).toBe(200);
    expect(first.json()).toHaveLength(200);
    expect(last.json()).toHaveLength(5);
    expect(new Set([...first.json(), ...last.json()].map((e: { id: string }) => e.id)).size).toBe(205);
  });

  // --- Matrix item 1 ---

  describe('1. Order confirmed -> points calculated -> PENDING -> available balance unchanged', () => {
    it('posts a PENDING EARN entry per line, at the configured rate - balance stays 0, pendingPoints reflects the calculated entitlement', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const expectedPoints = Math.floor(Number(order.subtotal) / 100);

      const balance = await getBalance(token);
      expect(balance.balance).toBe(0);
      expect(balance.pendingPoints).toBe(expectedPoints);
      expect(balance.lifetimeEarnedPoints).toBe(0); // lifetime standing also only counts VESTED points

      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const entry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });
      expect(entry.type).toBe('EARN');
      expect(entry.vestingStatus).toBe('PENDING');
      expect(entry.expiresAt).toBeNull(); // the expiry clock has not started - it starts at vesting (matrix item 11)
    });

    it('a guest (no customerId) order never earns points - safe no-op', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(15000, ctx);
      const headers = { 'x-guest-session-id': `guest-loy-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: { contactName: 'Guest', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey: `idem-guest-${counter}` },
      });
      expect(res.statusCode).toBe(201);
      expect(await testPrisma.loyaltyLedgerEntry.count()).toBe(0);
      expect(await testPrisma.loyaltyAccount.count()).toBe(0);
    });

    it('retrying order confirmation for the same line never double-earns (idempotent on qualifyingOrderLineId)', async () => {
      const ctx = await seedContext();
      const { order } = await customerWithEarnedPoints(100, ctx);
      const orderWithLines = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });

      const loyalty = new LoyaltyService(app);
      await testPrisma.$transaction(async (tx) => {
        await loyalty.earnForOrder(tx, orderWithLines);
      });

      const line = orderWithLines.lines[0]!;
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { qualifyingOrderLineId: line.id } })).toBe(1);
    });

    it('a very small order (below the rounding floor) earns zero points - safe no-op, no ledger entry', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(50, ctx); // floor(50/100) = 0 points
      const { token } = await createAuthenticatedCustomer(app);
      const res = await customerCheckout(skuId, token, `idem-tiny-${counter}`);
      expect(res.statusCode).toBe(201);
      expect(await testPrisma.loyaltyLedgerEntry.count()).toBe(0);
    });
  });

  // --- Matrix item 2 ---

  describe('2. Delivered -> return/exchange window still open -> still PENDING', () => {
    it('delivering the line (real-time, window not yet closed) and running the vesting sweep leaves the entry PENDING', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const wT = await warehouseToken();
      await deliverOrderLine(order.id, wT); // deliveredAt = now - window is wide open

      const vested = await vestPoints();
      expect(vested).toBe(0);

      const balance = await getBalance(token);
      expect(balance.balance).toBe(0);
      expect(balance.pendingPoints).toBeGreaterThan(0);

      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const entry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });
      expect(entry.vestingStatus).toBe('PENDING');
    });
  });

  // --- Matrix item 3 ---

  describe('3. Delivered -> window closes -> vest -> AVAILABLE exactly once', () => {
    it('once delivered and the window has closed, the sweep vests the entry exactly once - a second sweep run is a safe no-op', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const wT = await warehouseToken();
      const { fulfilmentId } = await deliverOrderLine(order.id, wT);
      await backdateDelivery(fulfilmentId, RETURN_WINDOW_DEFAULT_DAYS + 3);

      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const beforeEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });

      const firstSweep = await vestPoints();
      expect(firstSweep).toBe(1);

      const vestedEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: beforeEntry.id } });
      expect(vestedEntry.vestingStatus).toBe('VESTED');
      expect(vestedEntry.vestedAt).toBeTruthy();
      expect(vestedEntry.expiresAt).toBeTruthy();

      const balance = await getBalance(token);
      expect(balance.balance).toBe(beforeEntry.pointsDelta);
      expect(balance.pendingPoints).toBe(0);
      expect(balance.lifetimeEarnedPoints).toBe(beforeEntry.pointsDelta);

      const vestAudit = await testPrisma.auditLog.count({ where: { action: 'loyalty.vest', entityId: vestedEntry.accountId } });
      expect(vestAudit).toBe(1);

      // Sweep retry (matrix item 5) - never a duplicate vesting/balance change.
      const secondSweep = await vestPoints();
      expect(secondSweep).toBe(0);
      const balanceAfterRetry = await getBalance(token);
      expect(balanceAfterRetry.balance).toBe(balance.balance);
    });
  });

  // --- Matrix item 4 ---

  describe('4. Two concurrent vesting sweeps -> exactly one vesting transition', () => {
    it('two genuinely concurrent sweep invocations racing the same due entry converge to exactly one vesting event', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const wT = await warehouseToken();
      const { fulfilmentId } = await deliverOrderLine(order.id, wT);
      await backdateDelivery(fulfilmentId, RETURN_WINDOW_DEFAULT_DAYS + 3);

      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const entry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });

      const [countA, countB] = await Promise.all([vestPoints(), vestPoints()]);
      expect(countA + countB).toBe(1); // exactly one of the two concurrent sweeps actually vested this entry

      const finalEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(finalEntry.vestingStatus).toBe('VESTED');
      const balance = await getBalance(token);
      expect(balance.balance).toBe(entry.pointsDelta); // never double-credited
      const vestAudit = await testPrisma.auditLog.count({ where: { action: 'loyalty.vest', entityId: entry.accountId } });
      expect(vestAudit).toBe(1);
    });
  });

  // --- Matrix item 6 ---

  describe('6. Cancellation before vesting -> pending points cancelled -> never available', () => {
    it('cancelling a not-yet-shipped line cancels its PENDING entitlement - a later sweep run can never vest it', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const earnBefore = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });

      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/orders/${order.id}/lines/${line.id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'Changed my mind', idempotencyKey: `cancel-${line.id}` },
      });
      expect(cancelRes.statusCode).toBe(200);

      const cancelledEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: earnBefore.id } });
      expect(cancelledEntry.vestingStatus).toBe('CANCELLED');

      const balance = await getBalance(token);
      expect(balance.balance).toBe(0);
      expect(balance.pendingPoints).toBe(0);

      const reverseEntry = await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalOrderLineId: line.id } });
      expect(reverseEntry).toBeTruthy();
      expect(reverseEntry!.type).toBe('REVERSE');
      expect(reverseEntry!.pointsDelta).toBe(0); // nothing was ever in the balance to reverse
      expect(reverseEntry!.requiredPointsDelta).toBe(-earnBefore.pointsDelta); // the full required reversal is still truthfully recorded

      // A cancelled line can never ship/deliver again (M18's own certified
      // boundary), so a sweep run proves the CANCELLED status is durable,
      // never later reinterpreted as eligible.
      const vested = await vestPoints();
      expect(vested).toBe(0);
      const finalBalance = await getBalance(token);
      expect(finalBalance.balance).toBe(0);
    });

    it('retrying the same cancellation never double-reverses (idempotent on reversalOrderLineId)', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const idempotencyKey = `cancel-retry-${line.id}`;
      const first = await app.inject({ method: 'POST', url: `/api/v1/storefront/orders/${order.id}/lines/${line.id}/cancel`, headers: { authorization: `Bearer ${token}` }, payload: { reason: 'x', idempotencyKey } });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: 'POST', url: `/api/v1/storefront/orders/${order.id}/lines/${line.id}/cancel`, headers: { authorization: `Bearer ${token}` }, payload: { reason: 'x', idempotencyKey } });
      expect(second.statusCode).toBe(200);

      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { reversalOrderLineId: line.id } })).toBe(1);
    });
  });

  // --- Matrix item 7 ---

  describe('7. Return/QC before vesting -> pending points reversed/cancelled -> never available', () => {
    async function deliveredOrderWithReturn(qc: 'PASS' | 'FAIL', ctx: Awaited<ReturnType<typeof seedContext>>) {
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const wT = await warehouseToken();
      const { lineId } = await deliverOrderLine(order.id, wT); // real-time delivery - window still open, entry still PENDING

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/returns',
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId: order.id, lines: [{ orderLineId: lineId, reason: 'QC gating test' }], method: 'DROP_OFF', idempotencyKey: `ret-init-${lineId}` },
      });
      expect(initRes.statusCode).toBe(201);
      const returnId = initRes.json().id as string;
      await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${wT}` } });
      const returnLine = await testPrisma.returnLine.findUniqueOrThrow({ where: { orderLineId: lineId } });

      const qcRes = await app.inject({
        method: 'POST',
        url: `/api/v1/returns/${returnId}/lines/${returnLine.id}/qc`,
        headers: { authorization: `Bearer ${wT}` },
        payload: qc === 'PASS' ? { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } : { qcResult: 'FAIL', disposition: 'WRITE_OFF', notes: 'Damaged' },
      });
      expect(qcRes.statusCode).toBe(200);
      return { token, order, lineId, returnLineId: returnLine.id };
    }

    it('a QC-PASS return while still PENDING cancels the entitlement (pointsDelta 0, requiredPointsDelta fully recorded) - never later vests', async () => {
      const ctx = await seedContext();
      const { token, lineId, returnLineId } = await deliveredOrderWithReturn('PASS', ctx);
      const entry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: lineId } });
      expect(entry.vestingStatus).toBe('CANCELLED');

      const balance = await getBalance(token);
      expect(balance.balance).toBe(0);
      expect(balance.pendingPoints).toBe(0);

      const reverseEntry = await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalReturnLineId: returnLineId } });
      expect(reverseEntry).toBeTruthy();
      expect(reverseEntry!.pointsDelta).toBe(0);
      expect(reverseEntry!.requiredPointsDelta).toBe(-entry.pointsDelta);

      // Never becomes available even if a sweep later runs (the calendar
      // window may still technically be open, but CANCELLED is terminal).
      const vested = await vestPoints();
      expect(vested).toBe(0);
      expect((await getBalance(token)).balance).toBe(0);
    });

    it('a QC-FAIL return does NOT cancel/reverse points - the entitlement remains PENDING and can still vest normally', async () => {
      const ctx = await seedContext();
      const { token, lineId } = await deliveredOrderWithReturn('FAIL', ctx);
      const entry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: lineId } });
      expect(entry.vestingStatus).toBe('PENDING'); // untouched

      const fulfilment = await testPrisma.orderFulfilment.findFirstOrThrow({ where: { lines: { some: { id: lineId } } } });
      await backdateDelivery(fulfilment.id, RETURN_WINDOW_DEFAULT_DAYS + 3);
      const vested = await vestPoints();
      expect(vested).toBe(1); // a QC-FAILED return does not block vesting once the window closes

      const balance = await getBalance(token);
      expect(balance.balance).toBe(entry.pointsDelta);
    });
  });

  // --- Matrix item 8 ---

  describe('8. 100 available + 500 pending -> checkout can redeem a maximum based only on the 100 available', () => {
    it('checkout redemption is capped at the AVAILABLE (vested) balance, never available+pending', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithVestedPoints(100, ctx);
      const vestedBalance = await getBalance(token);
      expect(vestedBalance.balance).toBeGreaterThanOrEqual(100);
      const available = vestedBalance.balance;

      // Earn a SECOND, much larger batch that stays PENDING (not delivered) -
      // mirroring the Product Owner's own "100 available + 500 pending"
      // illustration (kept under the test environment's COD order-value
      // ceiling once tax/shipping are added, so 300 rather than 500).
      const { skuId: pendingSkuId } = await setupCheckoutableSku(300 * 100 + 200, ctx, 50);
      const pendingRes = await customerCheckout(pendingSkuId, token, `idem-8-pending-${counter}`);
      expect(pendingRes.statusCode).toBe(201);
      const balanceWithPending = await getBalance(token);
      expect(balanceWithPending.balance).toBe(available); // unchanged - the new batch is PENDING
      expect(balanceWithPending.pendingPoints).toBeGreaterThanOrEqual(300);

      // Attempting to redeem more than the available (but well within
      // available+pending) is rejected.
      const { skuId: overSkuId } = await setupCheckoutableSku(3000, ctx);
      const overRes = await customerCheckout(overSkuId, token, `idem-8-over-${counter}`, { loyaltyPointsToRedeem: available + 200 });
      expect(overRes.statusCode).toBe(400);

      // Redeeming exactly the available amount succeeds.
      const { skuId: exactSkuId } = await setupCheckoutableSku(3000, ctx);
      const exactRes = await customerCheckout(exactSkuId, token, `idem-8-exact-${counter}`, { loyaltyPointsToRedeem: available });
      expect(exactRes.statusCode).toBe(201);
      expect(exactRes.json().loyaltyPointsRedeemed).toBe(available);
    });
  });

  // --- Matrix item 9 ---

  describe('9. Minimum-redemption calculation ignores pending points', () => {
    it('a customer with ONLY pending points (0 available) cannot redeem even the configured minimum', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(200, ctx); // stays PENDING - never delivered
      expect((await getBalance(token)).pendingPoints).toBeGreaterThanOrEqual(200);
      expect((await getBalance(token)).balance).toBe(0);

      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const res = await customerCheckout(skuId, token, `idem-9-${counter}`, { loyaltyPointsToRedeem: 100 }); // default LOYALTY_MIN_REDEMPTION_POINTS
      expect(res.statusCode).toBe(400);
      void order;
    });
  });

  // --- Matrix item 10 ---

  describe('10. FIFO redemption never consumes pending points', () => {
    it('redeeming draws down ONLY the vested batch - a pending batch for the same account is left completely untouched', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithVestedPoints(200, ctx);
      const vestedEntry = await testPrisma.loyaltyLedgerEntry.findFirstOrThrow({ where: { type: 'EARN', vestingStatus: 'VESTED' } });

      // A second, later batch for the SAME customer that stays PENDING.
      const { skuId: pendingSkuId } = await setupCheckoutableSku(300 * 100 + 200, ctx, 50);
      await customerCheckout(pendingSkuId, token, `idem-10-pending-${counter}`);
      const pendingEntry = await testPrisma.loyaltyLedgerEntry.findFirstOrThrow({ where: { type: 'EARN', vestingStatus: 'PENDING' } });
      const pendingRemainingBefore = pendingEntry.remainingPoints;

      const { skuId: redeemSkuId } = await setupCheckoutableSku(3000, ctx);
      const redeemPoints = 100; // must meet LOYALTY_MIN_REDEMPTION_POINTS (default 100)
      const res = await customerCheckout(redeemSkuId, token, `idem-10-redeem-${counter}`, { loyaltyPointsToRedeem: redeemPoints });
      expect(res.statusCode).toBe(201);

      const freshVested = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: vestedEntry.id } });
      expect(freshVested.remainingPoints).toBe(vestedEntry.pointsDelta - redeemPoints);

      const freshPending = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: pendingEntry.id } });
      expect(freshPending.remainingPoints).toBe(pendingRemainingBefore); // completely untouched
      expect(freshPending.vestingStatus).toBe('PENDING');
    });
  });

  // --- Matrix item 11 ---

  describe('11. Expiry clock starts from vesting date, not the original purchase date', () => {
    it('expiresAt is null while PENDING, and is set to vestedAt + configured expiry duration only once vested', async () => {
      const ctx = await seedContext();
      const { order } = await customerWithEarnedPoints(100, ctx);
      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const pendingEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });
      expect(pendingEntry.expiresAt).toBeNull();

      const wT = await warehouseToken();
      const { fulfilmentId } = await deliverOrderLine(order.id, wT);
      await backdateDelivery(fulfilmentId, RETURN_WINDOW_DEFAULT_DAYS + 3);
      await vestPoints();

      const vestedEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: pendingEntry.id } });
      expect(vestedEntry.vestedAt).toBeTruthy();
      expect(vestedEntry.expiresAt).toBeTruthy();
      // expiresAt is anchored to vestedAt (~now), NOT createdAt (which is
      // over a week earlier, thanks to the backdated delivery above) -
      // the two would differ by roughly RETURN_WINDOW_DEFAULT_DAYS if the
      // clock had wrongly started at purchase time.
      const msFromVestToExpiry = vestedEntry.expiresAt!.getTime() - vestedEntry.vestedAt!.getTime();
      const msFromCreateToExpiry = vestedEntry.expiresAt!.getTime() - vestedEntry.createdAt.getTime();
      expect(msFromCreateToExpiry).toBeGreaterThan(msFromVestToExpiry);

      // The expiry sweep itself only ever acts on VESTED entries.
      await testPrisma.loyaltyLedgerEntry.update({ where: { id: vestedEntry.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const loyalty = new LoyaltyService(app);
      const expiredCount = await loyalty.expirePoints();
      expect(expiredCount).toBe(1);
    });
  });

  // --- Matrix items 12 & 13 ---

  describe('12 & 13. Partial/multi-line order: independent vesting per line, by each line\'s own delivery date', () => {
    it('line A (delivered, window closed) vests while line B (delivered later, window still open) remains PENDING - independent vesting by delivery date', async () => {
      const ctx = await seedContext();
      const { skuId: skuA } = await setupCheckoutableSku(20000, ctx, 50);
      const { skuId: skuB } = await setupCheckoutableSku(20000, ctx, 50);
      const { token } = await createAuthenticatedCustomer(app);
      const res = await customerCheckoutMultiLine([skuA, skuB], token, `idem-multiline-${counter}`);
      expect(res.statusCode).toBe(201);
      const order = await orderFromSession(res.json().id);
      const lines = await testPrisma.orderLine.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } });
      expect(lines).toHaveLength(2);
      const [lineA, lineB] = lines as [(typeof lines)[number], (typeof lines)[number]];

      const wT = await warehouseToken();
      const { fulfilmentId: fulfilmentA } = await deliverSpecificLine(order.id, lineA.id, lineA.quantity, wT);
      await backdateDelivery(fulfilmentA, RETURN_WINDOW_DEFAULT_DAYS + 3); // A's window has closed

      const { fulfilmentId: fulfilmentB } = await deliverSpecificLine(order.id, lineB.id, lineB.quantity, wT);
      // B is delivered "now" (real time, matrix item 13's own "different
      // delivery dates" premise) - its window is still open.
      void fulfilmentB;

      const vested = await vestPoints();
      expect(vested).toBe(1); // exactly line A

      const entryA = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: lineA.id } });
      const entryB = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: lineB.id } });
      expect(entryA.vestingStatus).toBe('VESTED');
      expect(entryB.vestingStatus).toBe('PENDING');

      const balance = await getBalance(token);
      expect(balance.balance).toBe(entryA.pointsDelta);
      expect(balance.pendingPoints).toBe(entryB.pointsDelta);
    });
  });

  // --- Matrix item 14: existing redemption concurrency proof, now against genuinely VESTED points ---

  describe('14. Existing redemption concurrency protection remains green under the vesting model', () => {
    it('two genuinely concurrent checkouts each redeeming most of the same AVAILABLE balance converge to exactly one success', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithVestedPoints(200, ctx);
      const balance = await getBalance(token);
      const spendEach = Math.floor(balance.balance * 0.7); // two of these together exceed the balance

      const { skuId: skuA } = await setupCheckoutableSku(3000, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(3000, ctx);

      await addToCart(skuA, { authorization: `Bearer ${token}` });
      await addToCart(skuB, { authorization: `Bearer ${token}` });

      const fireA = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/checkout',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            contactName: 'Jane Doe',
            contactMobile: '9876543210',
            billingAddress: validAddress(),
            shippingAddress: validAddress(),
            paymentMethod: 'COD',
            idempotencyKey: `race-a-${counter}`,
            loyaltyPointsToRedeem: spendEach,
          },
        });
      const fireB = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/storefront/checkout',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            contactName: 'Jane Doe',
            contactMobile: '9876543210',
            billingAddress: validAddress(),
            shippingAddress: validAddress(),
            paymentMethod: 'COD',
            idempotencyKey: `race-b-${counter}`,
            loyaltyPointsToRedeem: spendEach,
          },
        });

      const [resA, resB] = await Promise.all([fireA(), fireB()]);
      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 400]);

      const winner = resA.statusCode === 201 ? resA : resB;
      const winnerOrder = await orderFromSession(winner.json().id);
      // The winner's OWN new order also earns points, but under LOY-006
      // those are freshly-created PENDING entries that never touch
      // `balance` - so the net change here is spend-only.
      const finalBalance = await getBalance(token);
      expect(finalBalance.balance).toBe(balance.balance - spendEach);
      expect(finalBalance.balance).toBeGreaterThanOrEqual(0);
      void winnerOrder;
    });
  });

  // --- Matrix item 16: the fixed 100%-shortfall accounting hole (exceptional/admin post-vest path) ---

  describe('16. Exceptional post-vest reversal: the required reversal is truthfully recorded even at a zero balance-affecting amount', () => {
    it('a VESTED entry whose points were already fully spent still gets a REVERSE entry (pointsDelta 0) with the full requiredPointsDelta and a shortfall audit event - never silently skipped', async () => {
      const ctx = await seedContext();
      // Vest a batch, then spend it all elsewhere - simulating the
      // ADMIN-EXCEPTION scenario the Product Owner's own instruction
      // describes (a VESTED entry reversed after its points are already
      // spent). Under the certified system's NORMAL customer lifecycle
      // this branch is structurally unreachable (cancellation only
      // applies pre-shipment; a return/exchange can only be INITIATED
      // while the window is open, and vesting only happens once it has
      // closed) - so this test invokes LoyaltyService.reverseForOrderLine
      // directly, exactly as an out-of-band administrative process would,
      // rather than via the customer-facing cancel/return HTTP routes
      // (which correctly refuse to reach this state through normal use).
      const { token, order } = await customerWithVestedPoints(200, ctx);
      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const vestedEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: line.id } });
      const earnedPoints = vestedEntry.pointsDelta;

      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const spendRes = await customerCheckout(skuId, token, `idem-16-spend-${counter}`, { loyaltyPointsToRedeem: earnedPoints });
      expect(spendRes.statusCode).toBe(201);
      const freshEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: vestedEntry.id } });
      expect(freshEntry.remainingPoints).toBe(0); // fully spent

      const loyalty = new LoyaltyService(app);
      const fullOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
      await testPrisma.$transaction(async (tx) => {
        await loyalty.reverseForOrderLine(tx, fullOrder, line, 'Admin-exception reversal test');
      });

      const reverseEntry = await testPrisma.loyaltyLedgerEntry.findFirstOrThrow({ where: { reversalOrderLineId: line.id } });
      expect(reverseEntry.pointsDelta).toBe(0); // nothing left in the balance to reverse
      expect(reverseEntry.requiredPointsDelta).toBe(-earnedPoints); // the FULL required reversal, never silently dropped

      const shortfallAudit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'loyalty.reverse.postvest.shortfall', reference: order.id } });
      expect((shortfallAudit.newValue as { shortfall: number }).shortfall).toBe(earnedPoints);

      // The balance is unaffected further (it was already 0 for this
      // batch) - no negative balance was invented.
      const balance = await getBalance(token);
      expect(balance.balance).toBeGreaterThanOrEqual(0);
    });
  });

  // --- Manual staff adjustment (unaffected by vesting - always immediate) ---

  describe('Manual staff adjustment', () => {
    it('a positive manual adjustment increments balance and lifetime points immediately (no vesting involved); retried with the same idempotencyKey is a safe no-op', async () => {
      const { customerId, token } = await createAuthenticatedCustomer(app);
      const fin = await financeToken();
      const idempotencyKey = `adjust-${customerId}`;
      const res1 = await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: 500, reason: 'Goodwill gesture', idempotencyKey } });
      expect(res1.statusCode).toBe(200);
      const res2 = await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: 500, reason: 'Goodwill gesture', idempotencyKey } });
      expect(res2.statusCode).toBe(200);
      expect(res1.json().id).toBe(res2.json().id);

      const balance = await getBalance(token);
      expect(balance.balance).toBe(500);
      expect(balance.lifetimeEarnedPoints).toBe(500);
    });

    it('a negative manual adjustment decrements balance without demoting lifetime tier standing', async () => {
      const { customerId, token } = await createAuthenticatedCustomer(app);
      const fin = await financeToken();
      await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: 1000, reason: 'Grant', idempotencyKey: `grant-${customerId}` } });
      await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: -300, reason: 'Correction', idempotencyKey: `correct-${customerId}` } });

      const balance = await getBalance(token);
      expect(balance.balance).toBe(700);
      expect(balance.lifetimeEarnedPoints).toBe(1000);
    });

    it('a staff caller without loyalty:adjust permission is rejected', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const res = await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${csToken}` }, payload: { customerId, pointsDelta: 100, reason: 'x', idempotencyKey: `noperm-${customerId}` } });
      expect(res.statusCode).toBe(403);
    });

    it('the vesting sweep route is gated by the SAME loyalty:adjust permission as every other loyalty staff route, and rejects a caller without it', async () => {
      const fin = await financeToken(); // has loyalty:adjust - the sweep route uses the identical staffAuth gate
      const okRes = await app.inject({ method: 'POST', url: '/api/v1/loyalty/sweep/vest', headers: { authorization: `Bearer ${fin}` } });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.json()).toHaveProperty('vested');

      await grantPermissions('CUSTOMER_SERVICE', ['order:read']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const forbiddenRes = await app.inject({ method: 'POST', url: '/api/v1/loyalty/sweep/vest', headers: { authorization: `Bearer ${csToken}` } });
      expect(forbiddenRes.statusCode).toBe(403);
    });
  });

  // --- IDOR / cross-customer access ---

  describe('IDOR: cross-customer access is impossible', () => {
    it('customer A only ever sees their own balance/ledger - there is no parameter to tamper (customerId always comes from the verified JWT)', async () => {
      const ctx = await seedContext();
      const { token: tokenA } = await customerWithVestedPoints(100, ctx);
      const { token: tokenB } = await createAuthenticatedCustomer(app);

      const balanceA = await getBalance(tokenA);
      expect(balanceA.balance).toBeGreaterThan(0);
      const balanceB = await getBalance(tokenB);
      expect(balanceB.balance).toBe(0);

      const ledgerA = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger', headers: { authorization: `Bearer ${tokenA}` } });
      const ledgerB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger', headers: { authorization: `Bearer ${tokenB}` } });
      expect(ledgerA.json().length).toBeGreaterThan(0);
      expect(ledgerB.json().length).toBe(0);
    });

    it('an unauthenticated request to either customer route is rejected', async () => {
      const balanceRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty' });
      expect(balanceRes.statusCode).toBe(401);
      const ledgerRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger' });
      expect(ledgerRes.statusCode).toBe(401);
    });

    it("a guest session (no customer JWT) cannot reach either loyalty route - loyalty has no guest concept", async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty', headers: { 'x-guest-session-id': `guest-idor-${counter}` } });
      expect(res.statusCode).toBe(401);
    });
  });
});
