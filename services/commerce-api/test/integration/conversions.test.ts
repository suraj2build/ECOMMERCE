import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ConversionService } from '../../src/modules/conversions/service.js';

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

  it('queues a GA4 and a Meta purchase atomically with a consented COD order, with SKU IDs, INR and the order number', async () => {
    const { order, sku } = await codOrder(BOTH);
    const events = await testPrisma.conversionEvent.findMany({ where: { orderId: order.id }, orderBy: { provider: 'asc' } });
    expect(events.map((e) => [e.provider, e.eventName, e.eventId, e.status])).toEqual([
      ['GA4', 'purchase', `purchase:${order.orderNumber}`, 'PENDING'],
      ['META', 'Purchase', `purchase:${order.orderNumber}`, 'PENDING'],
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
    expect(await testPrisma.conversionEvent.count({ where: { orderId: order.id } })).toBe(2);
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
    expect(await service().dispatchDue()).toEqual({ sent: 0, failed: 0, retrying: 0, ambiguous: 0 });
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
    expect((metaCall.body.data as { event_id: string }[])[0]!.event_id).toBe(`purchase:${order.orderNumber}`);

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
    expect(ids).toEqual([`purchase:${order.orderNumber}`, `purchase:${order.orderNumber}`]);
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
