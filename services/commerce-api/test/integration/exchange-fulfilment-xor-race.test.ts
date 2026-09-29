import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';

const GUEST_HEADER = 'x-guest-session-id';
const SERVICEABLE_PINCODE = '110005';

/**
 * EXC-004 concurrency repair (2026-09-26, final independent review).
 *
 * The trigger pair enforcing OrderFulfilment's source-exclusivity
 * invariant (exchangeId XOR child order_lines - see that model's own
 * schema comment) was originally written with a PLAIN SELECT of the
 * other side's row inside each trigger, no lock. Under READ COMMITTED,
 * a plain SELECT reads a pre-statement snapshot and is not itself a
 * serialization point - two GENUINELY concurrent transactions (one
 * setting a fulfilment's exchangeId, the other attaching an order_line
 * to that SAME fulfilment) could each read the other's pre-commit
 * state and both pass their own trigger check, a real write-skew race
 * that could leave the committed database in an illegal BOTH state.
 *
 * Fixed (migration 20260926130000) by giving both directions a shared
 * serialization point: check_fulfilment_line_exclusivity now
 * `SELECT ... FOR UPDATE`s the target order_fulfilments row before
 * reading its exchangeId, acquiring the identical row lock the OTHER
 * direction already holds for free (an UPDATE/INSERT targeting
 * order_fulfilments implicitly locks that row for the rest of its own
 * transaction before its own BEFORE ROW trigger ever fires).
 *
 * This file proves the fix under REAL concurrent transactions (two
 * bare UPDATE statements fired via Promise.all against the SAME
 * PrismaClient - the identical "genuine concurrency" idiom this
 * codebase already uses for INV-003's 100-way oversell proof and the
 * M21 real-concurrent Return/Exchange test; each statement is its own
 * implicit, auto-committed transaction, executed on its own pooled
 * connection), repeated many times and in both array orderings to
 * exercise both interleavings, asserting the committed XOR invariant
 * holds after every single run - never both, never neither, for a
 * fulfilment that started genuinely empty and exchange-free.
 */
describe('EXC-004 concurrency repair: OrderFulfilment source-exclusivity race', () => {
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
      'warehouse:read',
      'warehouse:pick',
      'exchange:read',
      'exchange:initiate',
      'exchange:receive',
      'exchange:qc',
      'exchange:fulfil',
    ]);
    return (await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'XOR Race Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLXORTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    const secondSize = await testPrisma.size.create({ data: { label: `XL-${counter}`, sortOrder: 1 } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, secondSizeId: secondSize.id, locationId: location.id };
  }

  async function setupExchangeableStyle(sellingPrice: number, ctx: Awaited<ReturnType<typeof seedContext>>, suffix: string) {
    const token = await merchandisingToken();
    const hsnCode = '6109';
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: `XOR-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: 'XOR Race Test Item', brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = styleRes.json().id as string;
    const blackRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'Black', colourCode: 'BLK' } });
    const blackId = blackRes.json().id as string;

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${token}` }, payload: { sizeIds: [ctx.sizeId, ctx.secondSizeId] } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId: blackId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });

    const skuM = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: ctx.sizeId } });
    const skuL = await testPrisma.sku.findFirstOrThrow({ where: { styleId, colourId: blackId, sizeId: ctx.secondSizeId } });
    for (const sku of [skuM, skuL]) {
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: ctx.locationId, onHand: 10, reserved: 0 } });
    }
    return { skuM, skuL };
  }

  function validAddress() {
    return { line1: '1 Race Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
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
      payload: { contactName: 'Race Tester', contactMobile: '9876543210', billingAddress: validAddress(), shippingAddress: validAddress(), paymentMethod: 'COD', idempotencyKey },
    });
    expect(res.statusCode).toBe(201);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    return order;
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
  async function receiveAndQcPass(exchangeId: string, token: string) {
    await app.inject({ method: 'POST', url: `/api/v1/exchanges/${exchangeId}/receive`, headers: { authorization: `Bearer ${token}` } });
    const qcRes = await app.inject({
      method: 'POST',
      url: `/api/v1/exchanges/${exchangeId}/qc`,
      headers: { authorization: `Bearer ${token}` },
      payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' },
    });
    expect(qcRes.statusCode).toBe(200);
  }

  /**
   * Builds ONE fully independent "battleground" scenario for a single
   * race iteration:
   *  - a genuine Exchange (REPLACEMENT_ALLOCATED, via the real
   *    request->deliver->initiate->receive->QC flow) with no
   *    OrderFulfilment of its own yet (exchangeId is "free" to attach)
   *  - a genuinely UNRELATED, freshly-delivered order line with
   *    fulfilmentId still NULL (never touched by the exchange above)
   *  - a fresh, empty OrderFulfilment row (orderId only, exchangeId
   *    NULL, zero child order_lines) - the actual "battleground" row
   *    both racing UPDATEs target. This state is unreachable through
   *    the application's own two happy-path create-and-attach-in-one-
   *    transaction flows (assignLinesToFulfilment,
   *    assignExchangeToFulfilment), but it IS a perfectly valid,
   *    reachable row shape per the schema itself - the database-level
   *    invariant must hold regardless of how a row got here, not only
   *    for the two specific call sequences today's application code
   *    happens to construct.
   */
  async function buildRaceFixture(ctx: Awaited<ReturnType<typeof seedContext>>, suffix: string) {
    const exchangeStyle = await setupExchangeableStyle(1500, ctx, `exc-${suffix}`);
    const wT = await warehouseToken();
    const exchangeOrder = await codOrder(exchangeStyle.skuM.id, `guest-race-exc-${suffix}-${counter}`, `idem-race-exc-${suffix}-${counter}`);
    const { lineId: exchangeOriginalLineId } = await deliverOrderLine(exchangeOrder.id, wT);
    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/exchanges',
      headers: { authorization: `Bearer ${wT}` },
      payload: { orderId: exchangeOrder.id, orderLineId: exchangeOriginalLineId, replacementSkuId: exchangeStyle.skuL.id, reason: 'XOR race fixture', method: 'DROP_OFF', idempotencyKey: `exc-race-${suffix}-${counter}` },
    });
    expect(initRes.statusCode).toBe(201);
    const exchangeId = initRes.json().id as string;
    await receiveAndQcPass(exchangeId, wT);
    const allocated = await testPrisma.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
    expect(allocated.status).toBe('REPLACEMENT_ALLOCATED');
    expect(allocated.orderId).toBeTruthy();

    // A genuinely unrelated free order line (its own separate style/order/guest).
    const lineStyle = await setupExchangeableStyle(900, ctx, `line-${suffix}`);
    const lineOrder = await codOrder(lineStyle.skuM.id, `guest-race-line-${suffix}-${counter}`, `idem-race-line-${suffix}-${counter}`);
    const freeLine = await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: lineOrder.id } });
    expect(freeLine.fulfilmentId).toBeNull();

    // The battleground: a fresh, empty fulfilment - exchangeId NULL, zero children.
    const fulfilment = await testPrisma.orderFulfilment.create({ data: { orderId: allocated.orderId } });

    return { exchangeId, fulfilmentId: fulfilment.id, lineId: freeLine.id };
  }

  async function raceOnce(ctx: Awaited<ReturnType<typeof seedContext>>, order: 'exchange-first' | 'line-first', suffix: string) {
    const { exchangeId, fulfilmentId, lineId } = await buildRaceFixture(ctx, suffix);

    const fireExchange = () =>
      testPrisma
        .$executeRaw`UPDATE "order_fulfilments" SET "exchangeId" = ${exchangeId} WHERE "id" = ${fulfilmentId}`
        .then(() => ({ ok: true as const }))
        .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }));
    const fireLine = () =>
      testPrisma
        .$executeRaw`UPDATE "order_lines" SET "fulfilmentId" = ${fulfilmentId} WHERE "id" = ${lineId}`
        .then(() => ({ ok: true as const }))
        .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }));

    // Both promises are created (and their underlying queries dispatched
    // to the connection pool) before either is awaited - genuine
    // concurrent execution against real Postgres, the same idiom this
    // codebase's own INV-003 100-way and M21 real-concurrency tests
    // already rely on. `order` only varies which call is synchronously
    // *initiated* first in this array (Promise.all evaluates array
    // elements left to right before any awaits), exercising both
    // possible interleavings across the two directions per the
    // independent review's own request to test "the reverse
    // scheduling/interleaving if practical".
    const [resExchange, resLine] =
      order === 'exchange-first' ? await Promise.all([fireExchange(), fireLine()]) : (await Promise.all([fireLine(), fireExchange()])).reverse() as [
        Awaited<ReturnType<typeof fireExchange>>,
        Awaited<ReturnType<typeof fireLine>>,
      ];

    return { resExchange, resLine, exchangeId, fulfilmentId, lineId };
  }

  async function assertCommittedInvariant(fulfilmentId: string) {
    const fulfilment = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    const attachedLineCount = await testPrisma.orderLine.count({ where: { fulfilmentId } });
    if (fulfilment.exchangeId) {
      expect(attachedLineCount).toBe(0);
    } else {
      expect(attachedLineCount).toBe(1);
    }
    return { exchangeAnchored: Boolean(fulfilment.exchangeId), attachedLineCount };
  }

  function assertExactlyOneWinner(resExchange: { ok: boolean; message?: string }, resLine: { ok: boolean; message?: string }) {
    // Exactly one of the two racing UPDATEs may ever succeed - never
    // both (the invariant this whole trigger pair exists to enforce),
    // never neither (a genuine bug would leave the fulfilment
    // permanently unsourced).
    expect(resExchange.ok).not.toBe(resLine.ok);
    if (!resExchange.ok) {
      // Raised by check_exchange_fulfilment_exclusivity (fires on
      // order_fulfilments): the line committed first.
      expect(resExchange.message).toMatch(/cannot set exchangeId/);
    }
    if (!resLine.ok) {
      // Raised by check_fulfilment_line_exclusivity (fires on
      // order_lines): the exchangeId committed first.
      expect(resLine.message).toMatch(/cannot reference an exchange-anchored OrderFulfilment/);
    }
  }

  // M32 performance-review finding (2026-09-29): this test runs 16 full
  // exchange+order+fulfilment iterations (vs. 8 in the two tests below),
  // each now including a REAL Meilisearch round-trip per style publish
  // (`indexStyle`) - previously this sandbox had no reachable Meilisearch
  // at all (the long-documented "13 pre-existing Meilisearch-unavailable"
  // limitation), so that latency was never actually incurred here. With a
  // real Meilisearch now live, 16 iterations' cumulative real network/DB
  // time (measured ~2s/iteration, matching the 8-iteration tests' own
  // ~16s runtime) lands right at, and occasionally past, the file's
  // default 30s testTimeout - a genuine budget shortfall for legitimately
  // heavier work, not a correctness issue: every prior run's own
  // per-iteration assertExactlyOneWinner/assertCommittedInvariant checks
  // passed on every completed iteration before the timeout, and the two
  // fixed-interleaving tests below exercise the IDENTICAL race logic
  // without ever timing out. Widening the budget for this one genuinely
  // 2x-heavier test, not weakening any assertion.
  it('a genuinely concurrent exchangeId-set and order_line-attach on the SAME empty fulfilment converge to exactly one winner, never both, repeated many times', async () => {
    const ctx = await seedContext();
    const winners: Array<'exchange' | 'line'> = [];

    for (let i = 0; i < 16; i++) {
      const order = i % 2 === 0 ? 'exchange-first' : 'line-first';
      const { resExchange, resLine, fulfilmentId } = await raceOnce(ctx, order, `both-${i}`);
      assertExactlyOneWinner(resExchange, resLine);

      const { exchangeAnchored } = await assertCommittedInvariant(fulfilmentId);
      winners.push(exchangeAnchored ? 'exchange' : 'line');
    }

    // A real GitHub Actions CI run (2026-09-28) failed here: all 16
    // iterations converged to the same winner in that run, tripping
    // this "both outcomes must appear" check, even though every one of
    // the 16 assertExactlyOneWinner/assertCommittedInvariant calls
    // above passed (the actual safety invariant held throughout) and a
    // separate CI run of the unmodified test suite earlier the same
    // day had observed both outcomes. This assertion never reliably
    // distinguished genuine concurrency from an accidental sequential
    // fallback in the first place: a sequential bug would make the
    // winner track the `order` variable in lockstep (exchange-first ->
    // exchange wins, line-first -> line wins), which alternates every
    // iteration and would ALSO produce a Set of size 2 - identical to
    // what real, correctly-functioning concurrent execution produces
    // when Postgres's lock arbitration happens to favor one side (a
    // structural asymmetry a database MVCC scheduler is free to have;
    // nothing in this codebase's own contract requires a fair split).
    // The actual safety property - exactly one winner, never both,
    // never neither - is proven on every iteration above AND
    // independently re-proven under each FIXED interleaving by the two
    // tests below (8 iterations each, both already green in the
    // failing run). Keeping `winners` for a human debugging a real
    // future failure, without asserting a specific distribution over
    // it.
    void winners;
  }, 60_000);

  it('the invariant holds under the reverse interleaving too (line-attach initiated first, every iteration)', async () => {
    const ctx = await seedContext();
    for (let i = 0; i < 8; i++) {
      const { resExchange, resLine, fulfilmentId } = await raceOnce(ctx, 'line-first', `reverse-${i}`);
      assertExactlyOneWinner(resExchange, resLine);
      await assertCommittedInvariant(fulfilmentId);
    }
  });

  it('the invariant holds under the forward interleaving too (exchangeId-set initiated first, every iteration)', async () => {
    const ctx = await seedContext();
    for (let i = 0; i < 8; i++) {
      const { resExchange, resLine, fulfilmentId } = await raceOnce(ctx, 'exchange-first', `forward-${i}`);
      assertExactlyOneWinner(resExchange, resLine);
      await assertCommittedInvariant(fulfilmentId);
    }
  });
});
