import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedCustomer, createAuthenticatedStaff } from '../helpers/auth.js';
import { ConversionService } from '../../src/modules/conversions/service.js';
import { OrderService } from '../../src/modules/order/service.js';

/**
 * LR-003 server-side conversion events (specs/27-analytics-reporting.md):
 * consent gating, purchase = confirmed order (COD at placement, prepaid only
 * after capture), refund on completion, no personal data in GA4 payloads,
 * hashed identifiers only for Meta, durable dedup, safe retry, ambiguous
 * outcomes, disabled integrations and RBAC. Google and Meta are replaced by
 * a stub at the HTTP boundary (GA4_MP_URL / META_GRAPH_URL).
 */

const GA4_URL = 'https://ga4.stub.test/mp/collect';
const META_URL = 'https://graph.stub.test/v21.0';
const INTEGRATION_ENV: Record<string, string> = {
  RAZORPAY_KEY_ID: 'test_key_id',
  RAZORPAY_KEY_SECRET: 'test_key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
  GA4_MEASUREMENT_ID: 'G-TEST123',
  GA4_API_SECRET: 'ga4-test-api-secret',
  GA4_MP_URL: GA4_URL,
  META_PIXEL_ID: '1234567890',
  META_CAPI_ACCESS_TOKEN: 'meta-test-access-token-0123456789',
  META_GRAPH_URL: META_URL,
  STOREFRONT_PUBLIC_URL: 'https://shop.example.test',
};
const DISABLED_KEYS = ['GA4_MEASUREMENT_ID', 'GA4_API_SECRET', 'META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN'];

function setIntegrations(enabled: boolean) {
  for (const [key, value] of Object.entries(INTEGRATION_ENV)) process.env[key] = value;
  if (!enabled) for (const key of DISABLED_KEYS) delete process.env[key];
  __resetEnvCacheForTests();
}

const GUEST_HEADER = 'x-guest-session-id';
const PINCODE = '110002';
const CONTACT = { name: 'Jane Doe', mobile: '9876543210', email: 'Jane.Doe@Example.com' };

type ProviderReply = { status: number; body?: unknown } | 'network-error';

describe('Server-side conversion events (LR-003)', () => {
  let app: FastifyInstance;
  let counter = 0;
  let calls: { url: string; body: Record<string, unknown> }[] = [];
  let ga4Replies: ProviderReply[] = [];
  let metaReplies: ProviderReply[] = [];

  beforeAll(async () => {
    setIntegrations(true);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
    for (const key of Object.keys(INTEGRATION_ENV)) delete process.env[key];
    __resetEnvCacheForTests();
  });

  beforeEach(async () => {
    setIntegrations(true);
    await resetDatabase();
    await seedRbac();
    await testPrisma.serviceablePincode.create({ data: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } });
    counter += 1;
    calls = [];
    ga4Replies = [];
    metaReplies = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.endsWith('/orders') && init?.method === 'POST') return new Response(JSON.stringify({ id: `order_mock_${counter}_${Math.random()}` }), { status: 200 });
      if (href.includes('/payments/') && href.endsWith('/refund')) return new Response(JSON.stringify({ id: `rfnd_${counter}`, status: 'processed' }), { status: 200 });
      const isGa4 = href.startsWith(GA4_URL);
      const isMeta = href.startsWith(META_URL);
      if (!isGa4 && !isMeta) throw new Error(`Unexpected fetch in test: ${href}`);
      calls.push({ url: href, body: JSON.parse(String(init?.body)) });
      const reply = (isGa4 ? ga4Replies : metaReplies).shift() ?? { status: isGa4 ? 204 : 200, body: isGa4 ? undefined : { events_received: 1 } };
      if (reply === 'network-error') throw new TypeError('fetch failed');
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    }));
  });

  async function staffToken(role: string, perms: string[]) {
    await grantPermissions(role, perms);
    return (await createAuthenticatedStaff(app, [role])).token;
  }

  async function setupSku(sellingPrice = 1500) {
    const token = await staffToken('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Conversions Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: { legalEntityId: legalEntity.id, gstin: `DLCNVTST${counter}A1Z${counter % 10}`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000) },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode: '6109' } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const auth = { authorization: `Bearer ${token}` };
    const styleCode = `CNV-${counter}-${Math.random().toString(36).slice(2, 8)}`;
    const style = (await app.inject({ method: 'POST', url: '/api/v1/products/styles', headers: auth, payload: { styleCode, name: 'Conversion Kurta', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode: '6109' } })).json();
    const colour = (await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/colours`, headers: auth, payload: { name: 'Black', colourCode: 'BLK' } })).json();
    const sku = (await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/skus/generate`, headers: auth, payload: { sizeIds: [size.id] } })).json()[0];
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/media`, headers: auth, payload: { colourId: colour.id, url: 'https://example.com/x.jpg' } });
    for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) await app.inject({ method: 'POST', url: `/api/v1/products/styles/${style.id}/${step}`, headers: auth });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: auth, payload: { styleId: style.id, mrp: sellingPrice, sellingPrice } });
    await testPrisma.inventoryBalance.create({ data: { skuId: sku.skuId, locationId: location.id, onHand: 10, reserved: 0 } });
    const skuRow = await testPrisma.sku.findUniqueOrThrow({ where: { id: sku.skuId } });
    return { skuId: sku.skuId as string, skuCode: skuRow.skuCode, styleCode };
  }

  const address = { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: PINCODE };

  async function checkout(skuId: string, paymentMethod: 'COD' | 'PREPAID', tracking?: Record<string, unknown>) {
    const headers = { [GUEST_HEADER]: `guest-conv-${counter}-${Math.random().toString(36).slice(2, 8)}` };
    expect((await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } })).statusCode).toBe(201);
    return app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout',
      headers,
      payload: {
        contactName: CONTACT.name, contactMobile: CONTACT.mobile, contactEmail: CONTACT.email,
        billingAddress: address, shippingAddress: address, paymentMethod,
        idempotencyKey: `conv-${counter}-${Math.random()}`,
        ...(tracking ? { tracking } : {}),
      },
    });
  }

  const BOTH = { analytics: true, marketing: true, analyticsClientId: '1234567890.1700000000', metaBrowserId: 'fb.1.1700000000000.987654321', metaClickId: 'fb.1.1700000000000.AbCdEf_123' };

  async function codOrder(tracking?: Record<string, unknown>, existing?: Awaited<ReturnType<typeof setupSku>>) {
    const sku = existing ?? (await setupSku());
    const res = await checkout(sku.skuId, 'COD', tracking);
    expect(res.statusCode).toBe(201);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    return { order, sku };
  }

  async function capture(sessionId: string, paymentId: string) {
    const payment = await testPrisma.payment.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
    const body = JSON.stringify({ id: `evt_${paymentId}`, event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: payment.providerReferenceId } } } });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', 'test_webhook_secret').update(body).digest('hex') },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  }

  const service = () => new ConversionService(app);

  // --- Consent and purchase semantics ---

  it('a consented COD order placed queues "COD order placed" events, never a purchase (LR-009), with SKU IDs, INR and the order number', async () => {
    const { order, sku } = await codOrder(BOTH);
    const events = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id }, orderBy: { provider: 'asc' } });
    expect(events.map((e) => [e.provider, e.eventName, e.eventId, e.status, e.retrySafe])).toEqual([
      // GA4 does not deduplicate custom events, so an unknown outcome is never resent.
      ['GA4', 'cod_order_placed', `cod_placed:${order.orderNumber}`, 'PENDING', false],
      ['META', 'CODOrderPlaced', `cod_placed:${order.orderNumber}`, 'PENDING', true],
    ]);
    const ga4 = events[0]!.payload as { client_id: string; events: { params: Record<string, unknown> & { items: Record<string, unknown>[] } }[] };
    expect(ga4.client_id).toBe(BOTH.analyticsClientId);
    expect(ga4.events[0]!.params).toMatchObject({ transaction_id: order.orderNumber, currency: 'INR', value: Number(order.grandTotal) });
    expect(ga4.events[0]!.params.items[0]).toMatchObject({ item_id: sku.skuCode, item_group_id: sku.styleCode, quantity: 1 });
    const meta = events[1]!.payload as { user_data: Record<string, unknown>; custom_data: Record<string, unknown> };
    expect(meta.custom_data).toMatchObject({ currency: 'INR', order_id: order.orderNumber, content_ids: [sku.skuCode] });
    expect(meta.user_data.em).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(meta.user_data.ph).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(meta.user_data).toMatchObject({ fbp: BOTH.metaBrowserId, fbc: BOTH.metaClickId });
    // A COD order is confirmed before any money is collected; both events say so.
    expect(ga4.events[0]!.params.payment_type).toBe('cod');
    expect(meta.custom_data.payment_type).toBe('cod');
  });

  it('never puts a name, email, phone or address in any payload; Meta gets only hashes', async () => {
    const { order } = await codOrder(BOTH);
    const events = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id } });
    for (const event of events) {
      const text = JSON.stringify(event.payload).toLowerCase();
      for (const personal of [CONTACT.name.toLowerCase(), 'jane', CONTACT.mobile, CONTACT.email.toLowerCase(), 'test street', PINCODE]) {
        expect(text).not.toContain(personal);
      }
    }
  });

  it('records nothing and stores no identifiers when consent is refused or never given', async () => {
    const refused = await codOrder({ analytics: false, marketing: false, analyticsClientId: BOTH.analyticsClientId, metaBrowserId: BOTH.metaBrowserId });
    const absent = await codOrder(undefined, refused.sku);
    for (const { order } of [refused, absent]) {
      expect(order).toMatchObject({ analyticsConsent: false, marketingConsent: false, analyticsClientId: null, metaBrowserId: null, metaClickId: null });
      expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(0);
    }
  });

  it('sends only GA4 for analytics-only consent, and keeps no Meta identifiers', async () => {
    const { order } = await codOrder({ ...BOTH, marketing: false });
    expect(order).toMatchObject({ analyticsConsent: true, marketingConsent: false, metaBrowserId: null, metaClickId: null });
    const events = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id } });
    expect(events.map((e) => e.provider)).toEqual(['GA4']);
    expect((events[0]!.payload as { consent: unknown }).consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  });

  it('a prepaid checkout (the payment button) is not a purchase; the purchase is queued only once Razorpay capture confirms the order', async () => {
    const sku = await setupSku();
    const res = await checkout(sku.skuId, 'PREPAID', BOTH);
    expect(res.statusCode).toBe(201);
    expect(await testPrisma.order.count()).toBe(0);
    expect(await testPrisma.conversionEvent.count()).toBe(0);
    await capture(res.json().id, `pay_conv_${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    const queued = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id }, orderBy: { provider: 'asc' } });
    expect(queued).toHaveLength(2);
    expect((queued[0]!.payload as { events: { params: { payment_type: string } }[] }).events[0]!.params.payment_type).toBe('prepaid');
    expect((queued[1]!.payload as { custom_data: { payment_type: string } }).custom_data.payment_type).toBe('prepaid');
    // A duplicate capture webhook does not queue the purchase again.
    await capture(res.json().id, `pay_conv_${counter}`);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('rejects malformed tracking identifiers instead of storing them', async () => {
    const sku = await setupSku();
    const res = await checkout(sku.skuId, 'COD', { analytics: true, marketing: true, metaBrowserId: 'jane.doe@example.com' });
    expect(res.statusCode).toBe(400);
  });

  it('queues nothing and sends nothing while the integrations are not configured', async () => {
    setIntegrations(false);
    const { order } = await codOrder(BOTH);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(0);
    expect(await service().dispatchDue()).toEqual({ sent: 0, failed: 0, retrying: 0, ambiguous: 0, withdrawn: 0 });
    expect(calls).toHaveLength(0);
  });

  // --- Dispatch, dedup and retries ---

  it('sends each event once with credentials kept out of stored data, and never twice', async () => {
    const { order } = await codOrder(BOTH);
    expect(await service().dispatchDue()).toMatchObject({ sent: 2 });
    expect(calls).toHaveLength(2);
    const ga4Call = calls.find((c) => c.url.startsWith(GA4_URL))!;
    expect(ga4Call.url).toContain('measurement_id=G-TEST123');
    const metaCall = calls.find((c) => c.url.startsWith(META_URL))!;
    expect(metaCall.url).toBe(`${META_URL}/1234567890/events`);
    expect(metaCall.url).not.toContain('access_token');
    expect((metaCall.body.data as { event_id: string }[])[0]!.event_id).toBe(`cod_placed:${order.orderNumber}`);

    // Re-queuing the same order's purchase is a no-op, and a second sweep sends nothing.
    await service().enqueuePurchase(testPrisma, order.id);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(2);
    expect(await service().dispatchDue()).toMatchObject({ sent: 0 });
    expect(calls).toHaveLength(2);
    const stored = JSON.stringify(await testPrisma.conversionEvent.findMany());
    expect(stored).not.toContain('meta-test-access-token');
    expect(stored).not.toContain('ga4-test-api-secret');
  });

  it('retries an unknown Meta outcome later with the same event_id (Meta deduplicates it)', async () => {
    const { order } = await codOrder({ ...BOTH, analytics: false });
    metaReplies = [{ status: 503, body: { error: 'unavailable' } }];
    expect(await service().dispatchDue()).toMatchObject({ retrying: 1 });
    const pending = await testPrisma.conversionEvent.findFirstOrThrow({ where: { orderId: order.id } });
    expect(pending).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Not yet due: nothing is sent.
    expect(await service().dispatchDue()).toMatchObject({ sent: 0, retrying: 0 });
    await testPrisma.conversionEvent.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date() } });
    expect(await service().dispatchDue()).toMatchObject({ sent: 1 });
    const ids = calls.map((c) => (c.body.data as { event_id: string }[])[0]!.event_id);
    expect(ids).toEqual([`cod_placed:${order.orderNumber}`, `cod_placed:${order.orderNumber}`]);
  });

  it('records a definite provider rejection as FAILED and never resends it', async () => {
    const { order } = await codOrder({ ...BOTH, analytics: false });
    metaReplies = [{ status: 400, body: { error: { message: 'Invalid parameter' } } }];
    expect(await service().dispatchDue()).toMatchObject({ failed: 1 });
    const failed = await testPrisma.conversionEvent.findFirstOrThrow({ where: { orderId: order.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('HTTP 400');
    expect(await service().dispatchDue()).toMatchObject({ sent: 0 });
    expect(calls).toHaveLength(1);
  });

  it('two concurrent dispatchers send every event exactly once', async () => {
    const sku = await setupSku();
    for (let i = 0; i < 3; i++) await codOrder(BOTH, sku);
    const [a, b] = await Promise.all([service().dispatchDue(), service().dispatchDue()]);
    expect(a.sent + b.sent).toBe(6);
    expect(calls).toHaveLength(6);
    expect(await testPrisma.conversionEvent.count({ where: { status: 'SENT' } })).toBe(6);
  });

  it('a claim left by a crashed dispatcher is resent if the provider deduplicates, otherwise flagged for a human', async () => {
    const { order } = await codOrder({ ...BOTH, analytics: false });
    const stale = new Date(Date.now() - 3_600_000);
    await testPrisma.conversionEvent.updateMany({ where: { orderId: order.id }, data: { status: 'SENDING', claimedAt: stale } });
    const refundLike = await testPrisma.conversionEvent.create({
      data: { provider: 'GA4', eventName: 'refund', eventId: `refund:stale-${counter}`, orderId: order.id, retrySafe: false, payload: {}, status: 'SENDING', claimedAt: stale },
    });
    expect(await service().reclaimStale()).toEqual({ requeued: 1, ambiguous: 1 });
    expect((await testPrisma.conversionEvent.findUniqueOrThrow({ where: { id: refundLike.id } })).status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
    expect(await service().dispatchDue()).toMatchObject({ sent: 1 });
  });

  // --- Refunds ---

  it('queues a GA4 refund when a refund completes; an unknown outcome is not resent (GA4 does not deduplicate refunds)', async () => {
    const sku = await setupSku();
    const res = await checkout(sku.skuId, 'PREPAID', BOTH);
    await capture(res.json().id, `pay_conv_refund_${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id }, include: { lines: true } });
    await service().dispatchDue();

    const cs = await staffToken('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/lines/${order.lines[0]!.id}/cancel`, headers: { authorization: `Bearer ${cs}` }, payload: { idempotencyKey: `cancel-${counter}` } })).statusCode).toBe(200);
    const finance = await staffToken('FINANCE', ['payment:refund', 'order:read']);
    const refundRes = await app.inject({ method: 'POST', url: '/api/v1/refunds', headers: { authorization: `Bearer ${finance}` }, payload: { orderId: order.id, orderLineId: order.lines[0]!.id, idempotencyKey: `refund-${counter}` } });
    expect(refundRes.statusCode).toBeLessThan(300);
    const refund = await testPrisma.refund.findFirstOrThrow({ where: { orderId: order.id } });
    expect(refund.status).toBe('COMPLETED');

    const event = await testPrisma.conversionEvent.findFirstOrThrow({ where: { refundId: refund.id } });
    expect(event).toMatchObject({ provider: 'GA4', eventName: 'refund', eventId: `refund:${refund.id}`, retrySafe: false });
    expect((event.payload as { events: { params: Record<string, unknown> }[] }).events[0]!.params).toMatchObject({ transaction_id: order.orderNumber, currency: 'INR', value: Number(refund.amount) });
    expect(await testPrisma.conversionEvent.count({ where: { provider: 'META', eventName: { not: 'Purchase' } } })).toBe(0);

    ga4Replies = ['network-error'];
    expect(await service().dispatchDue()).toMatchObject({ ambiguous: 1 });
    expect((await testPrisma.conversionEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
    const sentBefore = calls.length;
    await service().dispatchDue();
    expect(calls.length).toBe(sentBefore);
  });

  // --- Consent withdrawal (LR-003 review) ---

  const SUBJECT = () => crypto.randomUUID();
  const withdraw = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/v1/storefront/consent/withdrawal', headers, payload });

  it('withdrawal suppresses every queued event and clears the stored consent and identifiers', async () => {
    const subjectId = SUBJECT();
    const { order, sku } = await codOrder({ ...BOTH, consentSubjectId: subjectId });
    expect(order.consentSubjectId).toBe(subjectId);
    const other = await codOrder({ ...BOTH, consentSubjectId: SUBJECT() }, sku);

    const res = await withdraw({ subjectId, analytics: false, marketing: false });
    expect(res.statusCode).toBe(204);
    expect(await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ analyticsConsent: false, marketingConsent: false, analyticsClientId: null, metaBrowserId: null, metaClickId: null });
    expect((await testPrisma.conversionEvent.findMany({ where: { orderId: order.id } })).map((e) => [e.status, e.lastError])).toEqual([['WITHDRAWN', 'consent withdrawn'], ['WITHDRAWN', 'consent withdrawn']]);

    // Only the other browser's order is sent.
    expect(await service().dispatchDue()).toMatchObject({ sent: 2 });
    expect(calls.every((c) => JSON.stringify(c.body).includes(other.order.orderNumber))).toBe(true);
    expect(await testPrisma.checkoutSession.findUniqueOrThrow({ where: { id: order.checkoutSessionId } })).toMatchObject({ analyticsConsent: false, marketingConsent: false });
  });

  it('withdrawal also stops an event waiting for a retry', async () => {
    const subjectId = SUBJECT();
    const { order } = await codOrder({ ...BOTH, analytics: false, consentSubjectId: subjectId });
    metaReplies = [{ status: 503, body: { error: 'unavailable' } }];
    expect(await service().dispatchDue()).toMatchObject({ retrying: 1 });
    expect((await withdraw({ subjectId, analytics: false, marketing: false })).statusCode).toBe(204);
    await testPrisma.conversionEvent.updateMany({ where: { orderId: order.id }, data: { nextAttemptAt: new Date() } });
    expect(await service().dispatchDue()).toMatchObject({ sent: 0, retrying: 0 });
    expect(calls).toHaveLength(1);
    expect((await testPrisma.conversionEvent.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('WITHDRAWN');
  });

  it('a claim in flight is re-checked at send time: withdrawn consent is never sent after a reclaim', async () => {
    const subjectId = SUBJECT();
    const { order } = await codOrder({ ...BOTH, analytics: false, consentSubjectId: subjectId });
    await testPrisma.conversionEvent.updateMany({ where: { orderId: order.id }, data: { status: 'SENDING', claimedAt: new Date(Date.now() - 3_600_000) } });
    expect((await withdraw({ subjectId, analytics: true, marketing: false })).statusCode).toBe(204);
    // The withdrawal cannot touch a SENDING claim; the dispatcher's own check stops it.
    expect(await service().dispatchDue()).toMatchObject({ sent: 0, withdrawn: 1 });
    expect(calls).toHaveLength(0);
  });

  it('a GA4 claim in flight when marketing is withdrawn is sent with the ad purposes denied, and its Meta twin is not sent', async () => {
    const subjectId = SUBJECT();
    // A prepaid purchase: GA4 deduplicates it, so a reclaimed claim is resent.
    const sku = await setupSku();
    const res = await checkout(sku.skuId, 'PREPAID', { ...BOTH, consentSubjectId: subjectId });
    await capture(res.json().id, `pay_conv_inflight_${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    await testPrisma.conversionEvent.updateMany({ where: { orderId: order.id }, data: { status: 'SENDING', claimedAt: new Date(Date.now() - 3_600_000) } });
    expect((await withdraw({ subjectId, analytics: true, marketing: false })).statusCode).toBe(204);
    expect(await service().dispatchDue()).toMatchObject({ sent: 1, withdrawn: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith(GA4_URL)).toBe(true);
    expect(calls[0]!.body.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  });

  it('withdrawing marketing only stops Meta and downgrades the queued GA4 event to ad purposes denied', async () => {
    const subjectId = SUBJECT();
    const { order } = await codOrder({ ...BOTH, consentSubjectId: subjectId });
    expect((await withdraw({ subjectId, analytics: true, marketing: false })).statusCode).toBe(204);
    const after = await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ analyticsConsent: true, analyticsClientId: BOTH.analyticsClientId, marketingConsent: false, metaBrowserId: null, metaClickId: null });
    expect(await service().dispatchDue()).toMatchObject({ sent: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith(GA4_URL)).toBe(true);
    expect(calls[0]!.body.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
    expect((await testPrisma.conversionEvent.findFirstOrThrow({ where: { orderId: order.id, provider: 'META' } })).status).toBe('WITHDRAWN');
  });

  it('withdrawal before a prepaid payment is captured means the order is created without consent and nothing is queued', async () => {
    const sku = await setupSku();
    const subjectId = SUBJECT();
    const res = await checkout(sku.skuId, 'PREPAID', { ...BOTH, consentSubjectId: subjectId });
    expect((await withdraw({ subjectId, analytics: false, marketing: false })).statusCode).toBe(204);
    await capture(res.json().id, `pay_conv_withdrawn_${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    expect(order).toMatchObject({ analyticsConsent: false, marketingConsent: false, analyticsClientId: null, metaBrowserId: null });
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('a signed-in customer\'s withdrawal covers their own orders from any browser', async () => {
    const { customerId, token } = await createAuthenticatedCustomer(app);
    const { order, sku } = await codOrder({ ...BOTH, consentSubjectId: SUBJECT() });
    await testPrisma.order.update({ where: { id: order.id }, data: { customerId, guestSessionId: null } });
    const stranger = await codOrder({ ...BOTH, consentSubjectId: SUBJECT() }, sku);
    expect((await withdraw({ analytics: false, marketing: false }, { authorization: `Bearer ${token}` })).statusCode).toBe(204);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, status: 'WITHDRAWN' } })).toBe(2);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: stranger.order.id, status: 'PENDING' } })).toBe(2);
  });

  it('an order created while a withdrawal is in progress takes the withdrawn consent, never the stale one', async () => {
    const sku = await setupSku();
    const subjectId = SUBJECT();
    const res = await checkout(sku.skuId, 'PREPAID', { ...BOTH, consentSubjectId: subjectId });
    const sessionId = res.json().id as string;
    await testPrisma.checkoutSession.update({ where: { id: sessionId }, data: { status: 'CONFIRMED' } });
    // The withdrawal's first step holds the session row while it runs.
    let creating!: Promise<unknown>;
    await testPrisma.$transaction(async (tx) => {
      await tx.checkoutSession.update({ where: { id: sessionId }, data: { analyticsConsent: false, marketingConsent: false, analyticsClientId: null, metaBrowserId: null, metaClickId: null } });
      creating = new OrderService(app).createOrderFromCheckoutSession(sessionId);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await creating;
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
    expect(order).toMatchObject({ analyticsConsent: false, marketingConsent: false, metaBrowserId: null });
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('a signed-in withdrawal resent late reaches only orders placed before it was requested', async () => {
    const { customerId, token } = await createAuthenticatedCustomer(app);
    const { order: earlier, sku } = await codOrder({ ...BOTH, consentSubjectId: SUBJECT() });
    const requestedAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const { order: later } = await codOrder({ ...BOTH, consentSubjectId: SUBJECT() }, sku);
    for (const o of [earlier, later]) await testPrisma.order.update({ where: { id: o.id }, data: { customerId, guestSessionId: null } });
    const res = await withdraw({ analytics: false, marketing: false, requestedAt: requestedAt.toISOString() }, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(204);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: earlier.id, status: 'WITHDRAWN' } })).toBe(2);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: later.id, status: 'PENDING' } })).toBe(2);
  });

  it('withdrawal never grants consent, reveals nothing, and rejects a malformed subject', async () => {
    const subjectId = SUBJECT();
    const { order } = await codOrder({ ...BOTH, marketing: false, consentSubjectId: subjectId });
    expect((await withdraw({ subjectId, analytics: true, marketing: true })).statusCode).toBe(204);
    expect(await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ analyticsConsent: true, marketingConsent: false });
    expect((await withdraw({ subjectId: SUBJECT(), analytics: false, marketing: false })).statusCode).toBe(204);
    expect((await withdraw({ subjectId: 'not-a-uuid', analytics: false, marketing: false })).statusCode).toBe(400);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, status: 'PENDING' } })).toBe(1);
  });

  // --- LR-009: COD purchase only after delivery and confirmed collection ---

  async function opsToken() {
    return staffToken('WAREHOUSE_MANAGER', ['warehouse:pick', 'order:fulfil', 'order:read', 'return:initiate', 'return:receive', 'return:qc', 'return:read']);
  }

  async function deliver(orderId: string, token: string) {
    const order = await testPrisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const line = order.lines[0]!;
    const task = await testPrisma.pickTask.findUniqueOrThrow({ where: { orderLineId: line.id } });
    const auth = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${task.id}/pick`, headers: auth, payload: { idempotencyKey: `pick-${line.id}`, outcome: 'FULL', pickedQuantity: line.quantity } });
    const fulfilmentId = (await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/fulfilments`, headers: auth, payload: { lineIds: [line.id] } })).json().id as string;
    for (const step of ['pack', 'ready-to-ship']) await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/${step}`, headers: auth });
    await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/ship`, headers: auth, payload: {} });
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/deliver`, headers: auth })).statusCode).toBe(200);
    return line.id;
  }

  const collect = (orderId: string, token: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cod-collection`, headers: { authorization: `Bearer ${token}` }, payload: body });

  const financeToken = () => staffToken('FINANCE', ['payment:cod:collect', 'payment:refund', 'order:read']);

  it('a COD order becomes a purchase only once delivered and its cash collection is confirmed, dated at collection', async () => {
    const { order, sku } = await codOrder(BOTH);
    const finance = await financeToken();
    const amount = Number(order.grandTotal);
    expect((await collect(order.id, finance, { amount, reference: 'REM-1' })).statusCode).toBe(409); // not delivered yet
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: { in: ['purchase', 'Purchase'] } } })).toBe(0);

    await deliver(order.id, await opsToken());
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: { in: ['purchase', 'Purchase'] } } })).toBe(0); // delivered, cash not confirmed

    const collectedAt = new Date(order.createdAt.getTime() + 500);
    const res = await collect(order.id, finance, { amount, reference: 'REM-1', collectedAt: collectedAt.toISOString() });
    expect(res.statusCode).toBe(200);
    const purchases = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id, eventName: { in: ['purchase', 'Purchase'] } }, orderBy: { provider: 'asc' } });
    expect(purchases.map((e) => [e.provider, e.eventName, e.eventId, e.retrySafe])).toEqual([
      ['GA4', 'purchase', `purchase:${order.orderNumber}`, true],
      ['META', 'Purchase', `purchase:${order.orderNumber}`, true],
    ]);
    const ga4 = purchases[0]!.payload as { timestamp_micros: number; events: { params: Record<string, unknown> & { items: { item_id: string }[] } }[] };
    expect(ga4.timestamp_micros).toBe(collectedAt.getTime() * 1000);
    expect(ga4.events[0]!.params).toMatchObject({ transaction_id: order.orderNumber, currency: 'INR', value: amount, payment_type: 'cod' });
    expect(ga4.events[0]!.params.items.map((i) => i.item_id)).toEqual([sku.skuCode]);
    expect((purchases[1]!.payload as { event_time: number }).event_time).toBe(Math.floor(collectedAt.getTime() / 1000));

    // Recording again with the same details is a no-op; different details are refused.
    expect((await collect(order.id, finance, { amount, reference: 'REM-1' })).json().id).toBe(res.json().id);
    expect((await collect(order.id, finance, { amount, reference: 'REM-2' })).statusCode).toBe(409);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: { in: ['purchase', 'Purchase'] } } })).toBe(2);
    expect(await testPrisma.auditLog.count({ where: { action: 'order.cod.collected', reference: order.id } })).toBe(1);
  });

  it('a cancelled or undelivered COD order can never be recorded as collected, so it is never a purchase', async () => {
    const { order } = await codOrder(BOTH);
    const line = (await testPrisma.orderLine.findFirstOrThrow({ where: { orderId: order.id } }));
    const cs = await staffToken('CUSTOMER_SERVICE', ['order:read', 'order:cancel']);
    expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${order.id}/lines/${line.id}/cancel`, headers: { authorization: `Bearer ${cs}` }, payload: { idempotencyKey: `cancel-cod-${counter}` } })).statusCode).toBe(200);
    const res = await collect(order.id, await financeToken(), { amount: 10, reference: 'REM-X' });
    expect(res.statusCode).toBe(409);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: { in: ['purchase', 'Purchase'] } } })).toBe(0);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: 'refund' } })).toBe(0);
  });

  it('collection is Finance-only, COD-only and bounded by the amount payable', async () => {
    const { order, sku } = await codOrder(BOTH);
    await deliver(order.id, await opsToken());
    const viewer = await staffToken('ANALYTICS', ['order:read']);
    expect((await collect(order.id, viewer, { amount: 1, reference: 'R' })).statusCode).toBe(403);
    const finance = await financeToken();
    expect((await collect(order.id, finance, { amount: Number(order.grandTotal) + 1, reference: 'R' })).statusCode).toBe(400);
    expect((await collect(order.id, finance, { amount: -5, reference: 'R' })).statusCode).toBe(400);
    expect((await collect(order.id, finance, { amount: 10, reference: 'R', collectedAt: new Date(Date.now() + 86_400_000).toISOString() })).statusCode).toBe(400);
    const prepaid = await checkout(sku.skuId, 'PREPAID', BOTH);
    await capture(prepaid.json().id, `pay_conv_notcod_${counter}`);
    const prepaidOrder = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: prepaid.json().id } });
    expect((await collect(prepaidOrder.id, finance, { amount: 10, reference: 'R' })).statusCode).toBe(400);
  });

  it('two Finance users recording the same collection at once produce one record and one purchase', async () => {
    const { order } = await codOrder(BOTH);
    await deliver(order.id, await opsToken());
    const finance = await financeToken();
    const body = { amount: Number(order.grandTotal), reference: 'REM-RACE' };
    const results = await Promise.all([collect(order.id, finance, body), collect(order.id, finance, body)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().id).toBe(results[1]!.json().id);
    expect(await testPrisma.codCollection.count({ where: { orderId: order.id } })).toBe(1);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id, eventName: 'purchase' } })).toBe(1);
  });

  async function returnAndRefund(orderId: string, lineId: string, ops: string, finance: string) {
    const auth = { authorization: `Bearer ${ops}` };
    const init = await app.inject({ method: 'POST', url: '/api/v1/returns', headers: auth, payload: { orderId, lines: [{ orderLineId: lineId, reason: 'Wrong size' }], method: 'DROP_OFF', idempotencyKey: `ret-${lineId}` } });
    expect(init.statusCode).toBe(201);
    const returnId = init.json().id as string;
    await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/receive`, headers: auth });
    expect((await app.inject({ method: 'POST', url: `/api/v1/returns/${returnId}/lines/${init.json().lines[0].id}/qc`, headers: auth, payload: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } })).statusCode).toBe(200);
    const refund = await app.inject({ method: 'POST', url: '/api/v1/refunds', headers: { authorization: `Bearer ${finance}` }, payload: { orderId, orderLineId: lineId, idempotencyKey: `refund-${lineId}` } });
    expect(refund.statusCode).toBeLessThan(300);
  }

  it('a refund after the COD purchase is reported as a refund; a refund before it is left out of the purchase and never reported', async () => {
    const ops = await opsToken();
    const finance = await financeToken();

    const after = await codOrder(BOTH);
    const afterLine = await deliver(after.order.id, ops);
    expect((await collect(after.order.id, finance, { amount: Number(after.order.grandTotal), reference: 'REM-A' })).statusCode).toBe(200);
    await returnAndRefund(after.order.id, afterLine, ops, finance);
    const refundEvent = await testPrisma.conversionEvent.findFirstOrThrow({ where: { orderId: after.order.id, eventName: 'refund' } });
    expect(refundEvent.provider).toBe('GA4');

    const before = await codOrder(BOTH, after.sku);
    const beforeLine = await deliver(before.order.id, ops);
    await returnAndRefund(before.order.id, beforeLine, ops, finance);
    expect(await testPrisma.conversionEvent.count({ where: { orderId: before.order.id, eventName: 'refund' } })).toBe(0);
    expect((await collect(before.order.id, finance, { amount: Number(before.order.grandTotal), reference: 'REM-B' })).statusCode).toBe(200);
    // Its only line was refunded before collection: nothing is left to report as purchased.
    expect(await testPrisma.conversionEvent.count({ where: { orderId: before.order.id, eventName: { in: ['purchase', 'Purchase'] } } })).toBe(0);
  });

  it('a prepaid purchase is unchanged: reported at capture, with no "COD placed" event', async () => {
    const sku = await setupSku();
    const res = await checkout(sku.skuId, 'PREPAID', BOTH);
    await capture(res.json().id, `pay_conv_prepaid_${counter}`);
    const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id } });
    const names = (await testPrisma.conversionEvent.findMany({ where: { orderId: order.id } })).map((e) => e.eventName).sort();
    expect(names).toEqual(['Purchase', 'purchase']);
  });

  // --- Staff routes ---

  it('status needs analytics:read and the sweep needs campaign:manage', async () => {
    await codOrder(BOTH);
    const reader = await staffToken('ANALYTICS', ['analytics:read']);
    const status = await app.inject({ method: 'GET', url: '/api/v1/analytics/conversions', headers: { authorization: `Bearer ${reader}` } });
    expect(status.statusCode).toBe(200);
    expect(status.json().enabled).toEqual(['GA4', 'META']);
    expect(status.json().counts).toEqual(expect.arrayContaining([{ provider: 'GA4', status: 'PENDING', count: 1 }]));
    expect((await app.inject({ method: 'POST', url: '/api/v1/analytics/sweep/conversions', headers: { authorization: `Bearer ${reader}` } })).statusCode).toBe(403);
    const marketer = await staffToken('MARKETING', ['campaign:manage']);
    const sweep = await app.inject({ method: 'POST', url: '/api/v1/analytics/sweep/conversions', headers: { authorization: `Bearer ${marketer}` } });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json().sent).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/api/v1/analytics/conversions' })).statusCode).toBe(401);
  });
});
