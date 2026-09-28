import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { ChannelService } from '../../src/modules/channels/service.js';

/**
 * Social / Channel Publishing (M26, specs/25-social-channel-publishing.md,
 * CHAN-001) adversarial certification. Covers: the mock adapter
 * registration -> feed generation -> correct field-mapping proof required
 * by `acceptance/m26-social-channel-publishing.md`, per-channel-per-SKU
 * publishing status tracking with zero real channels connected, honest
 * validation/provider-failure recording (never a silent no-op), full
 * publication-attempt history, unpublish, and staff RBAC. No test here
 * ever asserts a marketplace-specific field on Style/Sku/Price - proving
 * the core Product Master schema stays untouched by channel concerns.
 */
describe('Channel Publishing (M26)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  let staffId: string;

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const { staffUserId } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    staffId = staffUserId;
  });

  async function fixtureSku(overrides: { lifecycleState?: string; price?: number; active?: boolean } = {}) {
    const { brand, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: {
        styleCode: `CHAN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Channel Test Tee',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: (overrides.lifecycleState as never) ?? 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({
      data: {
        skuCode: `${style.styleCode}-BLK-M`,
        styleId: style.id,
        colourId: colour.id,
        sizeId: size.id,
        isActive: overrides.active ?? true,
      },
    });
    if (overrides.price !== 0) {
      await testPrisma.price.create({
        data: { styleId: style.id, colourId: colour.id, mrp: 1999, sellingPrice: overrides.price ?? 999 },
      });
    }
    return { style, colour, size, sku };
  }

  async function manageStaff() {
    const { staffUserId, token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    await grantPermissions('MERCHANDISING', ['channel:manage', 'channel:read']);
    return { staffUserId, token };
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('registers a mock channel and generates a correctly field-mapped feed item from core catalog data', async () => {
    const { sku } = await fixtureSku({ price: 1499 });
    const service = new ChannelService(app);
    const channel = await service.createChannel(
      { key: 'test-mock', name: 'Test Mock Channel', providerName: 'MOCK', config: { titleTemplate: '{style.name} ({colour.name}/{size.label})' } },
      staffId,
    );

    const item = await service.previewFeedItem(channel.id, sku.id);
    expect(item.externalId).toBe(sku.skuCode);
    expect(item.title).toBe('Channel Test Tee (Black/M)');
    expect(item.price).toBe(1499);
    expect(item.currency).toBe('INR');
    expect(item.availability).toBe('in_stock');
  });

  it('uses the default field-mapping template when the channel config supplies none', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'defaults', name: 'Defaults Channel', providerName: 'MOCK' }, staffId);
    const item = await service.previewFeedItem(channel.id, sku.id);
    expect(item.title).toBe('Channel Test Tee - Black - M');
  });

  it('tracks publishing status per channel per SKU, even with a mock adapter only', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'status-track', name: 'Status Channel', providerName: 'MOCK' }, staffId);

    const before = await service.listListings(channel.id);
    expect(before).toHaveLength(0);

    const published = await service.publishSku(channel.id, sku.id, staffId);
    expect(published.status).toBe('PUBLISHED');
    expect(published.externalId).toMatch(/^mock-/);
    expect(published.lastSyncedAt).not.toBeNull();

    const after = await service.listListings(channel.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.skuId).toBe(sku.id);
  });

  it('records a FAILED status and a FAILURE attempt, never a silent skip, when the SKU is not channel-publishable', async () => {
    const { sku } = await fixtureSku({ lifecycleState: 'DRAFT' });
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'not-publishable', name: 'NP Channel', providerName: 'MOCK' }, staffId);

    const listing = await service.publishSku(channel.id, sku.id, staffId);
    expect(listing.status).toBe('FAILED');
    expect(listing.lastError).toMatch(/not channel-publishable/);

    const attempts = await service.listAttempts(listing.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('FAILURE');
    expect(attempts[0]!.action).toBe('PUBLISH');
  });

  it('records a FAILED status when the mock provider genuinely rejects the payload (no price)', async () => {
    const { sku } = await fixtureSku({ price: 0 });
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'no-price', name: 'No Price Channel', providerName: 'MOCK' }, staffId);
    const listing = await service.publishSku(channel.id, sku.id, staffId);
    expect(listing.status).toBe('FAILED');
  });

  it('records AlwaysFails provider rejections honestly with an incrementing retryCount across retries', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'always-fails', name: 'Always Fails', providerName: 'MOCK_ALWAYS_FAILS' }, staffId);

    const first = await service.publishSku(channel.id, sku.id, staffId);
    expect(first.status).toBe('FAILED');
    expect(first.retryCount).toBe(1);

    const second = await service.publishSku(channel.id, sku.id, staffId);
    expect(second.retryCount).toBe(2);

    const attempts = await service.listAttempts(first.id);
    expect(attempts).toHaveLength(2);
  });

  it('records a genuine provider-call exception (outage) as a FAILURE, never an unhandled crash', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'unreliable', name: 'Unreliable', providerName: 'MOCK_UNRELIABLE' }, staffId);
    const listing = await service.publishSku(channel.id, sku.id, staffId);
    expect(listing.status).toBe('FAILED');
    expect(listing.lastError).toMatch(/outage/);
  });

  it('unpublishes a published listing back to NOT_PUBLISHED and records the attempt', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'unpub', name: 'Unpub Channel', providerName: 'MOCK' }, staffId);
    const published = await service.publishSku(channel.id, sku.id, staffId);
    expect(published.status).toBe('PUBLISHED');

    const unpublished = await service.unpublishSku(channel.id, sku.id, staffId);
    expect(unpublished.status).toBe('NOT_PUBLISHED');

    const attempts = await service.listAttempts(published.id);
    expect(attempts.map((a) => a.action)).toEqual(expect.arrayContaining(['PUBLISH', 'UNPUBLISH']));
  });

  it('rejects unpublishing a listing that is not currently published', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'not-pub', name: 'Not Pub', providerName: 'MOCK' }, staffId);
    await expect(service.unpublishSku(channel.id, sku.id, staffId)).rejects.toThrow();
  });

  it('re-publishing an already-published SKU is idempotent (upserts the same listing row, no duplicate)', async () => {
    const { sku } = await fixtureSku();
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'idempotent', name: 'Idempotent', providerName: 'MOCK' }, staffId);
    await service.publishSku(channel.id, sku.id, staffId);
    await service.publishSku(channel.id, sku.id, staffId);
    const listings = await service.listListings(channel.id);
    expect(listings).toHaveLength(1);
  });

  it('rejects creating two channels with the same key', async () => {
    const service = new ChannelService(app);
    await service.createChannel({ key: 'dup', name: 'A', providerName: 'MOCK' }, staffId);
    await expect(service.createChannel({ key: 'dup', name: 'B', providerName: 'MOCK' }, staffId)).rejects.toThrow();
  });

  describe('routes + RBAC', () => {
    it('requires channel:manage to create a channel; channel:read alone is rejected', async () => {
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      await grantPermissions('CUSTOMER_SERVICE', ['channel:read']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/channels',
        headers: auth(token),
        payload: { key: 'rbac-test', name: 'RBAC Test', providerName: 'MOCK' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a staff user with channel:manage can create, publish, and read back the listing over HTTP', async () => {
      const { token } = await manageStaff();
      const { sku } = await fixtureSku();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/channels',
        headers: auth(token),
        payload: { key: 'http-flow', name: 'HTTP Flow', providerName: 'MOCK' },
      });
      expect(createRes.statusCode).toBe(201);
      const channelId = createRes.json().id as string;

      const previewRes = await app.inject({ method: 'GET', url: `/api/v1/channels/${channelId}/preview/${sku.id}`, headers: auth(token) });
      expect(previewRes.statusCode).toBe(200);
      expect(previewRes.json().externalId).toBe(sku.skuCode);

      const publishRes = await app.inject({
        method: 'POST',
        url: `/api/v1/channels/${channelId}/skus/${sku.id}/publish`,
        headers: auth(token),
      });
      expect(publishRes.statusCode).toBe(200);
      expect(publishRes.json().status).toBe('PUBLISHED');

      const listingsRes = await app.inject({ method: 'GET', url: `/api/v1/channels/${channelId}/listings`, headers: auth(token) });
      expect(listingsRes.json()).toHaveLength(1);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/channels' });
      expect(res.statusCode).toBe(401);
    });
  });
});
