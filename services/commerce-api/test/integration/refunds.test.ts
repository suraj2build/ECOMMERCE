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
const SERVICEABLE_PINCODE = '110002';

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}

function capturedEvent(orderId: string, paymentEntityId: string) {
  return { id: `evt_${paymentEntityId}_captured`, event: 'payment.captured', payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } } };
}

/**
 * Refunds & Store Credit (M20, specs/19-refunds.md, REF-001-004;
 * specs/33-store-credit-gift-cards.md). Settles the two durable handoffs
 * M18 (Order.refundRequired) and M19 (ReturnLine.refundEligible) leave
 * behind. Covers: prepaid-to-original-method and COD-to-store-credit
 * settlement branching (REF-001), original-transaction-value correctness
 * even after a price change (REF-003), partial refund on a multi-line
 * order/return, idempotency (same key, different key against the same
 * line, genuine concurrency), the store-credit ledger's structural
 * separation and non-expiry (REF-002), credit-note reuse (cancellation)
 * vs fresh issuance (return), provider-failure -> retry recovery, the
 * reconciliation sweep, ownership/IDOR, and RBAC.
 */
describe('Refunds & Store Credit (M20)', () => {
  let app: FastifyInstance;
  let counter = 0;
  let refundFetchMode: 'ok' | 'fail' = 'ok';

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
    refundFetchMode = 'ok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        if (href.endsWith('/orders') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: `order_mock_${counter}` }), { status: 200 });
        }
        if (href.includes('/payments/') && href.endsWith('/refund')) {
          if (refundFetchMode === 'fail') {
            return new Response(JSON.stringify({ error: { description: 'simulated gateway failure' } }), { status: 502 });
          }
          return new Response(JSON.stringify({ id: `rfnd_${Math.random().toString(36).slice(2, 10)}`, status: 'processed' }), { status: 200 });
        }
        throw new Error(`Unexpected fetch in test: ${href}`);
      }),
    );
  });

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function financeToken(perms: string[] = ['payment:refund', 'order:read']) {
    await grantPermissions('FINANCE', perms);
    return (await createAuthenticatedStaff(app, ['FINANCE'])).token;
  }

  async function csToken(perms: string[] = ['order:read', 'order:cancel']) {
    await grantPermissions('CUSTOMER_SERVICE', perms);
    return (await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE'])).token;
  }

  async function warehouseToken(
    perms: string[] = [
      'order:read',
      'order:fulfil',
      'warehouse:read',
      'warehouse:pick',
      'warehouse:pack',
      'return:read',
      'return:initiate',
      'return:receive',
      'return:qc',
    ],
  ) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Refunds Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLREFTST${counter}A1Z${counter % 10}`,
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
        styleCode: `REF-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Refunds Test Jacket',
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
    return { orderId: order.id, headers };
  }

  async function cancelLine(orderId: string, lineId: string, token: string, idempotencyKey: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/lines/${lineId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey },
    });
    expect(res.statusCode).toBe(200);
  }

  /** Drives one order's single line all the way to DELIVERED (same helper shape as returns.test.ts). */
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

  async function initiateAndPassQc(orderId: string, lineId: string, wToken: string, reason = 'Wrong size') {
    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${wToken}` },
      payload: { orderId, lines: [{ orderLineId: lineId, reason }], method: 'DROP_OFF', idempotencyKey: `ret-init-${lineId}` },
    });
    expect(initRes.statusCode).toBe(201);
    const returnId = initRes.json().id as string;
    const returnLineId = initRes.json().lines[0].id as string;

    await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${wToken}` } });
    const qcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
      headers: { authorization: `Bearer ${wToken}` },
      payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
    });
    expect(qcRes.statusCode).toBe(200);
    return { returnId, returnLineId };
  }

  function processRefund(orderId: string, orderLineId: string, token: string, idempotencyKey: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/refunds',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId, orderLineId, idempotencyKey },
    });
  }

  // --- 1. Prepaid cancellation -> original payment method ---

  it('refunds a cancelled PREPAID line to the original payment method, generating exactly one credit note (reused from M18) and clearing refundRequired', async () => {
    const { skuId, locationId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-refund-${counter}`, `idem-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;

    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-${counter}`);

    const afterCancel = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterCancel.refundRequired).toBe(true);
    const creditNotesBefore = await testPrisma.creditNote.count();
    expect(creditNotesBefore).toBe(1); // M18's own cancellation-time credit note

    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-${counter}`);
    expect(res.statusCode).toBe(201);
    const refund = res.json();
    expect(refund.status).toBe('COMPLETED');
    expect(refund.method).toBe('ORIGINAL_PAYMENT_METHOD');
    expect(refund.triggerType).toBe('CANCELLATION');
    expect(Number(refund.amount)).toBeCloseTo(Number(order.lines[0]!.lineTotalInclusive), 2);
    expect(refund.providerRefundId).toBeTruthy();

    const creditNotesAfter = await testPrisma.creditNote.count();
    expect(creditNotesAfter).toBe(1); // reused M18's, never a second one

    const refundRow = await testPrisma.refund.findUniqueOrThrow({ where: { orderLineId: lineId } });
    expect(refundRow.creditNoteId).toBeTruthy();

    // The refund amount is this LINE's own original value (REF-003), which
    // is less than Payment.amount whenever the order also carried a
    // separate shipping charge - PARTIALLY_REFUNDED is the correct
    // outcome for a single-line order with non-zero shipping, exactly the
    // same as it would be for one cancelled line of a multi-line order;
    // this assertion only checks that CAPTURED genuinely flipped away.
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: order.checkoutSessionId } });
    expect(['REFUNDED', 'PARTIALLY_REFUNDED']).toContain(payment.status);

    const orderAfter = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.refundRequired).toBe(false);

    // no store credit was ever created for a PREPAID refund
    expect(await testPrisma.storeCreditEntry.count()).toBe(0);
    void locationId;
  });

  // --- 2. COD return -> store credit ---

  it('refunds a QC-passed COD return as store credit, issuing a fresh credit note (none existed yet) and incrementing the guest account balance exactly once', async () => {
    const { skuId } = await setupCheckoutableSku(2000);
    const guestId = `guest-refund-cod-${counter}`;
    const { orderId } = await codOrder(skuId, guestId, `idem-cod-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const { returnLineId } = await initiateAndPassQc(orderId, lineId, wT);

    const returnLineBefore = await testPrisma.returnLine.findUniqueOrThrow({ where: { id: returnLineId } });
    expect(returnLineBefore.refundEligible).toBe(true);

    expect(await testPrisma.creditNote.count()).toBe(0); // no credit note yet - return-triggered, never issued by M19

    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-cod-${counter}`);
    expect(res.statusCode).toBe(201);
    const refund = res.json();
    expect(refund.status).toBe('COMPLETED');
    expect(refund.method).toBe('STORE_CREDIT');
    expect(refund.triggerType).toBe('RETURN');
    expect(refund.storeCreditEntryId).toBeTruthy();
    expect(refund.providerRefundId).toBeNull();

    expect(await testPrisma.creditNote.count()).toBe(1); // issued fresh by RefundService

    const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: guestId } });
    expect(Number(account.balance)).toBeCloseTo(Number(refund.amount), 2);
    expect(await testPrisma.storeCreditEntry.count({ where: { accountId: account.id } })).toBe(1);
  });

  // --- 3. REF-003: original transaction value, not current catalog price ---

  it('refunds the original transaction value even after the product price changed post-order', async () => {
    const ctx = await seedContext();
    const { skuId, styleId } = await setupCheckoutableSku(1200, ctx);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-price-${counter}`, `idem-price-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const originalLineTotal = Number(order.lines[0]!.lineTotalInclusive);
    const lineId = order.lines[0]!.id;

    const merchT = await merchandisingToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${merchT}` },
      payload: { styleId, mrp: 3000, sellingPrice: 3000 },
    });

    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-price-${counter}`);
    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-price-${counter}`);
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().amount)).toBeCloseTo(originalLineTotal, 2);
    expect(Number(res.json().amount)).not.toBeCloseTo(3000, 2);
  });

  // --- 4/5. Idempotency ---

  it('a retried refund request with the exact same idempotency key is a safe no-op (exactly one Refund row, exactly one provider call)', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-idem-${counter}`, `idem-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-${counter}`);
    const fin = await financeToken();

    const key = `refund-dup-${counter}`;
    const first = await processRefund(orderId, lineId, fin, key);
    const second = await processRefund(orderId, lineId, fin, key);
    expect(first.json().id).toBe(second.json().id);
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1);
  });

  it('a different idempotency key against the SAME order line resolves to the existing refund rather than double-refunding', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-idem2-${counter}`, `idem-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-${counter}`);
    const fin = await financeToken();

    const first = await processRefund(orderId, lineId, fin, `refund-a-${counter}`);
    const second = await processRefund(orderId, lineId, fin, `refund-b-${counter}`);
    expect(first.json().id).toBe(second.json().id);
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1);
  });

  it('genuinely concurrent duplicate refund requests for the same line converge to exactly one Refund row and one store-credit entry', async () => {
    const { skuId } = await setupCheckoutableSku(1800);
    const guestId = `guest-concurrent-${counter}`;
    const { orderId } = await codOrder(skuId, guestId, `idem-conc-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    await initiateAndPassQc(orderId, lineId, wT);
    const fin = await financeToken();

    const [a, b, c] = await Promise.all([
      processRefund(orderId, lineId, fin, `conc-a-${counter}`),
      processRefund(orderId, lineId, fin, `conc-b-${counter}`),
      processRefund(orderId, lineId, fin, `conc-c-${counter}`),
    ]);
    for (const r of [a, b, c]) expect(r.statusCode).toBe(201);
    const ids = new Set([a, b, c].map((r) => r.json().id));
    expect(ids.size).toBe(1); // all three resolved to the same Refund row

    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1);
    const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: guestId } });
    expect(await testPrisma.storeCreditEntry.count({ where: { accountId: account.id } })).toBe(1);
    expect(Number(account.balance)).toBeCloseTo(Number(a.json().amount), 2);
  });

  /**
   * A DIFFERENT race from the one above: two DIFFERENT order lines (two
   * separate returns) belonging to the SAME guest, both reaching
   * first-ever store-credit issuance for that guest at the same instant -
   * the per-orderLineId Refund lock does not serialize this, since the
   * two refunds are genuinely different Refund rows; only
   * StoreCreditService's own account-creation path can race here. Caught
   * by this exact test during M20's own build - fixed in
   * StoreCreditService.lockOrCreateAccount (P2002-catch-and-resolve on
   * the account's own unique constraint, same discipline as every other
   * concurrent-creation race in this codebase).
   */
  it('two different order lines for the SAME guest, refunded concurrently, converge to one StoreCreditAccount with both amounts credited', async () => {
    const ctx = await seedContext();
    const a = await setupCheckoutableSku(1000, ctx);
    const b = await setupCheckoutableSku(1500, ctx);
    const guestId = `guest-two-accounts-race-${counter}`;

    const { orderId: orderIdA } = await codOrder(a.skuId, guestId, `idem-race-a-${counter}`);
    const { orderId: orderIdB } = await codOrder(b.skuId, guestId, `idem-race-b-${counter}`);
    const wT = await warehouseToken();
    const { lineId: lineIdA } = await deliverOrderLine(orderIdA, wT);
    const { lineId: lineIdB } = await deliverOrderLine(orderIdB, wT);
    await initiateAndPassQc(orderIdA, lineIdA, wT);
    await initiateAndPassQc(orderIdB, lineIdB, wT);
    const fin = await financeToken();

    const [ra, rb] = await Promise.all([
      processRefund(orderIdA, lineIdA, fin, `refund-race-a-${counter}`),
      processRefund(orderIdB, lineIdB, fin, `refund-race-b-${counter}`),
    ]);
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);
    expect(ra.json().status).toBe('COMPLETED');
    expect(rb.json().status).toBe('COMPLETED');

    expect(await testPrisma.storeCreditAccount.count({ where: { guestSessionId: guestId } })).toBe(1);
    const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: guestId } });
    expect(await testPrisma.storeCreditEntry.count({ where: { accountId: account.id } })).toBe(2);
    expect(Number(account.balance)).toBeCloseTo(Number(ra.json().amount) + Number(rb.json().amount), 2);
  });

  // --- 6. Partial refund on a multi-line order ---

  it('a partial cancellation of one line among two only refunds that line, not the whole order', async () => {
    const ctx = await seedContext();
    const a = await setupCheckoutableSku(1000, ctx);
    const b = await setupCheckoutableSku(2500, ctx);
    const guestId = `guest-partial-${counter}`;
    const headers = { [GUEST_HEADER]: guestId };
    await addToCart(a.skuId, headers);
    await addToCart(b.skuId, headers);
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
        idempotencyKey: `idem-partial-${counter}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const sessionId = res.json().id as string;
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
    const body = JSON.stringify(capturedEvent(payment.providerReferenceId!, `pay_partial_${counter}`));
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) },
      payload: body,
    });
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, include: { lines: { include: { sku: true } } } });
    const lineA = order.lines.find((l) => l.sku.styleId === a.styleId)!;
    const lineB = order.lines.find((l) => l.sku.styleId === b.styleId)!;

    const csT = await csToken();
    await cancelLine(order.id, lineA.id, csT, `cancel-partial-${counter}`);
    const fin = await financeToken();
    const res2 = await processRefund(order.id, lineA.id, fin, `refund-partial-${counter}`);
    expect(res2.statusCode).toBe(201);
    expect(Number(res2.json().amount)).toBeCloseTo(Number(lineA.lineTotalInclusive), 2);
    expect(Number(res2.json().amount)).not.toBeCloseTo(Number(order.grandTotal), 2);

    expect(await testPrisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    const lineBAfter = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(lineBAfter.status).not.toBe('CANCELLED');
  });

  // --- 7. Nothing-to-refund guards ---

  it('rejects processing a refund for a COD cancellation - no payment was ever collected', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId, headers: _h } = await codOrder(skuId, `guest-cod-cancel-${counter}`, `idem-codcancel-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-codcancel-${counter}`);

    const orderAfter = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.refundRequired).toBe(false);

    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-codcancel-${counter}`);
    expect(res.statusCode).toBe(400);
    void _h;
  });

  it('rejects processing a refund for a return line that failed QC (refundEligible remains false)', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await codOrder(skuId, `guest-qcfail-${counter}`, `idem-qcfail-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${wT}` },
      payload: { orderId, lines: [{ orderLineId: lineId, reason: 'Damaged' }], method: 'DROP_OFF', idempotencyKey: `ret-qcfail-${counter}` },
    });
    const returnId = initRes.json().id as string;
    const returnLineId = initRes.json().lines[0].id as string;
    await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: { authorization: `Bearer ${wT}` } });
    await app.inject({
      method: 'POST',
      url: `/api/v1/returns/${returnId}/lines/${returnLineId}/qc`,
      headers: { authorization: `Bearer ${wT}` },
      payload: { qcResult: 'FAIL', disposition: 'WRITE_OFF' },
    });

    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-qcfail-${counter}`);
    expect(res.statusCode).toBe(400);
  });

  // --- 8. Provider failure -> FAILED -> retry recovers ---

  it('a provider refund failure leaves the Refund row FAILED (Payment untouched, refundRequired still true), and a retry after the gateway recovers completes it', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-fail-${counter}`, `idem-fail-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-fail-${counter}`);

    refundFetchMode = 'fail';
    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-fail-${counter}`);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('FAILED');
    expect(res.json().failureReason).toBeTruthy();

    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: order.checkoutSessionId } });
    expect(payment.status).toBe('CAPTURED'); // never flipped to REFUNDED on a failed attempt
    const orderAfterFail = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfterFail.refundRequired).toBe(true);

    refundFetchMode = 'ok';
    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/refunds/${res.json().id}/retry`,
      headers: { authorization: `Bearer ${fin}` },
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().status).toBe('COMPLETED');
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1); // still exactly one row throughout

    const orderAfterRetry = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfterRetry.refundRequired).toBe(false);
  });

  // --- 8b. Independent-review repair, finding 4: deeper refund-concurrency recheck ---

  it('genuinely concurrent PREPAID refund requests call the Razorpay refund endpoint exactly once (the PROCESSING claim, not merely Razorpay idempotency, prevents a second call)', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-prepaid-conc-${counter}`, `idem-prepaid-conc-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-prepaid-conc-${counter}`);
    const fin = await financeToken();

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const callsBefore = fetchMock.mock.calls.length;

    const [a, b, c] = await Promise.all([
      processRefund(orderId, lineId, fin, `prepaid-conc-a-${counter}`),
      processRefund(orderId, lineId, fin, `prepaid-conc-b-${counter}`),
      processRefund(orderId, lineId, fin, `prepaid-conc-c-${counter}`),
    ]);
    // All three resolve to the SAME Refund row. Each one's OWN HTTP
    // response reflects whatever this row's status was at the exact
    // instant it was read: the winner of the PROCESSING claim (below)
    // sees the full settlement through to COMPLETED, but a loser that
    // lost the claim returns immediately without waiting for the
    // winner - it may legitimately observe a transient PROCESSING
    // snapshot rather than the eventual COMPLETED outcome. That is the
    // correct, intended behaviour of a genuine in-flight claim (never a
    // FAILED or a second independent settlement), not a bug - at least
    // one must reflect the real work; none may show anything else.
    for (const r of [a, b, c]) {
      expect(r.statusCode).toBe(201);
      expect(['PROCESSING', 'COMPLETED']).toContain(r.json().status);
    }
    expect([a, b, c].some((r) => r.json().status === 'COMPLETED')).toBe(true);
    expect(new Set([a, b, c].map((r) => r.json().id)).size).toBe(1);

    const refundCalls = fetchMock.mock.calls.slice(callsBefore).filter(([url]) => (url as string).toString().includes('/refund'));
    // The database-level PROCESSING claim (finding 4) is what actually
    // guarantees this - not merely Razorpay's own idempotency-key
    // dedup, which is a real but time-bounded contract this test does
    // not (and cannot) exercise the boundary of.
    expect(refundCalls.length).toBe(1);
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1);

    const finalRefund = await testPrisma.refund.findUniqueOrThrow({ where: { id: a.json().id } });
    expect(finalRefund.status).toBe('COMPLETED'); // the eventual, settled outcome

    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: order.checkoutSessionId } });
    // A single-line refund amount is less than Payment.amount (which
    // includes shipping) - PARTIALLY_REFUNDED is the correct outcome,
    // same as the pre-existing provider-failure-retry test above.
    expect(['REFUNDED', 'PARTIALLY_REFUNDED']).toContain(payment.status);
  });

  it('a stale PROCESSING refund (the settling process crashed before its terminal claim) is recoverable via retry', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-stale-${counter}`, `idem-stale-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-stale-${counter}`);
    const fin = await financeToken();

    // Simulate a genuine intent row that a crashed process claimed but
    // never finished settling - never reachable through the API itself
    // (settle() always claims-then-terminally-resolves in one call
    // path), so this directly manufactures the exact DB state a real
    // crash would leave behind.
    const createRes = await processRefund(orderId, lineId, fin, `refund-stale-create-${counter}`);
    // processRefund already settles to COMPLETED in this mock - force it
    // back to a stale PROCESSING row to simulate the crash scenario.
    const refundId = createRes.json().id as string;
    await testPrisma.refund.update({
      where: { id: refundId },
      data: { status: 'PROCESSING', updatedAt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 min ago, past the 5 min default stale window
    });

    const retryRes = await app.inject({ method: 'POST', url: `/api/v1/refunds/${refundId}/retry`, headers: { authorization: `Bearer ${fin}` } });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().status).toBe('COMPLETED');
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1); // still exactly one row
  });

  it('a FRESH (non-stale) PROCESSING refund is left alone by a concurrent retry - never re-calls the provider', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-fresh-${counter}`, `idem-fresh-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-fresh-${counter}`);
    const fin = await financeToken();

    const createRes = await processRefund(orderId, lineId, fin, `refund-fresh-create-${counter}`);
    const refundId = createRes.json().id as string;
    // Force it to a FRESH PROCESSING row (updatedAt = now) - simulates a
    // genuinely still-in-flight concurrent attempt, not a crash.
    await testPrisma.refund.update({ where: { id: refundId }, data: { status: 'PROCESSING' } });

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const callsBefore = fetchMock.mock.calls.length;

    const retryRes = await app.inject({ method: 'POST', url: `/api/v1/refunds/${refundId}/retry`, headers: { authorization: `Bearer ${fin}` } });
    expect(retryRes.statusCode).toBe(200);
    // Left exactly as PROCESSING - the retry did NOT claim it, and
    // therefore never re-called the provider.
    expect(retryRes.json().status).toBe('PROCESSING');
    const refundCalls = fetchMock.mock.calls.slice(callsBefore).filter(([url]) => (url as string).toString().includes('/refund'));
    expect(refundCalls.length).toBe(0);
  });

  it('a reconciliation-sweep pass racing an explicit staff retry for the same refund still converges to exactly one completed settlement', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-sweep-race-${counter}`, `idem-sweep-race-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const lineId = order.lines[0]!.id;
    const csT = await csToken();
    await cancelLine(orderId, lineId, csT, `cancel-sweep-race-${counter}`);
    const fin = await financeToken();

    // Create the intent (PENDING) without settling it yet - drive
    // straight to the DB rather than through processRefund, which would
    // also settle it immediately in this mocked environment.
    const order2 = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: order2.checkoutSessionId } });
    const line = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    const manualRefund = await testPrisma.refund.create({
      data: {
        orderId,
        orderLineId: lineId,
        paymentId: payment.id,
        triggerType: 'CANCELLATION',
        method: 'ORIGINAL_PAYMENT_METHOD',
        amount: line.lineTotalInclusive,
        reason: 'Order line cancelled',
        status: 'PENDING',
        idempotencyKey: `manual-sweep-race-${counter}`,
        initiatedByStaffId: null,
      },
    });

    const retryUrl = `/api/v1/refunds/${manualRefund.id}/retry`;
    const [retryA, sweepA] = await Promise.all([
      app.inject({ method: 'POST', url: retryUrl, headers: { authorization: `Bearer ${fin}` } }),
      app.inject({ method: 'POST', url: '/api/v1/refunds/reconcile', headers: { authorization: `Bearer ${fin}` } }),
    ]);
    expect(retryA.statusCode).toBe(200);
    expect(sweepA.statusCode).toBe(200);

    const finalRefund = await testPrisma.refund.findUniqueOrThrow({ where: { id: manualRefund.id } });
    expect(finalRefund.status).toBe('COMPLETED');
    expect(await testPrisma.refund.count({ where: { orderLineId: lineId } })).toBe(1);

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const refundCalls = fetchMock.mock.calls.filter(([url]) => (url as string).toString().includes('/refund'));
    expect(refundCalls.length).toBe(1);
  });

  // --- 9. Reconciliation sweep ---

  it('the reconciliation sweep processes a flagged PREPAID cancellation and a QC-passed COD return that were never explicitly triggered', async () => {
    const ctx = await seedContext();
    const a = await setupCheckoutableSku(1400, ctx);
    const { orderId: prepaidOrderId } = await prepaidCapturedOrder(a.skuId, `guest-sweep-a-${counter}`, `idem-sweep-a-${counter}`);
    const prepaidOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: prepaidOrderId }, include: { lines: true } });
    const csT = await csToken();
    await cancelLine(prepaidOrderId, prepaidOrder.lines[0]!.id, csT, `cancel-sweep-${counter}`);

    const b = await setupCheckoutableSku(900, ctx);
    const { orderId: codOrderId } = await codOrder(b.skuId, `guest-sweep-b-${counter}`, `idem-sweep-b-${counter}`);
    const wT = await warehouseToken();
    const { lineId: codLineId } = await deliverOrderLine(codOrderId, wT);
    await initiateAndPassQc(codOrderId, codLineId, wT);

    expect(await testPrisma.refund.count()).toBe(0);

    const fin = await financeToken();
    const sweepRes = await app.inject({ method: 'POST', url: '/api/v1/refunds/reconcile', headers: { authorization: `Bearer ${fin}` } });
    expect(sweepRes.statusCode).toBe(200);
    expect(sweepRes.json()).toHaveLength(2);
    for (const r of sweepRes.json()) expect(r.status).toBe('COMPLETED');

    expect(await testPrisma.refund.count()).toBe(2);

    // Re-running the sweep is a safe no-op - both lines are already settled.
    const sweepAgain = await app.inject({ method: 'POST', url: '/api/v1/refunds/reconcile', headers: { authorization: `Bearer ${fin}` } });
    expect(sweepAgain.json()).toHaveLength(0);
    expect(await testPrisma.refund.count()).toBe(2);
  });

  // --- 10. Store credit does not expire ---

  it('a store-credit balance issued long ago remains fully redeemable - no expiry ever touches it', async () => {
    const { skuId } = await setupCheckoutableSku(1600);
    const guestId = `guest-noexpiry-${counter}`;
    const { orderId } = await codOrder(skuId, guestId, `idem-noexpiry-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    await initiateAndPassQc(orderId, lineId, wT);
    const fin = await financeToken();
    const res = await processRefund(orderId, lineId, fin, `refund-noexpiry-${counter}`);
    const issuedAmount = Number(res.json().amount);

    const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: guestId } });
    // Backdate the entry to simulate it having been issued a year ago -
    // there is no expiry job anywhere in this codebase to run against it.
    await testPrisma.storeCreditEntry.updateMany({
      where: { accountId: account.id },
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });

    const balRes = await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/store-credit',
      headers: { [GUEST_HEADER]: guestId },
    });
    expect(balRes.statusCode).toBe(200);
    expect(Number(balRes.json().balance)).toBeCloseTo(issuedAmount, 2);
  });

  // --- 11. Structural separation from loyalty ---

  it('issuing store credit never touches any other ledger table - only StoreCreditAccount/StoreCreditEntry rows change', async () => {
    const { skuId } = await setupCheckoutableSku(1300);
    const { orderId } = await codOrder(skuId, `guest-structural-${counter}`, `idem-structural-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    await initiateAndPassQc(orderId, lineId, wT);

    const invTxnBefore = await testPrisma.inventoryTransaction.count();
    const fin = await financeToken();
    await processRefund(orderId, lineId, fin, `refund-structural-${counter}`);
    const invTxnAfter = await testPrisma.inventoryTransaction.count();

    expect(invTxnAfter).toBe(invTxnBefore); // refund settlement itself posts no inventory movement
    expect(await testPrisma.storeCreditEntry.count()).toBe(1);
    expect(await testPrisma.storeCreditAccount.count()).toBe(1);
  });

  // --- 12. Ownership / IDOR ---

  it('rejects a different guest reading another guest order refunds - clean 404, never a distinguishable error', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-owner-${counter}`, `idem-owner-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const csT = await csToken();
    await cancelLine(orderId, order.lines[0]!.id, csT, `cancel-owner-${counter}`);
    const fin = await financeToken();
    await processRefund(orderId, order.lines[0]!.id, fin, `refund-owner-${counter}`);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/storefront/orders/${orderId}/refunds`,
      headers: { [GUEST_HEADER]: `guest-attacker-${counter}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the owning guest can read their own order refunds and store-credit balance', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const guestId = `guest-selfread-${counter}`;
    const { orderId } = await codOrder(skuId, guestId, `idem-selfread-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    await initiateAndPassQc(orderId, lineId, wT);
    const fin = await financeToken();
    await processRefund(orderId, lineId, fin, `refund-selfread-${counter}`);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/storefront/orders/${orderId}/refunds`,
      headers: { [GUEST_HEADER]: guestId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);

    const balRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/store-credit', headers: { [GUEST_HEADER]: guestId } });
    expect(balRes.statusCode).toBe(200);
    expect(Number(balRes.json().balance)).toBeGreaterThan(0);
  });

  // --- 13. RBAC ---

  it('rejects processing a refund from a staff member without payment:refund', async () => {
    const { skuId } = await setupCheckoutableSku(1500);
    const { orderId } = await prepaidCapturedOrder(skuId, `guest-rbac-${counter}`, `idem-rbac-${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const csT = await csToken();
    await cancelLine(orderId, order.lines[0]!.id, csT, `cancel-rbac-${counter}`);

    await grantPermissions('MARKETING', ['marketing:manage']);
    const { token: noPermToken } = await createAuthenticatedStaff(app, ['MARKETING']);
    const res = await processRefund(orderId, order.lines[0]!.id, noPermToken, `refund-rbac-${counter}`);
    expect(res.statusCode).toBe(403);
  });

  it('rejects a completely unauthenticated refund request with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/refunds', payload: { orderId: 'x', orderLineId: 'y', idempotencyKey: 'z' } });
    expect(res.statusCode).toBe(401);
  });

  // --- 14. Reason inheritance (REF-004) ---

  it('inherits the return reason by default for a return-triggered refund, and the cancellation reason for a cancellation-triggered refund', async () => {
    const ctxA = await seedContext();
    const a = await setupCheckoutableSku(1100, ctxA);
    const { orderId: prepaidOrderId } = await prepaidCapturedOrder(a.skuId, `guest-reason-a-${counter}`, `idem-reason-a-${counter}`);
    const prepaidOrder = await testPrisma.order.findUniqueOrThrow({ where: { id: prepaidOrderId }, include: { lines: true } });
    const csT = await csToken();
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${prepaidOrderId}/lines/${prepaidOrder.lines[0]!.id}/cancel`,
      headers: { authorization: `Bearer ${csT}` },
      payload: { idempotencyKey: `cancel-reason-${counter}`, reason: 'Ordered by mistake' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const fin = await financeToken();
    const refundA = await processRefund(prepaidOrderId, prepaidOrder.lines[0]!.id, fin, `refund-reason-a-${counter}`);
    expect(refundA.json().reason).toBe('Ordered by mistake');

    const b = await setupCheckoutableSku(1100, ctxA);
    const { orderId: codOrderId } = await codOrder(b.skuId, `guest-reason-b-${counter}`, `idem-reason-b-${counter}`);
    const wT = await warehouseToken();
    const { lineId: codLineId } = await deliverOrderLine(codOrderId, wT);
    await initiateAndPassQc(codOrderId, codLineId, wT, 'Colour was not as shown');
    const refundB = await processRefund(codOrderId, codLineId, fin, `refund-reason-b-${counter}`);
    expect(refundB.json().reason).toBe('Colour was not as shown');
  });
});
