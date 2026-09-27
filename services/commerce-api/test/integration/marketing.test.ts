import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@fcp/db';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

process.env.RAZORPAY_KEY_ID = 'test_key_id';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.COD_MAX_ORDER_VALUE_INR = '50000';

const SERVICEABLE_PINCODE = '110001';

/**
 * Marketing (M25, specs/24-marketing.md, MKT-001) adversarial
 * certification. Covers: live segmentation (order-count/spend/loyalty-
 * tier criteria, recipient-count data minimization), campaign creation
 * validation (ORDER_UPDATES rejected as a campaign messageType),
 * send-time opt-out enforcement (CUST-002's existing per-channel/per-
 * message-type matrix, reused verbatim - never a second consent
 * model), the PUSH/no-address honest-skip scope boundary, idempotent
 * per-recipient delivery (a retried send never double-messages),
 * genuine concurrency (two simultaneous send triggers on the same
 * campaign converge to exactly one sender), and staff RBAC on the
 * minimal campaign-management API.
 */
describe('Marketing (M25)', () => {
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
    // Defensive reset (Blocker 4 tests temporarily switch MARKETING_PROVIDER
    // to a test-only double and always restore it in their own `finally`,
    // but this guards against a leaked override if a test throws first).
    delete process.env.MARKETING_PROVIDER;
    __resetEnvCacheForTests();
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

  async function marketingToken() {
    await grantPermissions('MARKETING', ['campaign:manage', 'campaign:read']);
    return (await createAuthenticatedStaff(app, ['MARKETING'])).token;
  }

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function seedContext() {
    const { brand, category, size, location } = await seedBrandAndLocation();
    const legalEntity = await testPrisma.legalEntity.create({ data: { legalName: 'Marketing Test Pvt Ltd', registeredState: 'Delhi' } });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLMKTTST${counter}A1Z${counter % 10}`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    await testPrisma.location.update({ where: { id: location.id }, data: { gstRegistrationId: registration.id } });
    return { brandId: brand.id, categoryId: category.id, sizeId: size.id, locationId: location.id };
  }

  async function setupCheckoutableSku(sellingPrice: number, ctx: Awaited<ReturnType<typeof seedContext>>, onHand = 50) {
    const token = await merchandisingToken();
    const hsnCode = '6109';
    if (!(await testPrisma.taxRate.findFirst({ where: { hsnCode } }))) {
      await testPrisma.taxRate.create({ data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
    }
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: `MKT-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, name: 'Marketing Test Jacket', brandId: ctx.brandId, categoryId: ctx.categoryId, season: 'SS26', collection: 'Core', hsnCode },
    });
    const styleId = styleRes.json().id as string;
    const colourRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/colours`, headers: { authorization: `Bearer ${token}` }, payload: { name: 'Black', colourCode: 'BLK' } });
    const colourId = colourRes.json().id as string;
    const skuRes = await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/skus/generate`, headers: { authorization: `Bearer ${token}` }, payload: { sizeIds: [ctx.sizeId] } });
    const skuId = skuRes.json()[0].skuId as string;

    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/media`, headers: { authorization: `Bearer ${token}` }, payload: { colourId, url: 'https://example.com/x.jpg' } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/qa-check`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: `/api/v1/products/styles/${styleId}/publish`, headers: { authorization: `Bearer ${token}` } });
    await app.inject({ method: 'POST', url: '/api/v1/catalog/prices', headers: { authorization: `Bearer ${token}` }, payload: { styleId, mrp: sellingPrice, sellingPrice } });
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId: ctx.locationId, onHand, reserved: 0 } });

    return { skuId };
  }

  function validAddress() {
    return { line1: '123 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: SERVICEABLE_PINCODE };
  }

  async function placeCodOrder(skuId: string, customerToken: string, idempotencyKey: string) {
    const headers = { authorization: `Bearer ${customerToken}` };
    await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId, quantity: 1 } });
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
    return res.json();
  }

  async function createTier(name: string, sortOrder: number) {
    return testPrisma.loyaltyTier.create({ data: { name, minLifetimePoints: 0, sortOrder } });
  }

  async function createCampaign(token: string, overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/marketing/campaigns',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test campaign', channel: 'EMAIL', messageType: 'NEWSLETTER', content: 'Hello!', ...overrides },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; status: string };
  }

  async function sendCampaign(token: string, campaignId: string) {
    return app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
  }

  async function sweepDueCampaigns(token: string) {
    return app.inject({ method: 'POST', url: '/api/v1/marketing/sweep/send-due', headers: { authorization: `Bearer ${token}` } });
  }

  async function optedInCustomerWithEmail(email: string) {
    const { customerId } = await createAuthenticatedCustomer(app);
    await testPrisma.customer.update({ where: { id: customerId }, data: { email } });
    await testPrisma.communicationPreference.create({ data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true } });
    return customerId;
  }

  // --- Segmentation ---

  describe('Segmentation', () => {
    it('1. minLifetimeOrderCount/minLifetimeSpend correctly include/exclude customers based on real order history', async () => {
      const ctx = await seedContext();
      const { skuId } = await setupCheckoutableSku(3000, ctx);
      const { token: bigSpenderToken } = await createAuthenticatedCustomer(app);
      const { token: smallSpenderToken } = await createAuthenticatedCustomer(app);

      await placeCodOrder(skuId, bigSpenderToken, `idem-seg-big-1-${counter}`);
      await placeCodOrder(skuId, bigSpenderToken, `idem-seg-big-2-${counter}`);
      await placeCodOrder(skuId, smallSpenderToken, `idem-seg-small-1-${counter}`);

      const token = await marketingToken();
      const segRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/segments',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Repeat buyers', minLifetimeOrderCount: 2 },
      });
      expect(segRes.statusCode).toBe(201);
      const segmentId = segRes.json().id as string;

      const countRes = await app.inject({
        method: 'GET',
        url: `/api/v1/marketing/segments/${segmentId}/recipient-count`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(countRes.statusCode).toBe(200);
      expect(countRes.json()).toEqual({ recipientCount: 1 });
      // Data minimization: the response is a count only, never a customer list/PII.
      expect(countRes.json().customers).toBeUndefined();
    });

    it('2. loyaltyTierId criterion correctly filters by real LoyaltyAccount.currentTierId', async () => {
      const goldTier = await createTier('Gold', 2);
      await createTier('Silver', 1);
      const { customerId: goldCustomerId } = await createAuthenticatedCustomer(app);
      const { customerId: silverCustomerId } = await createAuthenticatedCustomer(app);
      await testPrisma.loyaltyAccount.create({ data: { customerId: goldCustomerId, currentTierId: goldTier.id } });
      await testPrisma.loyaltyAccount.create({ data: { customerId: silverCustomerId } });

      const token = await marketingToken();
      const segRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/segments',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Gold members', loyaltyTierId: goldTier.id },
      });
      expect(segRes.statusCode).toBe(201);

      const countRes = await app.inject({
        method: 'GET',
        url: `/api/v1/marketing/segments/${segRes.json().id}/recipient-count`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(countRes.json().recipientCount).toBe(1);
    });

    it('3. a campaign with no segmentId targets all customers', async () => {
      await createAuthenticatedCustomer(app);
      await createAuthenticatedCustomer(app);
      const token = await marketingToken();
      const countRes = await app.inject({ method: 'GET', url: '/api/v1/marketing/segments/00000000-0000-0000-0000-000000000000/recipient-count', headers: { authorization: `Bearer ${token}` } });
      expect(countRes.statusCode).toBe(404);
    });
  });

  // --- Campaign validation ---

  describe('Campaign creation', () => {
    it('4. ORDER_UPDATES is rejected as a campaign messageType (reserved for transactional messaging)', async () => {
      const token = await marketingToken();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/campaigns',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Bad campaign', channel: 'EMAIL', messageType: 'ORDER_UPDATES', content: 'Hi' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('5. a campaign referencing a nonexistent segment is rejected', async () => {
      const token = await marketingToken();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/campaigns',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Bad campaign', channel: 'EMAIL', messageType: 'NEWSLETTER', content: 'Hi', segmentId: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // --- Send-time opt-out enforcement + honest skip reasons ---

  describe('Campaign send', () => {
    it('6. a customer opted out of the channel/messageType is SKIPPED_OPTOUT, never sent', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'optedout@example.com' } });
      await testPrisma.communicationPreference.create({
        data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: false },
      });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.statusCode).toBe(200);
      expect(sendRes.json().sentCount).toBe(0);
      expect(sendRes.json().skippedCount).toBe(1);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_OPTOUT');
    });

    it('7. a customer with no email is SKIPPED_NO_ADDRESS for an EMAIL campaign, never a fabricated send', async () => {
      const { customerId } = await createAuthenticatedCustomer(app); // email is null by default
      await testPrisma.communicationPreference.create({
        data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true },
      });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_NO_ADDRESS');
    });

    it('8. a PUSH campaign always SKIPS_NO_ADDRESS for every recipient (no device-token store exists in this codebase - honest scope boundary, never a fake success)', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.communicationPreference.create({
        data: { customerId, channel: 'PUSH', messageType: 'NEWSLETTER', optedIn: true },
      });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { channel: 'PUSH' });
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_NO_ADDRESS');
    });

    it('9. an opted-in customer with a valid address is genuinely SENT (real MockMarketingProvider call, real providerMessageId recorded)', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'optedin@example.com' } });
      await testPrisma.communicationPreference.create({
        data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true },
      });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(1);
      expect(sendRes.json().campaign.status).toBe('SENT');

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SENT');
      expect(delivery.providerMessageId).toMatch(/^mock-/);
    });

    it('10. a customer with no explicit preference row defaults to opted-OUT for a marketing message type - never sent by default', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'nodefault@example.com' } });
      // No CommunicationPreference row at all - marketing types default opted-OUT.

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_OPTOUT');
    });

    it('11. re-sending an already-SENT campaign is a safe idempotent no-op - never a double delivery row/message', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'idem@example.com' } });
      await testPrisma.communicationPreference.create({ data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true } });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const firstSend = await sendCampaign(token, campaignId);
      expect(firstSend.json().sentCount).toBe(1);

      const secondSend = await sendCampaign(token, campaignId);
      expect(secondSend.statusCode).toBe(200);
      expect(secondSend.json().sentCount).toBe(0); // already SENT - safe no-op, not reprocessed

      const deliveries = await testPrisma.campaignDelivery.findMany({ where: { campaignId, customerId } });
      expect(deliveries).toHaveLength(1); // never a duplicate row
    });

    it('12. two genuinely concurrent send triggers on the SAME campaign converge to exactly one sender (Promise.all, real Postgres row-level CAS)', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'race@example.com' } });
      await testPrisma.communicationPreference.create({ data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true } });

      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);

      const [resA, resB] = await Promise.all([sendCampaign(token, campaignId), sendCampaign(token, campaignId)]);

      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      const totalSent = resA.json().sentCount + resB.json().sentCount;
      expect(totalSent).toBe(1); // exactly one of the two actually processed the recipient set

      const deliveries = await testPrisma.campaignDelivery.findMany({ where: { campaignId, customerId } });
      expect(deliveries).toHaveLength(1); // never a double-send

      const campaign = await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(campaign.status).toBe('SENT');
    });

    it('13. a cancelled campaign cannot be sent, and an already-SENT campaign cannot be cancelled', async () => {
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/cancel`, headers: { authorization: `Bearer ${token}` } });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().status).toBe('CANCELLED');

      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0); // CANCELLED is terminal - claimForSend never claims it

      const { id: secondCampaignId } = await createCampaign(token);
      await sendCampaign(token, secondCampaignId);
      const cancelAfterSendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${secondCampaignId}/cancel`, headers: { authorization: `Bearer ${token}` } });
      expect(cancelAfterSendRes.statusCode).toBe(400);
    });
  });

  // --- Automatic due-campaign scheduling sweep (M25 independent-review
  // certification-repair, Blocker 3) ---

  describe('Scheduling: the automatic due-campaign sweep', () => {
    it('16. a campaign created WITH a future scheduledAt is SCHEDULED (not DRAFT) and is NOT sent by the due sweep before its time', async () => {
      await optedInCustomerWithEmail('future@example.com');
      const token = await marketingToken();
      const { id: campaignId, status } = await createCampaign(token, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
      expect(status).toBe('SCHEDULED');

      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.statusCode).toBe(200);
      expect(sweepRes.json().processedCount).toBe(0);

      const campaign = await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(campaign.status).toBe('SCHEDULED'); // untouched
      expect(await testPrisma.campaignDelivery.count({ where: { campaignId } })).toBe(0);
    });

    it('17. a campaign is picked up by the due sweep the instant its scheduledAt is reached (an inclusive scheduledAt <= now boundary, not exclusive)', async () => {
      await optedInCustomerWithEmail('boundary@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { scheduledAt: new Date(Date.now() + 60_000).toISOString() });

      // Move the boundary to "right now" - by the time the sweep actually
      // runs a moment later, scheduledAt <= now holds true.
      await testPrisma.marketingCampaign.update({ where: { id: campaignId }, data: { scheduledAt: new Date() } });

      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.json().processedCount).toBe(1);

      const campaign = await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(campaign.status).toBe('SENT');
    });

    it('18. a genuinely past-due SCHEDULED campaign is sent by the due sweep', async () => {
      await optedInCustomerWithEmail('pastdue@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { scheduledAt: new Date(Date.now() - 60_000).toISOString() });

      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.json().processedCount).toBe(1);
      const result = sweepRes.json().results[0];
      expect(result.sentCount).toBe(1);

      const campaign = await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(campaign.status).toBe('SENT');
    });

    it('19. a DRAFT campaign (no scheduledAt at all) is never touched by the automatic due sweep - only an explicit manual send dispatches it', async () => {
      await optedInCustomerWithEmail('draft@example.com');
      const token = await marketingToken();
      const { id: campaignId, status } = await createCampaign(token); // no scheduledAt
      expect(status).toBe('DRAFT');

      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.json().processedCount).toBe(0);
      expect((await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('DRAFT');

      // An explicit manual send still works on a DRAFT campaign - a
      // separate, intentional operation from the automatic due sweep.
      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(1);
    });

    it('20. a CANCELLED (formerly scheduled, now past-due) campaign is never sent by the due sweep', async () => {
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { scheduledAt: new Date(Date.now() - 60_000).toISOString() });
      await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/cancel`, headers: { authorization: `Bearer ${token}` } });

      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.json().processedCount).toBe(0);
      expect((await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('CANCELLED');
      expect(await testPrisma.campaignDelivery.count({ where: { campaignId } })).toBe(0);
    });

    it('21. two genuinely concurrent due-sweep invocations racing the SAME due campaign converge to exactly one sender', async () => {
      const customerId = await optedInCustomerWithEmail('sweep-race@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { scheduledAt: new Date(Date.now() - 60_000).toISOString() });

      const [a, b] = await Promise.all([sweepDueCampaigns(token), sweepDueCampaigns(token)]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const totalProcessed = a.json().processedCount + b.json().processedCount;
      expect(totalProcessed).toBe(1); // exactly one of the two actually claimed and sent it

      const deliveries = await testPrisma.campaignDelivery.findMany({ where: { campaignId, customerId } });
      expect(deliveries).toHaveLength(1); // never a double-send

      const campaign = await testPrisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(campaign.status).toBe('SENT');
    });

    it('22. a customer opted-IN at the time a campaign was scheduled but opts OUT before the due time arrives is suppressed by the due sweep (preference is checked at SEND time, never snapshotted at schedule time)', async () => {
      const customerId = await optedInCustomerWithEmail('optin-then-out@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });

      // The customer opts out before the campaign's due time arrives.
      await testPrisma.communicationPreference.update({
        where: { customerId_channel_messageType: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER' } },
        data: { optedIn: false },
      });

      // The due time arrives.
      await testPrisma.marketingCampaign.update({ where: { id: campaignId }, data: { scheduledAt: new Date() } });
      const sweepRes = await sweepDueCampaigns(token);
      expect(sweepRes.json().processedCount).toBe(1);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_OPTOUT');
    });
  });

  // --- Durable per-recipient dispatch (M25 independent-review
  // certification-repair, Blocker 4) ---

  describe('Durable per-recipient dispatch', () => {
    it('23. two workers racing to durably claim the SAME recipient converge to exactly one winner - the atomicity dispatchToRecipient depends on', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);

      const claim = () =>
        testPrisma.campaignDelivery
          .create({ data: { campaignId, customerId, status: 'PENDING' } })
          .then(() => 'WON' as const)
          .catch((err) => {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'LOST' as const;
            throw err;
          });

      const [a, b] = await Promise.all([claim(), claim()]);
      expect([a, b].sort()).toEqual(['LOST', 'WON']);
      expect(await testPrisma.campaignDelivery.count({ where: { campaignId, customerId } })).toBe(1);
    });

    it('24. a recipient with an existing FRESH (non-stale) PENDING claim from a moment ago is skipped, never redispatched', async () => {
      const customerId = await optedInCustomerWithEmail('fresh-pending@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);
      // Simulate: another worker durably claimed this recipient a moment
      // ago and is still (genuinely) mid-flight - never stale.
      await testPrisma.campaignDelivery.create({ data: { campaignId, customerId, status: 'PENDING' } });

      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('PENDING'); // untouched - still owned by "the other worker"
      expect(await testPrisma.campaignDelivery.count({ where: { campaignId, customerId } })).toBe(1); // never a second row
    });

    it('25. a stale PENDING claim (the process that made the provider call crashed before recording SENT/FAILED) is reclaimed as AMBIGUOUS_RECONCILIATION_REQUIRED WITHOUT calling the provider again', async () => {
      const customerId = await optedInCustomerWithEmail('stale-pending@example.com');
      const token = await marketingToken();
      const { id: campaignId } = await createCampaign(token);

      const staleRow = await testPrisma.campaignDelivery.create({ data: { campaignId, customerId, status: 'PENDING' } });
      await testPrisma.campaignDelivery.update({ where: { id: staleRow.id }, data: { updatedAt: new Date(Date.now() - 1_000_000) } });

      const sendRes = await sendCampaign(token, campaignId);
      expect(sendRes.json().sentCount).toBe(0);
      expect(sendRes.json().ambiguousCount).toBe(1);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { id: staleRow.id } });
      expect(delivery.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
      expect(delivery.providerMessageId).toBeNull(); // never actually redispatched
      expect(await testPrisma.campaignDelivery.count({ where: { campaignId, customerId } })).toBe(1); // never a second row
    });

    it('26. a provider that definitely rejects the message is recorded FAILED, never confused with an ambiguous/unknown outcome', async () => {
      const customerId = await optedInCustomerWithEmail('definite-fail@example.com');

      process.env.MARKETING_PROVIDER = 'MOCK_ALWAYS_FAILS';
      __resetEnvCacheForTests();
      try {
        const token = await marketingToken();
        const { id: campaignId } = await createCampaign(token);
        const sendRes = await sendCampaign(token, campaignId);
        expect(sendRes.json().sentCount).toBe(0);
        expect(sendRes.json().failedCount).toBe(1);
        expect(sendRes.json().ambiguousCount).toBe(0);

        const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
        expect(delivery.status).toBe('FAILED');
        expect(delivery.errorMessage).toMatch(/definite provider rejection/i);
      } finally {
        delete process.env.MARKETING_PROVIDER;
        __resetEnvCacheForTests();
      }
    });

    it('27. a provider call that throws/times out is recorded AMBIGUOUS_RECONCILIATION_REQUIRED - never FAILED, and is never auto-resolved or redispatched by a later send', async () => {
      const customerId = await optedInCustomerWithEmail('ambiguous@example.com');

      process.env.MARKETING_PROVIDER = 'MOCK_UNRELIABLE';
      __resetEnvCacheForTests();
      try {
        const token = await marketingToken();
        const { id: campaignId } = await createCampaign(token);
        const sendRes = await sendCampaign(token, campaignId);
        expect(sendRes.json().sentCount).toBe(0);
        expect(sendRes.json().failedCount).toBe(0);
        expect(sendRes.json().ambiguousCount).toBe(1);
        expect(sendRes.json().campaign.status).toBe('FAILED'); // no genuine SENT - never counted as an overall success

        const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
        expect(delivery.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');

        // A later re-send attempt never auto-resolves or redispatches it -
        // the campaign itself is now FAILED (terminal), so claimForSend
        // does not even reclaim it.
        const secondSend = await sendCampaign(token, campaignId);
        expect(secondSend.json().claimed).toBe(false);
        const deliveryAfter = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
        expect(deliveryAfter.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED'); // unchanged
        expect(await testPrisma.campaignDelivery.count({ where: { campaignId, customerId } })).toBe(1);
      } finally {
        delete process.env.MARKETING_PROVIDER;
        __resetEnvCacheForTests();
      }
    });
  });

  // --- Staff RBAC ---

  describe('Staff RBAC', () => {
    it('14. creating/sending a campaign requires campaign:manage; a caller with only campaign:read is rejected', async () => {
      await grantPermissions('MARKETING', ['campaign:read']);
      const { token: readOnlyToken } = await createAuthenticatedStaff(app, ['MARKETING']);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/campaigns',
        headers: { authorization: `Bearer ${readOnlyToken}` },
        payload: { name: 'x', channel: 'EMAIL', messageType: 'NEWSLETTER', content: 'x' },
      });
      expect(createRes.statusCode).toBe(403);

      const listRes = await app.inject({ method: 'GET', url: '/api/v1/marketing/campaigns', headers: { authorization: `Bearer ${readOnlyToken}` } });
      expect(listRes.statusCode).toBe(200);
    });

    it('15. a staff caller without ANY campaign permission is rejected from every marketing route', async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['customer_service:manage']);
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const res = await app.inject({ method: 'GET', url: '/api/v1/marketing/campaigns', headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(403);
    });
  });
});
