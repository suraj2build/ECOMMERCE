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

/**
 * Loyalty (M23, specs/22-loyalty.md, LOY-001-005) adversarial
 * certification. Covers: EARN at order confirmation (idempotent, no
 * double-earn on retry, zero-point/guest no-ops), REVERSE on
 * cancellation and on QC-PASS return (proportional, capped at
 * remaining, gated identically to refund eligibility - a FAILED QC
 * return does not claw back points), FIFO EXPIRE (deterministic,
 * non-double-expiring, callable sweep), checkout-time redemption HOLD
 * (reserve/convert/release mirroring InventoryReservation's own
 * lifecycle), genuine concurrency (two simultaneous checkouts cannot
 * double-spend the same points balance), manual staff adjustment
 * (idempotent), and cross-customer IDOR on both customer-facing routes.
 */
describe('Loyalty (M23)', () => {
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

  /** Places a COD order as a signed-in customer (loyalty requires a persistent identity - guest orders never earn/redeem). */
  function customerCheckout(
    skuId: string,
    customerToken: string,
    idempotencyKey: string,
    opts: { quantity?: number; loyaltyPointsToRedeem?: number } = {},
  ) {
    const headers = { authorization: `Bearer ${customerToken}` };
    return addToCart(skuId, headers, opts.quantity ?? 1).then(() =>
      app.inject({
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
      }),
    );
  }

  async function orderFromSession(sessionId: string) {
    return testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
  }

  /** Earns `targetPoints` (or more) for a fresh customer via one confirmed COD order at the default 1-point-per-100-INR rate, returning the customer token and the earning order. */
  async function customerWithEarnedPoints(targetPoints: number, ctx: Awaited<ReturnType<typeof seedContext>>) {
    const subtotalNeeded = targetPoints * 100 + 200; // headroom past the floor() rounding
    const { skuId } = await setupCheckoutableSku(subtotalNeeded, ctx, 50);
    const { token } = await createAuthenticatedCustomer(app);
    const res = await customerCheckout(skuId, token, `idem-earn-${counter}-${Math.random()}`);
    expect(res.statusCode).toBe(201);
    const order = await orderFromSession(res.json().id);
    return { token, order, skuId };
  }

  async function deliverOrderLine(orderId: string, staffToken: string): Promise<{ lineId: string; fulfilmentId: string }> {
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: { authorization: `Bearer ${staffToken}` }, payload: { idempotencyKey: `pick-${lineId}`, outcome: 'FULL', pickedQuantity: order.lines[0]!.quantity } });
    const fulfilRes = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/fulfilments`, headers: { authorization: `Bearer ${staffToken}` }, payload: { lineIds: [lineId] } });
    const fulfilmentId = fulfilRes.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: { authorization: `Bearer ${staffToken}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ready-to-ship`, headers: { authorization: `Bearer ${staffToken}` } });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: { authorization: `Bearer ${staffToken}` }, payload: {} });
    const deliverRes = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: { authorization: `Bearer ${staffToken}` } });
    expect(deliverRes.statusCode).toBe(200);
    return { lineId, fulfilmentId };
  }

  async function getBalance(customerToken: string) {
    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty', headers: { authorization: `Bearer ${customerToken}` } });
    expect(res.statusCode).toBe(200);
    return res.json() as { balance: number; lifetimeEarnedPoints: number; tier: { id: string; name: string } | null };
  }

  // --- EARN ---

  describe('EARN at order confirmation', () => {
    it('1. a confirmed COD order posts exactly one EARN entry at the configured rate, reflected in the account balance', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const expectedPoints = Math.floor(Number(order.subtotal) / 100);

      const balance = await getBalance(token);
      expect(balance.balance).toBe(expectedPoints);
      expect(balance.lifetimeEarnedPoints).toBe(expectedPoints);

      const entries = await testPrisma.loyaltyLedgerEntry.count({ where: { qualifyingOrderId: order.id } });
      expect(entries).toBe(1);
    });

    it('2. a guest (no customerId) order never earns points - safe no-op', async () => {
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
      const order = await orderFromSession(res.json().id);
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { qualifyingOrderId: order.id } })).toBe(0);
      expect(await testPrisma.loyaltyAccount.count()).toBe(0);
    });

    it('3. retrying order creation for the same confirmed session never double-earns (idempotent on qualifyingOrderId)', async () => {
      const ctx = await seedContext();
      const { order } = await customerWithEarnedPoints(100, ctx);

      // Direct repeat call of the same idempotent operation the checkout
      // flow itself calls exactly once - simulates a retried/duplicate
      // invocation (e.g. a crash-and-retry) rather than re-running checkout.
      const loyalty = new LoyaltyService(app);
      await testPrisma.$transaction(async (tx) => {
        await loyalty.earnForOrder(tx, order);
      });

      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { qualifyingOrderId: order.id } })).toBe(1);
    });

    it('4. a very small order (below the rounding floor) earns zero points - safe no-op, no ledger entry', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(50, ctx); // floor(50/100) = 0 points
      const { token } = await createAuthenticatedCustomer(app);
      const res = await customerCheckout(skuId, token, `idem-tiny-${counter}`);
      expect(res.statusCode).toBe(201);
      const order = await orderFromSession(res.json().id);
      expect(await testPrisma.loyaltyLedgerEntry.count({ where: { qualifyingOrderId: order.id } })).toBe(0);
    });
  });

  // --- REVERSE (cancellation) ---

  describe('REVERSE on cancellation', () => {
    it('5. cancelling the sole line of an order (pre-shipment) reverses its earned points via a REVERSE ledger entry, never a direct mutation', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const before = await getBalance(token);
      expect(before.balance).toBeGreaterThanOrEqual(100);

      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/orders/${order.id}/lines/${line.id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'Changed my mind', idempotencyKey: `cancel-${line.id}` },
      });
      expect(cancelRes.statusCode).toBe(200);

      const after = await getBalance(token);
      expect(after.balance).toBe(0);

      const reverseEntry = await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalOrderLineId: line.id } });
      expect(reverseEntry).toBeTruthy();
      expect(reverseEntry!.type).toBe('REVERSE');
      expect(reverseEntry!.pointsDelta).toBe(-before.balance);
    });

    it('6. retrying the same cancellation never double-reverses (idempotent on reversalOrderLineId)', async () => {
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

  // --- REVERSE (return, QC-gated) ---

  describe('REVERSE on return, gated identically to refund eligibility', () => {
    async function deliveredOrderWithReturn(qc: 'PASS' | 'FAIL', ctx: Awaited<ReturnType<typeof seedContext>>) {
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const wT = await warehouseToken();
      const { lineId } = await deliverOrderLine(order.id, wT);

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

    it('7. a QC-PASS return reverses the line share of earned points', async () => {
      const ctx = await seedContext();
      const { token, returnLineId } = await deliveredOrderWithReturn('PASS', ctx);
      const after = await getBalance(token);
      expect(after.balance).toBe(0);
      expect(await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalReturnLineId: returnLineId } })).toBeTruthy();
    });

    it('8. a QC-FAIL return does NOT claw back points - mirrors the existing refundEligible=false DECISION_REQUIRED boundary', async () => {
      const ctx = await seedContext();
      const { token, returnLineId } = await deliveredOrderWithReturn('FAIL', ctx);
      const after = await getBalance(token);
      expect(after.balance).toBeGreaterThan(0); // untouched
      expect(await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalReturnLineId: returnLineId } })).toBeNull();
    });
  });

  // --- Blocker 1 reproduction (independent-review certification repair) ---

  describe('REVERSE after points already spent (Blocker 1 reproduction)', () => {
    it('22. cancelling a line whose earned points were already redeemed on a LATER order posts a SHORT reversal - proves the current cap-at-remaining behavior does not satisfy "points earned on a cancelled/returned qualifying purchase must be reversed"', async () => {
      const ctx = await seedContext();
      // Order A earns ~200 points (its own, sole EARN batch) - the exact
      // amount depends on the headroom customerWithEarnedPoints adds past
      // the rounding floor, so read it back rather than hardcoding it.
      const { token, order: orderA } = await customerWithEarnedPoints(200, ctx);
      const earnEntryA = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderId: orderA.id } });
      const earnedPoints = earnEntryA.pointsDelta;
      expect(earnedPoints).toBeGreaterThanOrEqual(200);

      // The customer then spends most (but not all) of those points on
      // Order B - FIFO consumption draws from Order A's batch (the only
      // one that exists at this point), leaving only a small remainder
      // of remainingPoints on it.
      const redeemAmount = 150;
      const expectedRemaining = earnedPoints - redeemAmount;
      const { skuId: skuB } = await setupCheckoutableSku(3000, ctx);
      const redeemRes = await customerCheckout(skuB, token, `idem-blocker1-redeem-${counter}`, { loyaltyPointsToRedeem: redeemAmount });
      expect(redeemRes.statusCode).toBe(201);

      const freshEarnA = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: earnEntryA.id } });
      expect(freshEarnA.remainingPoints).toBe(expectedRemaining);

      // Order A's line is now cancelled - a qualifying reversal event.
      // The FULL `earnedPoints` Order A earned must be reversed through
      // the ledger (the approved requirement), never merely "whatever is
      // still unconsumed in that one batch".
      const lineA = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: orderA.id } });
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/orders/${orderA.id}/lines/${lineA.id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'Blocker 1 repro', idempotencyKey: `blocker1-cancel-${lineA.id}` },
      });
      expect(cancelRes.statusCode).toBe(200);

      const reverseEntry = await testPrisma.loyaltyLedgerEntry.findFirst({ where: { reversalOrderLineId: lineA.id } });
      expect(reverseEntry).toBeTruthy();
      // The balance-affecting reversal is still capped at whatever
      // remains unconsumed in the EARN batch (`expectedRemaining`) -
      // applying more would make the balance negative, which this build
      // does not invent semantics for.
      expect(reverseEntry!.pointsDelta).toBe(-expectedRemaining); // short by redeemAmount of the required -earnedPoints
      expect(-reverseEntry!.pointsDelta).not.toBe(earnedPoints);
      // LOY-001 repair (Blocker 1): the FULL required reversal is now
      // ALWAYS recorded too, separately, so the shortfall is fully
      // visible/audited rather than silently hidden behind a capped
      // number - see DECISION_REQUIRED - LOYALTY CLAWBACK AFTER POINTS
      // ALREADY SPENT in specs/22-loyalty.md for the unresolved business
      // question of what (if anything) should be done about it.
      expect(reverseEntry!.requiredPointsDelta).toBe(-earnedPoints);
      const shortfallAudit = await testPrisma.auditLog.findFirst({ where: { action: 'loyalty.reverse.shortfall', reference: orderA.id } });
      expect(shortfallAudit).toBeTruthy();
      expect((shortfallAudit!.newValue as { shortfall: number }).shortfall).toBe(redeemAmount);
    });
  });

  // --- Checkout-time redemption HOLD ---

  describe('Redemption hold: reserve / convert / release', () => {
    it('9. redeeming points at checkout creates an ACTIVE hold that does NOT touch the ledger/balance until order confirmation, then CONVERTs to a real REDEEM entry', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithEarnedPoints(200, ctx);
      const before = await getBalance(token);
      expect(before.balance).toBeGreaterThanOrEqual(150);

      const { skuId: skuId2 } = await setupCheckoutableSku(3000, ctx);
      const redeemPoints = 150;
      const res = await customerCheckout(skuId2, token, `idem-redeem-${counter}`, { loyaltyPointsToRedeem: redeemPoints });
      expect(res.statusCode).toBe(201);
      const view = res.json();
      expect(view.loyaltyPointsRedeemed).toBe(redeemPoints);
      expect(view.amountPayable).toBeLessThan(view.grandTotal);

      const order2 = await orderFromSession(view.id);
      const hold = await testPrisma.loyaltyRedemptionHold.findUniqueOrThrow({ where: { checkoutSessionId: view.id } });
      expect(hold.status).toBe('CONVERTED'); // COD auto-confirms in the same call, so conversion already happened
      expect(order2.loyaltyPointsRedeemed).toBe(redeemPoints);

      const redeemEntries = await testPrisma.loyaltyLedgerEntry.findMany({ where: { type: 'REDEEM' } });
      expect(redeemEntries.reduce((s, e) => s + e.pointsDelta, 0)).toBe(-redeemPoints);

      // This SAME order2 also earns its own new points on its own
      // subtotal (EARN runs for every confirmed order regardless of
      // whether it's simultaneously redeeming) - the net balance change
      // is redemption spent MINUS whatever order2 itself just earned,
      // never a bare `before - redeemPoints` (that would silently ignore
      // order2's own EARN, exactly the "one ledger compensating another"
      // this build must never let happen unnoticed).
      const after = await getBalance(token);
      expect(after.balance).toBe(before.balance - redeemPoints + order2.loyaltyPointsEarned);
    });

    it('10. redeeming below the configured minimum is rejected, reservations released, no hold created', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithEarnedPoints(200, ctx);
      const { skuId: skuId2 } = await setupCheckoutableSku(3000, ctx);
      const res = await customerCheckout(skuId2, token, `idem-min-${counter}`, { loyaltyPointsToRedeem: 10 });
      expect(res.statusCode).toBe(400);
      expect(await testPrisma.loyaltyRedemptionHold.count()).toBe(0);
    });

    it('11. redeeming more points than are available (balance minus active holds) is rejected', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithEarnedPoints(150, ctx);
      const balance = await getBalance(token);
      const { skuId: skuId2 } = await setupCheckoutableSku(3000, ctx);
      const res = await customerCheckout(skuId2, token, `idem-over-${counter}`, { loyaltyPointsToRedeem: balance.balance + 500 });
      expect(res.statusCode).toBe(400);
    });

    it('12. a guest identity cannot redeem loyalty points (loyalty requires a persistent customer identity)', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const headers = { 'x-guest-session-id': `guest-noloy-${counter}` };
      await addToCart(skuId, headers);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/checkout',
        headers,
        payload: { contactName: 'Guest', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey: `idem-guest-redeem-${counter}`, loyaltyPointsToRedeem: 150 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('13. releaseStaleRedemptionHolds releases an expired ACTIVE hold without touching the ledger', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithEarnedPoints(200, ctx);
      const { skuId: skuId2 } = await setupCheckoutableSku(3000, ctx);
      const res = await customerCheckout(skuId2, token, `idem-stale-${counter}`, { loyaltyPointsToRedeem: 150 });
      expect(res.statusCode).toBe(201);
      // Force the hold back to ACTIVE and expired, simulating an
      // abandoned/failed-payment checkout whose order was never created
      // (the COD happy path always converts immediately - this
      // reconstructs the PREPAID-payment-never-completed scenario the
      // sweep exists for).
      await testPrisma.loyaltyRedemptionHold.updateMany({
        where: { checkoutSessionId: res.json().id },
        data: { status: 'ACTIVE', expiresAt: new Date(Date.now() - 1000) },
      });
      const before = await getBalance(token);

      const loyalty = new LoyaltyService(app);
      const released = await loyalty.releaseStaleRedemptionHolds();
      expect(released).toBeGreaterThanOrEqual(1);

      const hold = await testPrisma.loyaltyRedemptionHold.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
      expect(hold.status).toBe('RELEASED');
      const after = await getBalance(token);
      expect(after.balance).toBe(before.balance); // untouched - a hold never spent anything
    });
  });

  // --- Genuine concurrency: two simultaneous checkouts cannot double-spend ---

  describe('Concurrency: redemption cannot be double-spent', () => {
    it('14. two genuinely concurrent checkouts each redeeming most of the same balance converge to exactly one success - the loser is rejected safely, never a negative balance', async () => {
      const ctx = await seedContext();
      const { token } = await customerWithEarnedPoints(200, ctx);
      const balance = await getBalance(token);
      const spendEach = Math.floor(balance.balance * 0.7); // two of these together exceed the balance

      const { skuId: skuA } = await setupCheckoutableSku(3000, ctx);
      const { skuId: skuB } = await setupCheckoutableSku(3000, ctx);

      // Each checkout uses its OWN cart line (added synchronously before
      // either request fires) so the race is isolated to the loyalty
      // hold/balance check, not cart-item contention. Both promises are
      // created (and dispatched) before either is awaited - genuine
      // concurrent execution against real Postgres, the same idiom this
      // codebase's own INV-003/EXC-004 concurrency tests rely on.
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

      // A separate, freshly-earned second account line is NOT used here
      // deliberately - both requests target the SAME LoyaltyAccount to
      // exercise the row lock. Since startCheckout adds its OWN cart item
      // per call via a shared cart, fire the second request against a
      // second independent cart identity for the SAME customer is not
      // possible (cart is keyed by customer) - instead this reuses the
      // same cart/session but a distinct idempotencyKey, relying on the
      // account-row FOR UPDATE lock inside reserveRedemptionForCheckout
      // (not the cart) to serialize the two attempts.
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
      // Exactly one succeeds (201); the other is safely rejected (400,
      // insufficient available points) once it observes the winner's
      // committed hold - never both succeeding (double-spend), never
      // both failing.
      expect(statuses).toEqual([201, 400]);

      const winner = resA.statusCode === 201 ? resA : resB;
      const winnerOrder = await orderFromSession(winner.json().id);

      // The winning order ALSO earns its own new points on its own
      // subtotal (EARN runs for every confirmed order) - the net change
      // is spendEach spent MINUS whatever the winner itself just earned,
      // never a bare `balance - spendEach` (see test 9's own note on
      // this same point - one ledger effect must never be allowed to
      // silently mask another).
      const finalBalance = await getBalance(token);
      expect(finalBalance.balance).toBeGreaterThanOrEqual(0);
      expect(finalBalance.balance).toBe(balance.balance - spendEach + winnerOrder.loyaltyPointsEarned);
    });
  });

  // --- FIFO EXPIRE ---

  describe('EXPIRE (FIFO sweep)', () => {
    it('15. an EARN batch past its expiry is expired by the sweep exactly once, even if the sweep runs twice concurrently', async () => {
      const ctx = await seedContext();
      const { token, order } = await customerWithEarnedPoints(100, ctx);
      const earnEntry = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderId: order.id } });
      await testPrisma.loyaltyLedgerEntry.update({ where: { id: earnEntry.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const loyalty = new LoyaltyService(app);
      const [countA, countB] = await Promise.all([loyalty.expirePoints(), loyalty.expirePoints()]);
      expect(countA + countB).toBe(1); // exactly one of the two concurrent sweeps actually expired this batch

      const after = await getBalance(token);
      expect(after.balance).toBe(0);
      const expireEntries = await testPrisma.loyaltyLedgerEntry.count({ where: { type: 'EXPIRE', accountId: earnEntry.accountId } });
      expect(expireEntries).toBe(1);
    });

    it('16. FIFO ordering: the OLDEST unexpired earn batch expires first, a newer batch is unaffected', async () => {
      const ctx = await seedContext();
      const { token, order: order1 } = await customerWithEarnedPoints(100, ctx);
      const account = await testPrisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: (await testPrisma.customer.findFirstOrThrow()).id } });
      // Second, later earn for the SAME customer - a fresh order.
      const { skuId } = await setupCheckoutableSku(15200, ctx, 50);
      const res2 = await customerCheckout(skuId, token, `idem-second-earn-${counter}`);
      expect(res2.statusCode).toBe(201);
      const order2 = await orderFromSession(res2.json().id);

      const entry1 = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderId: order1.id } });
      const entry2 = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderId: order2.id } });
      await testPrisma.loyaltyLedgerEntry.update({ where: { id: entry1.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const loyalty = new LoyaltyService(app);
      await loyalty.expirePoints();

      const freshEntry1 = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: entry1.id } });
      const freshEntry2 = await testPrisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: entry2.id } });
      expect(freshEntry1.remainingPoints).toBe(0);
      expect(freshEntry2.remainingPoints).toBe(entry2.pointsDelta); // untouched

      const balance = await getBalance(token);
      expect(balance.balance).toBe(entry2.pointsDelta);
      void account;
    });
  });

  // --- Manual staff adjustment ---

  describe('Manual staff adjustment', () => {
    it('17. a positive manual adjustment increments balance and lifetime points; retried with the same idempotencyKey is a safe no-op', async () => {
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

    it('18. a negative manual adjustment decrements balance without demoting lifetime tier standing', async () => {
      const { customerId, token } = await createAuthenticatedCustomer(app);
      const fin = await financeToken();
      await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: 1000, reason: 'Grant', idempotencyKey: `grant-${customerId}` } });
      await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${fin}` }, payload: { customerId, pointsDelta: -300, reason: 'Correction', idempotencyKey: `correct-${customerId}` } });

      const balance = await getBalance(token);
      expect(balance.balance).toBe(700);
      expect(balance.lifetimeEarnedPoints).toBe(1000); // lifetime standing (tier basis) never reduced by a clawback
    });

    it('19. a staff caller without loyalty:adjust permission is rejected', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await grantPermissions('CUSTOMER_SERVICE', ['order:read']);
      const { token: csToken } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const res = await app.inject({ method: 'POST', url: '/api/v1/loyalty/adjust', headers: { authorization: `Bearer ${csToken}` }, payload: { customerId, pointsDelta: 100, reason: 'x', idempotencyKey: `noperm-${customerId}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  // --- IDOR / cross-customer access ---

  describe('IDOR: cross-customer access is impossible', () => {
    it('20. customer A only ever sees their own balance/ledger - there is no parameter to tamper (customerId always comes from the verified JWT)', async () => {
      const ctx = await seedContext();
      const { token: tokenA } = await customerWithEarnedPoints(100, ctx);
      const { token: tokenB } = await createAuthenticatedCustomer(app);

      const balanceA = await getBalance(tokenA);
      expect(balanceA.balance).toBeGreaterThan(0);
      const balanceB = await getBalance(tokenB);
      expect(balanceB.balance).toBe(0); // B's own account, genuinely empty - never A's

      const ledgerA = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger', headers: { authorization: `Bearer ${tokenA}` } });
      const ledgerB = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger', headers: { authorization: `Bearer ${tokenB}` } });
      expect(ledgerA.json().length).toBeGreaterThan(0);
      expect(ledgerB.json().length).toBe(0);
    });

    it('21. an unauthenticated request to either customer route is rejected', async () => {
      const balanceRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty' });
      expect(balanceRes.statusCode).toBe(401);
      const ledgerRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty/ledger' });
      expect(ledgerRes.statusCode).toBe(401);
    });

    it("22. a guest session (no customer JWT) cannot reach either loyalty route - loyalty has no guest concept", async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/account/loyalty', headers: { 'x-guest-session-id': `guest-idor-${counter}` } });
      expect(res.statusCode).toBe(401);
    });
  });
});
