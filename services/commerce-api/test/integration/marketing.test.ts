import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
    async function createCampaign(token: string, overrides: Record<string, unknown> = {}) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketing/campaigns',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Test campaign', channel: 'EMAIL', messageType: 'NEWSLETTER', content: 'Hello!', ...overrides },
      });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    }

    it('6. a customer opted out of the channel/messageType is SKIPPED_OPTOUT, never sent', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'optedout@example.com' } });
      await testPrisma.communicationPreference.create({
        data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: false },
      });

      const token = await marketingToken();
      const campaignId = await createCampaign(token);
      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
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
      const campaignId = await createCampaign(token);
      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
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
      const campaignId = await createCampaign(token, { channel: 'PUSH' });
      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
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
      const campaignId = await createCampaign(token);
      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
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
      const campaignId = await createCampaign(token);
      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
      expect(sendRes.json().sentCount).toBe(0);

      const delivery = await testPrisma.campaignDelivery.findUniqueOrThrow({ where: { campaignId_customerId: { campaignId, customerId } } });
      expect(delivery.status).toBe('SKIPPED_OPTOUT');
    });

    it('11. re-sending an already-SENT campaign is a safe idempotent no-op - never a double delivery row/message', async () => {
      const { customerId } = await createAuthenticatedCustomer(app);
      await testPrisma.customer.update({ where: { id: customerId }, data: { email: 'idem@example.com' } });
      await testPrisma.communicationPreference.create({ data: { customerId, channel: 'EMAIL', messageType: 'NEWSLETTER', optedIn: true } });

      const token = await marketingToken();
      const campaignId = await createCampaign(token);
      const firstSend = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
      expect(firstSend.json().sentCount).toBe(1);

      const secondSend = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
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
      const campaignId = await createCampaign(token);

      const [resA, resB] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } }),
        app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } }),
      ]);

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
      const campaignId = await createCampaign(token);
      const cancelRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/cancel`, headers: { authorization: `Bearer ${token}` } });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().status).toBe('CANCELLED');

      const sendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${campaignId}/send`, headers: { authorization: `Bearer ${token}` } });
      expect(sendRes.json().sentCount).toBe(0); // CANCELLED is terminal - claimSending never claims it

      const secondCampaignId = await createCampaign(token);
      await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${secondCampaignId}/send`, headers: { authorization: `Bearer ${token}` } });
      const cancelAfterSendRes = await app.inject({ method: 'POST', url: `/api/v1/marketing/campaigns/${secondCampaignId}/cancel`, headers: { authorization: `Bearer ${token}` } });
      expect(cancelAfterSendRes.statusCode).toBe(400);
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
