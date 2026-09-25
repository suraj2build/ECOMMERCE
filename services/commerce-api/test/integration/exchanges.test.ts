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
const SERVICEABLE_PINCODE = '110003';

function signWebhook(rawBody: string): string {
  return createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
}
function capturedEvent(orderId: string, paymentEntityId: string) {
  return { id: `evt_${paymentEntityId}_captured`, event: 'payment.captured', payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } } };
}
function failedEvent(orderId: string, paymentEntityId: string) {
  return { id: `evt_${paymentEntityId}_failed`, event: 'payment.failed', payload: { payment: { entity: { id: paymentEntityId, order_id: orderId } } } };
}

/**
 * Exchanges (M21, specs/20-exchanges.md, EXC-001-003; `EXC-004` in
 * blueprint/DECISION_REGISTER.md) adversarial certification. Covers:
 * both size and colour exchange, replacement-SKU availability/
 * reservation (INV-002), price-difference settlement branching
 * (CUSTOMER_PAYS via a separate Razorpay webhook path / STORE_CREDIT
 * post-QC / EVEN), the two explicit inventory ledger transactions
 * (release original + reserve/allocate replacement), QC-FAIL leaving the
 * exchange for human review, replacement-reservation loss ->
 * REPLACEMENT_UNAVAILABLE, idempotency (initiation, payment webhook,
 * store credit), ownership/IDOR, RBAC, and M00-M20 regression via the
 * shared PaymentService webhook dispatcher.
 */
describe('Exchanges (M21)', () => {
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
          return new Response(JSON.stringify({ id: `order_mock_${counter}_${Math.random().toString(36).slice(2, 6)}` }), { status: 200 });
        }
        if (href.includes('/payments/') && href.endsWith('/refund')) {
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
  async function warehouseToken(
    perms: string[] = [
      'order:read',
      'order:fulfil',
      'warehouse:read',
      'warehouse:pick',
      'warehouse:pack',
      'exchange:read',
      'exchange:initiate',
      'exchange:receive',
      'exchange:qc',
      'return:read',
      'return:initiate',
    ],
  ) {
    await grantPermissions('WAREHOUSE_MANAGER', perms);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Exchanges Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLEXCTST${counter}A1Z${counter % 10}`,
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

  /**
   * One style, two colours (Black/White) x two sizes (seeded M + a
   * second size) = 4 SKUs, letting a single fixture support both a
   * size-exchange pair (same colour, different size) and a
   * colour-exchange pair (same size, different colour) - EXC's own
   * "both size AND colour exchange" requirement.
   */
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
      payload: { styleCode: `EXC-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, name: 'Exchange Test Hoodie', brandId: seeded.brandId, categoryId: seeded.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = styleRes.json().id as string;

    const blackRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'Black', colourCode: 'BLK' } });
    const blackId = blackRes.json().id as string;
    const whiteRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'White', colourCode: 'WHT' } });
    const whiteId = whiteRes.json().id as string;

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${token}` }, payload: { sizeIds: [seeded.sizeId, seeded.secondSizeId] } });

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId: blackId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });

    const blackM = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: seeded.sizeId } });
    const blackL = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: seeded.secondSizeId } });
    const whiteM = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: whiteId, sizeId: seeded.sizeId } });

    for (const sku of [blackM, blackL, whiteM]) {
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: seeded.locationId, onHand: 10, reserved: 0 } });
    }

    return { styleId, locationId: seeded.locationId, blackM, blackL, whiteM };
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
  async function prepaidCapturedOrder(skuId: string, guestId: string, idempotencyKey: string) {
    const headers = { [GUEST_HEADER]: guestId };
    await addToCart(skuId, headers);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: { contactName: 'Jane Doe', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'PREPAID', idempotencyKey },
    });
    expect(res.statusCode).toBe(201);
    const sessionId = res.json().id as string;
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
    const body = JSON.stringify(capturedEvent(payment.providerReferenceId!, `pay_${idempotencyKey}`));
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) }, payload: body });
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
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

  function initiateExchange(orderId: string, orderLineId: string, replacementSkuId: string, token: string, idempotencyKey: string, reason = 'Wrong fit') {
    return app.inject({
      method: 'POST',
      url: '/api/v1/exchanges',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId, orderLineId, replacementSkuId, reason, method: 'DROP_OFF', idempotencyKey },
    });
  }
  async function receiveAndQc(exchangeId: string, token: string, qcResult: 'PASS' | 'FAIL' = 'PASS') {
    const receiveRes = await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchangeId}/receive`, headers: { authorization: `Bearer ${token}` } });
    expect(receiveRes.statusCode).toBe(200);
    const qcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/exchanges/${exchangeId}/qc`,
      headers: { authorization: `Bearer ${token}` },
      payload: { qcResult, disposition: qcResult === 'PASS' ? 'RESTOCK_SELLABLE' : 'WRITE_OFF' },
    });
    expect(qcRes.statusCode).toBe(200);
    return qcRes.json();
  }

  // --- 1. Size exchange, EVEN price - straight-through happy path ---

  it('completes a same-price size exchange end to end: two explicit ledger transactions, no payment/credit needed', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-size-${counter}`, `idem-size-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const res = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-size-${counter}`);
    expect(res.statusCode).toBe(201);
    const exchange = res.json();
    expect(exchange.paymentDirection).toBe('EVEN');
    expect(exchange.status).toBe('REQUESTED');
    expect(exchange.replacementReservationId).toBeTruthy();

    const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: exchange.replacementReservationId } });
    expect(reservation.skuId).toBe(fixture.blackL.id);
    expect(reservation.status).toBe('ACTIVE');

    const completed = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.replacementAllocatedAt).toBeTruthy();

    // Explicit ledger transactions: RETURN_RECEIVED+RETURN_QC_PASS for
    // the original, RESERVATION+ALLOCATION for the replacement - never a
    // silent net-zero adjustment.
    const originalTxns = await testPrisma.inventoryTransaction.findMany({ where: { skuId: fixture.blackM.id, referenceType: 'EXCHANGE', referenceId: exchange.id } });
    expect(originalTxns.map((t) => t.type).sort()).toEqual(['RETURN_QC_PASS', 'RETURN_RECEIVED']);
    const replacementReservationTxn = await testPrisma.inventoryTransaction.findFirst({ where: { skuId: fixture.blackL.id, type: 'RESERVATION' } });
    expect(replacementReservationTxn).toBeTruthy();
    const replacementAllocationTxn = await testPrisma.inventoryTransaction.findFirst({ where: { skuId: fixture.blackL.id, type: 'ALLOCATION' } });
    expect(replacementAllocationTxn).toBeTruthy();

    const reservationAfter = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: exchange.replacementReservationId } });
    expect(reservationAfter.status).toBe('CONVERTED');
  });

  // --- 2. Colour exchange ---

  it('supports colour exchange (same size, different colour), the same mechanism as size exchange', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-colour-${counter}`, `idem-colour-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const res = await initiateExchange(orderId, lineId, fixture.whiteM.id, wT, `exc-colour-${counter}`);
    expect(res.statusCode).toBe(201);
    const exchange = res.json();
    expect(exchange.originalSkuId).toBe(fixture.blackM.id);
    expect(exchange.replacementSkuId).toBe(fixture.whiteM.id);

    const completed = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(completed.status).toBe('COMPLETED');
  });

  // --- 3. CUSTOMER_PAYS: replacement costs more ---

  it('collects the price difference online when the replacement costs more, completing once BOTH payment and QC settle (QC first, then payment)', async () => {
    const ctx = await seedContext();
    const cheap = await setupExchangeableStyle(1000, ctx);
    const pricey = await setupExchangeableStyle(1800, ctx);
    const { orderId } = await prepaidCapturedOrder(cheap.blackM.id, `guest-pay-${counter}`, `idem-pay-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const res = await initiateExchange(orderId, lineId, pricey.blackM.id, wT, `exc-pay-${counter}`);
    expect(res.statusCode).toBe(201);
    const exchange = res.json();
    expect(exchange.paymentDirection).toBe('CUSTOMER_PAYS');
    expect(Number(exchange.priceDifference)).toBeGreaterThan(0);
    expect(exchange.paymentStatus).toBe('PENDING');

    // QC passes first - completion must still wait for payment.
    const afterQc = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(afterQc.status).toBe('RECEIVED');
    expect(afterQc.replacementAllocatedAt).toBeNull();

    const payRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/pay`, headers: { [GUEST_HEADER]: `guest-pay-${counter}` } });
    expect(payRes.statusCode).toBe(200);
    const { providerOrderId } = payRes.json();

    const body = JSON.stringify(capturedEvent(providerOrderId, `pay_exc_${counter}`));
    const webhookRes = await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) }, payload: body });
    expect(webhookRes.statusCode).toBe(200);

    const final = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(final.status).toBe('COMPLETED');
    expect(final.paymentStatus).toBe('CAPTURED');
    expect(final.replacementAllocatedAt).toBeTruthy();

    // This webhook event never touched any checkout-session Payment row.
    const paymentEvent = await testPrisma.paymentEvent.findFirstOrThrow({ where: { exchangeId: exchange.id } });
    expect(paymentEvent.paymentId).toBeNull();
  });

  it('completes once payment is captured BEFORE QC too - order of arrival must not matter', async () => {
    const ctx = await seedContext();
    const cheap = await setupExchangeableStyle(1000, ctx);
    const pricey = await setupExchangeableStyle(1800, ctx);
    const { orderId } = await prepaidCapturedOrder(cheap.blackM.id, `guest-payfirst-${counter}`, `idem-payfirst-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, pricey.blackM.id, wT, `exc-payfirst-${counter}`)).json();

    const payRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/pay`, headers: { [GUEST_HEADER]: `guest-payfirst-${counter}` } });
    const { providerOrderId } = payRes.json();
    const body = JSON.stringify(capturedEvent(providerOrderId, `pay_pf_${counter}`));
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(body) }, payload: body });

    const afterPayment = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(afterPayment.status).toBe('REQUESTED'); // still waiting on QC
    expect(afterPayment.paymentStatus).toBe('CAPTURED');

    const completed = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(completed.status).toBe('COMPLETED');
  });

  // --- 4. Negative scenario #3: payment fails, exchange doesn't complete silently, retry works ---

  it('a failed price-difference payment does not complete the exchange silently, and the customer can retry without re-initiating', async () => {
    const ctx = await seedContext();
    const cheap = await setupExchangeableStyle(1000, ctx);
    const pricey = await setupExchangeableStyle(1800, ctx);
    const { orderId } = await prepaidCapturedOrder(cheap.blackM.id, `guest-payfail-${counter}`, `idem-payfail-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, pricey.blackM.id, wT, `exc-payfail-${counter}`)).json();
    await receiveAndQc(exchange.id, wT, 'PASS');

    const payRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/pay`, headers: { [GUEST_HEADER]: `guest-payfail-${counter}` } });
    const { providerOrderId } = payRes.json();
    const failBody = JSON.stringify(failedEvent(providerOrderId, `pay_failfirst_${counter}`));
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(failBody) }, payload: failBody });

    const afterFail = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(afterFail.status).not.toBe('COMPLETED');
    expect(afterFail.paymentStatus).toBe('FAILED');

    // Retry: initiating payment again re-uses the SAME Razorpay order
    // (same providerOrderId already stored) - no second Exchange, no
    // re-initiation of the exchange itself.
    const retryPayRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/pay`, headers: { [GUEST_HEADER]: `guest-payfail-${counter}` } });
    expect(retryPayRes.statusCode).toBe(200);
    expect(retryPayRes.json().providerOrderId).toBe(providerOrderId);

    const captureBody = JSON.stringify(capturedEvent(providerOrderId, `pay_retry_${counter}`));
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signWebhook(captureBody) }, payload: captureBody });
    const final = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(final.status).toBe('COMPLETED');
    expect(await testPrisma.exchange.count({ where: { orderLineId: lineId } })).toBe(1);
  });

  // --- 5. STORE_CREDIT: replacement costs less ---

  it('issues store credit for the price difference when the replacement costs less, only after QC passes', async () => {
    const ctx = await seedContext();
    const pricey = await setupExchangeableStyle(2000, ctx);
    const cheap = await setupExchangeableStyle(1200, ctx);
    const guestId = `guest-credit-${counter}`;
    const { orderId } = await codOrder(pricey.blackM.id, guestId, `idem-credit-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, cheap.blackM.id, wT, `exc-credit-${counter}`)).json();
    expect(exchange.paymentDirection).toBe('STORE_CREDIT');
    expect(Number(exchange.priceDifference)).toBeLessThan(0);
    expect(exchange.paymentStatus).toBe('NOT_REQUIRED');

    expect(await testPrisma.storeCreditEntry.count()).toBe(0); // not yet, QC hasn't happened

    const completed = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.storeCreditEntryId).toBeTruthy();

    const account = await testPrisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: guestId } });
    expect(Number(account.balance)).toBeCloseTo(Math.abs(Number(exchange.priceDifference)), 2);
    expect(await testPrisma.storeCreditEntry.count()).toBe(1);
  });

  // --- 6. Negative scenario #1: replacement out of stock ---

  it('rejects initiation immediately when the replacement SKU is out of stock, never silently accepted then failed later', async () => {
    const fixture = await setupExchangeableStyle(1500);
    await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId: fixture.blackL.id, locationId: fixture.locationId } }, data: { onHand: 0 } });

    const { orderId } = await codOrder(fixture.blackM.id, `guest-oos-${counter}`, `idem-oos-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const res = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-oos-${counter}`);
    expect(res.statusCode).toBe(409); // InsufficientStockError (INV-002)
    expect(await testPrisma.exchange.count()).toBe(0);
  });

  // --- 7. QC FAIL leaves the exchange for human review ---

  it('a QC-FAIL on the original leaves the exchange QC_FAILED - disposition still posts, replacement never allocated', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-qcfail-${counter}`, `idem-qcfail-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-qcfail-${counter}`)).json();

    const result = await receiveAndQc(exchange.id, wT, 'FAIL');
    expect(result.status).toBe('QC_FAILED');
    expect(result.replacementAllocatedAt).toBeNull();

    const dispositionTxn = await testPrisma.inventoryTransaction.findFirst({ where: { skuId: fixture.blackM.id, referenceType: 'EXCHANGE', referenceId: exchange.id, type: 'RETURN_DISPOSED' } });
    expect(dispositionTxn).toBeTruthy();

    const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: exchange.replacementReservationId } });
    expect(reservation.status).toBe('ACTIVE'); // never converted
  });

  // --- 8. Negative scenario #2: replacement reservation lost before receipt ---

  it('transitions to REPLACEMENT_UNAVAILABLE (never silently) when the held reservation was lost before the original came back', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-unavail-${counter}`, `idem-unavail-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-unavail-${counter}`)).json();

    // Simulate the reservation being genuinely lost (expired sweep, or a
    // manual release) before the original item was received.
    await testPrisma.inventoryReservation.update({ where: { id: exchange.replacementReservationId }, data: { status: 'EXPIRED' } });

    const result = await receiveAndQc(exchange.id, wT, 'PASS');
    expect(result.status).toBe('REPLACEMENT_UNAVAILABLE');

    const auditRow = await testPrisma.auditLog.findFirst({ where: { entityType: 'Exchange', entityId: exchange.id, action: 'exchange.replacement.unavailable' } });
    expect(auditRow).toBeTruthy(); // durably recorded, never silently lost
  });

  // --- 9. Idempotency ---

  it('a retried initiation with the same idempotency key is a safe no-op - never double-reserves', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-idem-${counter}`, `idem-idem-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const key = `exc-dup-${counter}`;
    const first = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, key);
    const second = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, key);
    expect(first.json().id).toBe(second.json().id);
    expect(await testPrisma.exchange.count({ where: { orderLineId: lineId } })).toBe(1);
    expect(await testPrisma.inventoryReservation.count({ where: { skuId: fixture.blackL.id } })).toBe(1);
  });

  it('duplicate payment-capture webhook events are a safe no-op - never double-completes or double-allocates', async () => {
    const ctx = await seedContext();
    const cheap = await setupExchangeableStyle(1000, ctx);
    const pricey = await setupExchangeableStyle(1800, ctx);
    const { orderId } = await prepaidCapturedOrder(cheap.blackM.id, `guest-dupwh-${counter}`, `idem-dupwh-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, pricey.blackM.id, wT, `exc-dupwh-${counter}`)).json();
    await receiveAndQc(exchange.id, wT, 'PASS');

    const payRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/pay`, headers: { [GUEST_HEADER]: `guest-dupwh-${counter}` } });
    const { providerOrderId } = payRes.json();
    const body = JSON.stringify(capturedEvent(providerOrderId, `pay_dupwh_${counter}`));
    const sig = signWebhook(body);

    const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: body });
    const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: body });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const allocationTxns = await testPrisma.inventoryTransaction.findMany({ where: { skuId: pricey.blackM.id, type: 'ALLOCATION' } });
    expect(allocationTxns).toHaveLength(1);
  });

  // --- 10. Ownership / IDOR ---

  it('rejects a different guest reading or cancelling another guest exchange - clean 404', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const guestId = `guest-owner-${counter}`;
    const { orderId } = await codOrder(fixture.blackM.id, guestId, `idem-owner-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-owner-${counter}`)).json();

    const readRes = await app.inject({ method: 'GET', url: `/api/v1/storefront/exchanges/${exchange.id}`, headers: { [GUEST_HEADER]: `guest-attacker-${counter}` } });
    expect(readRes.statusCode).toBe(404);
    const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/cancel`, headers: { [GUEST_HEADER]: `guest-attacker-${counter}` } });
    expect(cancelRes.statusCode).toBe(404);
  });

  it('the owning guest can read and cancel their own exchange, releasing the replacement reservation', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const guestId = `guest-selfcancel-${counter}`;
    const { orderId } = await codOrder(fixture.blackM.id, guestId, `idem-selfcancel-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const exchange = (await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-selfcancel-${counter}`)).json();

    const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/storefront/exchanges/${exchange.id}/cancel`, headers: { [GUEST_HEADER]: guestId }, payload: { reason: 'Changed my mind' } });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('CANCELLED');

    const reservation = await testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: exchange.replacementReservationId } });
    expect(reservation.status).toBe('RELEASED');
  });

  // --- 11. RBAC ---

  it('rejects initiating an exchange from a staff member without exchange:initiate', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-rbac-${counter}`, `idem-rbac-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    await grantPermissions('MARKETING', ['marketing:manage']);
    const { token: noPermToken } = await createAuthenticatedStaff(app, ['MARKETING']);
    const res = await initiateExchange(orderId, lineId, fixture.blackL.id, noPermToken, `exc-rbac-${counter}`);
    expect(res.statusCode).toBe(403);
  });

  it('rejects a completely unauthenticated exchange initiation with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/exchanges', payload: { orderId: 'x', orderLineId: 'y', replacementSkuId: 'z', reason: 'r', method: 'DROP_OFF', idempotencyKey: 'k' } });
    expect(res.statusCode).toBe(401);
  });

  // --- 12. Eligibility window reuse (EXC-003) ---

  it('rejects an exchange for a line outside the return/exchange window (RET-001, shared with returns)', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-window-${counter}`, `idem-window-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const fulfilment = await testPrisma.orderFulfilment.findFirstOrThrow({ where: { lines: { some: { id: lineId } } } });
    await testPrisma.orderFulfilment.update({ where: { id: fulfilment.id }, data: { deliveredAt: new Date(Date.now() - 30 * 86_400_000) } });

    const res = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-window-${counter}`);
    expect(res.statusCode).toBe(400);
  });

  // --- 13. Cannot exchange for the identical SKU ---

  it('rejects a replacement SKU identical to the original', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-same-${counter}`, `idem-same-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);
    const res = await initiateExchange(orderId, lineId, fixture.blackM.id, wT, `exc-same-${counter}`);
    expect(res.statusCode).toBe(400);
  });

  // --- 14. Cross-domain: Return and Exchange are mutually exclusive per line ---

  it('rejects initiating an exchange for a line that already has an active return, but allows it after the return is cancelled', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-crossdomain-a-${counter}`, `idem-crossdomain-a-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const returnRes = await app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${wT}` },
      payload: { orderId, lines: [{ orderLineId: lineId, reason: 'Wrong colour' }], method: 'DROP_OFF', idempotencyKey: `ret-crossdomain-${counter}` },
    });
    expect(returnRes.statusCode).toBe(201);
    const returnId = returnRes.json().id as string;

    const blockedRes = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-crossdomain-blocked-${counter}`);
    expect(blockedRes.statusCode).toBe(409);

    await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/cancel`, headers: { authorization: `Bearer ${wT}` } });

    const allowedRes = await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-crossdomain-allowed-${counter}`);
    expect(allowedRes.statusCode).toBe(201);
  });

  it('rejects initiating a return for a line that already has an active exchange, but allows it after the exchange is cancelled', async () => {
    const fixture = await setupExchangeableStyle(1500);
    const { orderId } = await codOrder(fixture.blackM.id, `guest-crossdomain-b-${counter}`, `idem-crossdomain-b-${counter}`);
    const wT = await warehouseToken();
    const { lineId } = await deliverOrderLine(orderId, wT);

    const exchange = (await initiateExchange(orderId, lineId, fixture.blackL.id, wT, `exc-crossdomain-b-${counter}`)).json();

    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${wT}` },
      payload: { orderId, lines: [{ orderLineId: lineId, reason: 'Wrong colour' }], method: 'DROP_OFF', idempotencyKey: `ret-crossdomain-blocked-${counter}` },
    });
    expect(blockedRes.statusCode).toBe(409);

    await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchange.id}/cancel`, headers: { authorization: `Bearer ${wT}` } });

    const allowedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      headers: { authorization: `Bearer ${wT}` },
      payload: { orderId, lines: [{ orderLineId: lineId, reason: 'Wrong colour' }], method: 'DROP_OFF', idempotencyKey: `ret-crossdomain-allowed-${counter}` },
    });
    expect(allowedRes.statusCode).toBe(201);
  });
});
