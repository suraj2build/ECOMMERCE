import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { enterProductionEnv } from '../helpers/production-env.js';
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
    const { brand, category, size, location } = await seedBrandAndLocation();
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
    return { style, colour, size, sku, location };
  }

  /**
   * Seeds a real InventoryBalance row for a SKU - the SAME ledger table
   * (M06) both the certified public PDP and, as of this repair, Channel
   * Publishing read to compute sellable availability. No channel test
   * anywhere in this file fabricates availability directly; every
   * in_stock/out_of_stock assertion traces back to a real onHand/reserved
   * row here.
   */
  async function seedInventory(skuId: string, locationId: string, onHand: number, reserved = 0) {
    await testPrisma.inventoryBalance.create({ data: { skuId, locationId, onHand, reserved } });
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
    const { sku, location } = await fixtureSku({ price: 1499 });
    await seedInventory(sku.id, location.id, 10);
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

  it('records a genuine provider-call exception (outage) as AMBIGUOUS_RECONCILIATION_REQUIRED, never a definite FAILED (independent-review repair, finding #2)', async () => {
    const { sku, location } = await fixtureSku();
    await seedInventory(sku.id, location.id, 5);
    const service = new ChannelService(app);
    const channel = await service.createChannel({ key: 'unreliable', name: 'Unreliable', providerName: 'MOCK_UNRELIABLE' }, staffId);
    const listing = await service.publishSku(channel.id, sku.id, staffId);
    expect(listing.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
    expect(listing.lastError).toMatch(/outage/);
    expect(listing.retryCount).toBe(1);

    const attempts = await service.listAttempts(listing.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
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

  /**
   * M26 INDEPENDENT-REVIEW CERTIFICATION REPAIR (2026-09-28). Two
   * blockers: (1) `availability` was fabricated ('in_stock'
   * unconditionally) instead of derived from canonical inventory; (2) a
   * thrown/timed-out provider call was recorded as an ordinary definite
   * FAILURE instead of an honest AMBIGUOUS_RECONCILIATION_REQUIRED. This
   * section proves both repairs plus the durable-claim/concurrency/
   * idempotency/reconciliation/security work the repair required.
   */
  describe('independent-review certification repair (2026-09-28)', () => {
    describe('inventory truth', () => {
      it('a SKU with no InventoryBalance row at all is out_of_stock, never fabricated in_stock', async () => {
        const { sku } = await fixtureSku();
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'zero-inv', name: 'Zero Inv', providerName: 'MOCK' }, staffId);
        const item = await service.previewFeedItem(channel.id, sku.id);
        expect(item.availability).toBe('out_of_stock');
      });

      it('a SKU with onHand=0 explicitly is out_of_stock', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 0);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'zero-onhand', name: 'Zero OnHand', providerName: 'MOCK' }, staffId);
        const item = await service.previewFeedItem(channel.id, sku.id);
        expect(item.availability).toBe('out_of_stock');
      });

      it('a SKU with onHand > 0 but fully reserved is out_of_stock - never claims in_stock when nothing is actually sellable', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 10, 10);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'fully-reserved', name: 'Fully Reserved', providerName: 'MOCK' }, staffId);
        const item = await service.previewFeedItem(channel.id, sku.id);
        expect(item.availability).toBe('out_of_stock');
      });

      it('cross-location sellable inventory is aggregated correctly - a fully-reserved location and a sellable location combine into one true figure', async () => {
        const { sku, location } = await fixtureSku();
        const location2 = await testPrisma.location.create({ data: { code: 'TEST-WH-02', name: 'Second Warehouse', type: 'WAREHOUSE' } });
        await seedInventory(sku.id, location.id, 5, 5); // fully reserved here
        await seedInventory(sku.id, location2.id, 3, 0); // 3 genuinely sellable here
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'cross-loc', name: 'Cross Location', providerName: 'MOCK' }, staffId);
        const item = await service.previewFeedItem(channel.id, sku.id);
        expect(item.availability).toBe('in_stock');
      });

      it('a catalog-publishable SKU with zero stock still publishes successfully as out_of_stock - publishability and stock level are kept separate, no auto-unpublish-at-zero-stock policy is invented', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 0);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'zero-stock-publish', name: 'Zero Stock Publish', providerName: 'MOCK' }, staffId);
        const listing = await service.publishSku(channel.id, sku.id, staffId);
        expect(listing.status).toBe('PUBLISHED');
        expect((listing.payloadSnapshot as { availability: string }).availability).toBe('out_of_stock');
      });

      it('no channel operation writes canonical inventory - InventoryBalance is byte-for-byte unchanged after publish, unpublish, and a resync sweep', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 7, 2);
        const before = await testPrisma.inventoryBalance.findUniqueOrThrow({
          where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
        });
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'no-write', name: 'No Write', providerName: 'MOCK' }, staffId);
        await service.publishSku(channel.id, sku.id, staffId);
        await service.unpublishSku(channel.id, sku.id, staffId);
        await service.resyncStaleListings(staffId);
        const after = await testPrisma.inventoryBalance.findUniqueOrThrow({
          where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
        });
        expect(after.onHand).toBe(before.onHand);
        expect(after.reserved).toBe(before.reserved);
      });
    });

    describe('stale channel projection detection and resync', () => {
      it('detects and corrects a PUBLISHED listing whose availability drifted after inventory changed, and recovers when stock returns', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 5);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'drift', name: 'Drift', providerName: 'MOCK' }, staffId);
        const published = await service.publishSku(channel.id, sku.id, staffId);
        expect((published.payloadSnapshot as { availability: string }).availability).toBe('in_stock');

        // A real sale/adjustment changes canonical inventory - never a
        // channel write, and never synchronous with this update.
        await testPrisma.inventoryBalance.update({
          where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
          data: { onHand: 0 },
        });

        const firstSweep = await service.resyncStaleListings(staffId);
        expect(firstSweep.resynced).toBe(1);
        expect(firstSweep.listingIds).toContain(published.id);
        const afterFirst = await testPrisma.channelListing.findUniqueOrThrow({ where: { id: published.id } });
        expect((afterFirst.payloadSnapshot as { availability: string }).availability).toBe('out_of_stock');

        // A second sweep with no further inventory change is a safe no-op.
        const secondSweep = await service.resyncStaleListings(staffId);
        expect(secondSweep.resynced).toBe(0);

        // Stock returns - the sweep detects and corrects the drift back.
        await testPrisma.inventoryBalance.update({
          where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
          data: { onHand: 5 },
        });
        const thirdSweep = await service.resyncStaleListings(staffId);
        expect(thirdSweep.resynced).toBe(1);
        const afterThird = await testPrisma.channelListing.findUniqueOrThrow({ where: { id: published.id } });
        expect((afterThird.payloadSnapshot as { availability: string }).availability).toBe('in_stock');
      });
    });

    describe('provider outcomes: ambiguous vs definite', () => {
      it('a genuine provider-call exception on UNPUBLISH is recorded as AMBIGUOUS_RECONCILIATION_REQUIRED, never a definite FAILED', async () => {
        const { sku } = await fixtureSku();
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'unreliable-unpub', name: 'Unreliable Unpub', providerName: 'MOCK_UNRELIABLE' }, staffId);
        // Manufactured directly: MOCK_UNRELIABLE always throws on publish
        // too, so the real publish path can never itself reach PUBLISHED
        // for this provider. This simulates "was published earlier while
        // the provider was reachable; the provider is down now."
        const listing = await testPrisma.channelListing.create({
          data: { channelId: channel.id, skuId: sku.id, status: 'PUBLISHED', externalId: 'ext-123', lastSyncedAt: new Date() },
        });

        const result = await service.unpublishSku(channel.id, sku.id, staffId);
        expect(result.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
        expect(result.lastError).toMatch(/outage/);

        const attempts = await service.listAttempts(listing.id);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]!.action).toBe('UNPUBLISH');
        expect(attempts[0]!.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
      });

      it('an operator-safe retry of unpublish after an ambiguous outcome is allowed, never permanently blocked', async () => {
        const { sku } = await fixtureSku();
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'unreliable-retry', name: 'Unreliable Retry', providerName: 'MOCK_UNRELIABLE' }, staffId);
        await testPrisma.channelListing.create({
          data: { channelId: channel.id, skuId: sku.id, status: 'PUBLISHED', externalId: 'ext-456', lastSyncedAt: new Date() },
        });
        const first = await service.unpublishSku(channel.id, sku.id, staffId);
        expect(first.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');

        // Retry - the row's currentOperationId (and so the provider-facing
        // idempotency key derived from it) is REUSED, not re-minted, since
        // this is reconciling the SAME still-open ambiguous operation
        // (Blocker 1 repair, 2026-09-29 - see the dedicated "provider
        // idempotency operation identity" describe block below for the
        // direct proof). Still ambiguous since the same unreliable
        // provider answers again, but crucially the retry path itself is
        // proven open, not permanently rejected as "not published."
        const second = await service.unpublishSku(channel.id, sku.id, staffId);
        expect(second.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
        expect(second.retryCount).toBe(2);
      });

      it('a listing whose very first publish attempt ended ambiguous (no externalId ever obtained) cannot be unpublished - genuinely nothing known to remove', async () => {
        const { sku } = await fixtureSku();
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'never-published', name: 'Never Published', providerName: 'MOCK_UNRELIABLE' }, staffId);
        const listing = await service.publishSku(channel.id, sku.id, staffId);
        expect(listing.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
        expect(listing.externalId).toBeNull();

        await expect(service.unpublishSku(channel.id, sku.id, staffId)).rejects.toThrow();
      });
    });

    describe('durability', () => {
      it('a provider success is recorded exactly once - exactly one SUCCESS attempt row per publish call', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 5);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'exactly-once', name: 'Exactly Once', providerName: 'MOCK' }, staffId);
        const listing = await service.publishSku(channel.id, sku.id, staffId);
        const attempts = await service.listAttempts(listing.id);
        expect(attempts.filter((a) => a.status === 'SUCCESS')).toHaveLength(1);
      });

      it('a claim exists durably before any provider call - a stale PROCESSING claim (simulating a crash between dispatch and recording an outcome) is reclaimed as AMBIGUOUS_RECONCILIATION_REQUIRED by the sweep, never left stuck forever', async () => {
        const { sku } = await fixtureSku();
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'stale-claim', name: 'Stale Claim', providerName: 'MOCK' }, staffId);
        // Manufacture the crash scenario directly: a listing claimed
        // PROCESSING whose updatedAt is already older than the stale
        // cutoff - the same idiom this codebase's other stale-claim
        // tests (Refund/Marketing) already use, since a real process
        // crash cannot be simulated in-process.
        const stale = await testPrisma.channelListing.create({
          data: { channelId: channel.id, skuId: sku.id, status: 'PROCESSING' },
        });
        await testPrisma.$executeRaw`UPDATE "channel_listings" SET "updatedAt" = NOW() - INTERVAL '1 hour' WHERE "id" = ${stale.id}`;

        const sweep = await service.reclaimStaleProcessing(staffId);
        expect(sweep.reclaimed).toBe(1);

        const reclaimed = await testPrisma.channelListing.findUniqueOrThrow({ where: { id: stale.id } });
        expect(reclaimed.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
        expect(reclaimed.retryCount).toBe(1);

        // A second sweep run is a safe no-op - nothing left to reclaim.
        const secondSweep = await service.reclaimStaleProcessing(staffId);
        expect(secondSweep.reclaimed).toBe(0);
      });

      it('a claim resolving to a provider configuration failure (unknown/guarded provider) is recorded as a DEFINITE FAILED, never left stuck at PROCESSING', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 5);
        const service = new ChannelService(app);
        const channel = await testPrisma.channel.create({
          data: { key: 'unknown-provider', name: 'Unknown Provider', providerName: 'DOES_NOT_EXIST' },
        });
        const listing = await service.publishSku(channel.id, sku.id, staffId);
        expect(listing.status).toBe('FAILED');
        expect(listing.lastError).toMatch(/no such provider is registered/);
      });
    });

    describe('concurrency (real PostgreSQL)', () => {
      it('two genuinely concurrent publish requests for the same channel+SKU converge to at most one provider dispatch', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 5);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'concurrent-pub', name: 'Concurrent Pub', providerName: 'MOCK' }, staffId);

        // MockChannelProvider completes essentially instantly (no real
        // network latency), so two Promise.all-fired publishSku() calls
        // are NOT guaranteed to genuinely overlap at the claim step -
        // Node may fully sequence the first call's short-lived
        // PROCESSING claim + provider call + release before the second
        // even reaches claimProcessing, and a SECOND, later, non-
        // overlapping call is a legitimate independent resync (allowed
        // by design - `resyncStaleListings` and an operator's manual
        // re-publish both depend on exactly this). To test the real
        // invariant deterministically - a request that arrives WHILE
        // another is genuinely in-flight converges without a second
        // dispatch - this manufactures that precondition directly
        // (the same technique the durability describe block above uses
        // for the stale-claim scenario, since a real process-level race
        // window cannot be forced through an in-process mock provider).
        const inFlight = await testPrisma.channelListing.create({
          data: { channelId: channel.id, skuId: sku.id, status: 'PROCESSING' },
        });

        const result = await service.publishSku(channel.id, sku.id, staffId);
        // Converges to the in-flight claim - no provider call, no
        // attempt recorded, status left exactly as the "other worker"
        // holding the claim left it.
        expect(result.id).toBe(inFlight.id);
        expect(result.status).toBe('PROCESSING');
        const attempts = await service.listAttempts(inFlight.id);
        expect(attempts).toHaveLength(0);
      });

      it('two genuinely concurrent unpublish requests converge to at most one provider dispatch', async () => {
        const { sku, location } = await fixtureSku();
        await seedInventory(sku.id, location.id, 5);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'concurrent-unpub', name: 'Concurrent Unpub', providerName: 'MOCK' }, staffId);
        const published = await service.publishSku(channel.id, sku.id, staffId);
        expect(published.status).toBe('PUBLISHED');

        const results = await Promise.allSettled([
          service.unpublishSku(channel.id, sku.id, staffId),
          service.unpublishSku(channel.id, sku.id, staffId),
        ]);
        // Either both settle without throwing (one did the real work,
        // the other converged to the in-flight or already-completed
        // state), or the loser rejects with a ValidationError because by
        // the time it won its OWN claim the winner had already finished
        // - both are correct outcomes. The invariant under test is "at
        // most one provider dispatch," not "both calls always resolve."
        for (const r of results) {
          if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(Error);
        }

        const listings = await service.listListings(channel.id);
        expect(listings[0]!.status).toBe('NOT_PUBLISHED');

        const attempts = await service.listAttempts(published.id);
        const unpublishAttempts = attempts.filter((a) => a.action === 'UNPUBLISH');
        expect(unpublishAttempts).toHaveLength(1);
        expect(unpublishAttempts[0]!.status).toBe('SUCCESS');
      });
    });

    describe('security', () => {
      it('rejects a publish attempt from staff without channel:manage', async () => {
        const { sku } = await fixtureSku();
        const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
        await grantPermissions('CUSTOMER_SERVICE', ['channel:read']);
        const service = new ChannelService(app);
        const channel = await service.createChannel({ key: 'rbac-publish', name: 'RBAC Publish', providerName: 'MOCK' }, staffId);
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/channels/${channel.id}/skus/${sku.id}/publish`,
          headers: auth(token),
        });
        expect(res.statusCode).toBe(403);
      });

      it('rejects reconciliation sweep calls from staff without channel:manage', async () => {
        const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
        await grantPermissions('CUSTOMER_SERVICE', ['channel:read']);
        const reclaimRes = await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/reclaim-stale', headers: auth(token) });
        expect(reclaimRes.statusCode).toBe(403);
        const resyncRes = await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/resync-stale', headers: auth(token) });
        expect(resyncRes.statusCode).toBe(403);
      });

      it('a staff user WITH channel:manage can call both reconciliation sweeps successfully', async () => {
        const { token } = await manageStaff();
        const reclaimRes = await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/reclaim-stale', headers: auth(token) });
        expect(reclaimRes.statusCode).toBe(200);
        expect(reclaimRes.json()).toEqual({ reclaimed: 0 });
        const resyncRes = await app.inject({ method: 'POST', url: '/api/v1/channels/sweep/resync-stale', headers: auth(token) });
        expect(resyncRes.statusCode).toBe(200);
        expect(resyncRes.json()).toEqual({ resynced: 0, listingIds: [] });
      });

      it('never resolves a MOCK_* provider in production - the smallest explicit guard against a mock silently acting as a real channel integration', async () => {
        const restoreEnv = enterProductionEnv();
        try {
          const { sku, location } = await fixtureSku();
          await seedInventory(sku.id, location.id, 5);
          const service = new ChannelService(app);
          const channel = await service.createChannel({ key: 'prod-guard', name: 'Prod Guard', providerName: 'MOCK' }, staffId);
          const listing = await service.publishSku(channel.id, sku.id, staffId);
          // Resolving the provider itself fails (never reaches an
          // external call) - a DEFINITE, known failure, never a crash
          // and never a silent MOCK success in production.
          expect(listing.status).toBe('FAILED');
          expect(listing.lastError).toMatch(/test double.*may never be used in production/);
        } finally {
          restoreEnv();
        }
      });
    });
  });

  /**
   * M26 INDEPENDENT-REVIEW CERTIFICATION REPAIR (2026-09-29), Blocker 1:
   * the provider-facing idempotencyKey was `${channelId}:${skuId}` for
   * BOTH publish and unpublish, reused verbatim across every publish/
   * resync/unpublish call for a listing - a real provider implementing
   * idempotency could conflate an initial publish, a later resync after
   * a price/availability change, and an unpublish as the same already-
   * processed operation. Fixed with a durable, pre-dispatch operation
   * identity (`ChannelListing.currentOperationId`, minted inside
   * claimProcessing's own transaction) that is REUSED only when
   * reconciling/retrying the SAME still-open operation and MINTED FRESH
   * for every genuinely new one; the key is now
   * `${channelId}:${skuId}:${action}:${currentOperationId}`.
   */
  describe('independent-review certification repair (2026-09-29) - Blocker 1: provider idempotency operation identity', () => {
    async function lastAttempt(channelListingId: string, action: 'PUBLISH' | 'UNPUBLISH') {
      const attempts = await testPrisma.channelPublicationAttempt.findMany({
        where: { channelListingId, action },
        orderBy: { attemptedAt: 'desc' },
      });
      return attempts[0]!;
    }

    it('A. a normal publish-then-unpublish sequence records the two attempts under different operationIds', async () => {
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5);
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-a', name: 'Op Id A', providerName: 'MOCK' }, staffId);

      const published = await service.publishSku(channel.id, sku.id, staffId);
      expect(published.currentOperationId).toBeTruthy();
      const publishAttempt = await lastAttempt(published.id, 'PUBLISH');
      expect(publishAttempt.operationId).toBe(published.currentOperationId);

      const unpublished = await service.unpublishSku(channel.id, sku.id, staffId);
      const unpublishAttempt = await lastAttempt(unpublished.id, 'UNPUBLISH');
      expect(unpublishAttempt.operationId).toBeTruthy();
      // A fresh, unrelated operation - unpublish claimed from the
      // SETTLED PUBLISHED state, never a reconciliation of the publish.
      expect(unpublishAttempt.operationId).not.toBe(publishAttempt.operationId);
    });

    it('A. even when an operationId is legitimately REUSED across a reconciliation, the action component keeps publish and unpublish identities distinct - proving the composite key can never collide', async () => {
      // A publish succeeds, then a LATER unpublish attempt goes ambiguous
      // (provider outage) - the listing's currentOperationId is now the
      // UNPUBLISH attempt's own id, with externalId still set (an
      // ambiguous outcome never clears it - the provider may not have
      // actually removed the listing). Reconciling FROM
      // AMBIGUOUS_RECONCILIATION_REQUIRED via a PUBLISH call (a real,
      // code-permitted path - claimProcessing does not restrict which
      // action may reconcile an ambiguous state) REUSES that SAME
      // operationId. This is the one scenario where the SAME numeric
      // operationId is used for both a PUBLISH and an UNPUBLISH attempt -
      // exactly the case the `action` component of the key exists to
      // guard against.
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5);
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-a2', name: 'Op Id A2', providerName: 'MOCK' }, staffId);
      const published = await service.publishSku(channel.id, sku.id, staffId);
      expect(published.status).toBe('PUBLISHED');

      // Manufacture the "unpublish went ambiguous" state directly - the
      // real MOCK provider never throws, so this simulates what
      // MOCK_UNRELIABLE would have left behind after a real unpublish
      // attempt on this exact listing (same technique the 2026-09-28
      // repair's own ambiguous-outcome tests already use).
      const ambiguousOpId = 'manufactured-unpublish-op-id';
      await testPrisma.channelListing.update({
        where: { id: published.id },
        data: { status: 'AMBIGUOUS_RECONCILIATION_REQUIRED', currentOperationId: ambiguousOpId, retryCount: { increment: 1 } },
      });
      await testPrisma.channelPublicationAttempt.create({
        data: {
          channelListingId: published.id,
          action: 'UNPUBLISH',
          status: 'AMBIGUOUS_RECONCILIATION_REQUIRED',
          errorMessage: 'Simulated channel provider outage - outcome unknown',
          actorStaffId: staffId,
          operationId: ambiguousOpId,
        },
      });

      // Reconcile via publishSku - claimProcessing sees previousStatus
      // AMBIGUOUS_RECONCILIATION_REQUIRED and REUSES ambiguousOpId.
      const reconciled = await service.publishSku(channel.id, sku.id, staffId);
      expect(reconciled.currentOperationId).toBe(ambiguousOpId);
      const publishAttempt = await lastAttempt(reconciled.id, 'PUBLISH');
      expect(publishAttempt.operationId).toBe(ambiguousOpId);

      // The SAME operationId now backs both an UNPUBLISH attempt and a
      // PUBLISH attempt for this listing - only the `action` component
      // of the composite key keeps their external identities separate.
      const unpublishAttempt = await lastAttempt(reconciled.id, 'UNPUBLISH');
      expect(unpublishAttempt.operationId).toBe(ambiguousOpId);
      expect(unpublishAttempt.action).not.toBe(publishAttempt.action);
    });

    it('B. retrying the SAME ambiguous logical publish operation preserves its operationId across every retry', async () => {
      const { sku } = await fixtureSku();
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-b', name: 'Op Id B', providerName: 'MOCK_UNRELIABLE' }, staffId);

      const first = await service.publishSku(channel.id, sku.id, staffId);
      expect(first.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
      const firstOpId = first.currentOperationId;
      expect(firstOpId).toBeTruthy();

      const second = await service.publishSku(channel.id, sku.id, staffId);
      expect(second.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
      expect(second.currentOperationId).toBe(firstOpId);

      const third = await service.publishSku(channel.id, sku.id, staffId);
      expect(third.currentOperationId).toBe(firstOpId);

      // Every recorded attempt for this listing shares the one operationId.
      const attempts = await testPrisma.channelPublicationAttempt.findMany({ where: { channelListingId: first.id } });
      expect(attempts).toHaveLength(3);
      expect(attempts.every((a) => a.operationId === firstOpId)).toBe(true);
    });

    it('B. retrying the SAME ambiguous logical unpublish operation preserves its operationId', async () => {
      const { sku } = await fixtureSku();
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-b-unpub', name: 'Op Id B Unpub', providerName: 'MOCK_UNRELIABLE' }, staffId);
      await testPrisma.channelListing.create({
        data: { channelId: channel.id, skuId: sku.id, status: 'PUBLISHED', externalId: 'ext-b-unpub', lastSyncedAt: new Date() },
      });

      const first = await service.unpublishSku(channel.id, sku.id, staffId);
      expect(first.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
      const firstOpId = first.currentOperationId;

      const second = await service.unpublishSku(channel.id, sku.id, staffId);
      expect(second.currentOperationId).toBe(firstOpId);

      const attempts = await testPrisma.channelPublicationAttempt.findMany({ where: { channelListingId: first.id, action: 'UNPUBLISH' } });
      expect(attempts.every((a) => a.operationId === firstOpId)).toBe(true);
    });

    it('C. a later legitimate resync of an already-PUBLISHED listing mints a NEW operation id, never reusing the original publish\'s', async () => {
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5);
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-c', name: 'Op Id C', providerName: 'MOCK' }, staffId);

      const firstPublish = await service.publishSku(channel.id, sku.id, staffId);
      expect(firstPublish.status).toBe('PUBLISHED');
      const firstOpId = firstPublish.currentOperationId;

      // A real resync scenario: stock changes, resyncStaleListings calls
      // publishSku again for the SAME channel+SKU.
      await testPrisma.inventoryBalance.update({
        where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
        data: { onHand: 0 },
      });
      const resync = await service.resyncStaleListings(staffId);
      expect(resync.resynced).toBe(1);

      const afterResync = await testPrisma.channelListing.findUniqueOrThrow({ where: { id: firstPublish.id } });
      expect(afterResync.currentOperationId).not.toBe(firstOpId);

      const attempts = await testPrisma.channelPublicationAttempt.findMany({
        where: { channelListingId: firstPublish.id, action: 'PUBLISH' },
        orderBy: { attemptedAt: 'asc' },
      });
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.operationId).toBe(firstOpId);
      expect(attempts[1]!.operationId).toBe(afterResync.currentOperationId);
      expect(attempts[0]!.operationId).not.toBe(attempts[1]!.operationId);
    });

    it('C. a retry after a DEFINITE FAILED (not ambiguous) also mints a new operation id, since the definite rejection genuinely closed the prior operation', async () => {
      const { sku } = await fixtureSku({ price: 0 }); // no price -> MockChannelProvider definitely rejects
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-c-failed', name: 'Op Id C Failed', providerName: 'MOCK' }, staffId);

      const first = await service.publishSku(channel.id, sku.id, staffId);
      expect(first.status).toBe('FAILED');
      const firstOpId = first.currentOperationId;
      expect(firstOpId).toBeTruthy();

      const second = await service.publishSku(channel.id, sku.id, staffId);
      expect(second.status).toBe('FAILED');
      expect(second.currentOperationId).not.toBe(firstOpId);
    });

    it('E. a stale PROCESSING claim reclaimed inline by a new request preserves the crashed attempt\'s own operationId, never mints a fresh one', async () => {
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5);
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-e', name: 'Op Id E', providerName: 'MOCK' }, staffId);

      // Manufacture a crash scenario: a listing claimed PROCESSING under
      // a known operationId, stuck (the process that made the provider
      // call died before recording any outcome), with updatedAt already
      // older than the stale cutoff.
      const crashedOpId = 'manufactured-crashed-op-id';
      const stale = await testPrisma.channelListing.create({
        data: { channelId: channel.id, skuId: sku.id, status: 'PROCESSING', currentOperationId: crashedOpId },
      });
      await testPrisma.$executeRaw`UPDATE "channel_listings" SET "updatedAt" = NOW() - INTERVAL '1 hour' WHERE "id" = ${stale.id}`;

      // A new publish request reclaims it INLINE (via claimProcessing
      // itself, not the separate sweep route) - this is the SAME crashed
      // operation being continued, so its operationId must be preserved.
      const result = await service.publishSku(channel.id, sku.id, staffId);
      expect(result.currentOperationId).toBe(crashedOpId);
      const attempt = await lastAttempt(result.id, 'PUBLISH');
      expect(attempt.operationId).toBe(crashedOpId);
    });

    it('D. two genuinely concurrent publish requests still converge to at most one dispatch, and the surviving claim carries exactly one operationId', async () => {
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5);
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-d', name: 'Op Id D', providerName: 'MOCK' }, staffId);

      // Same deterministic-precondition technique the 2026-09-28 repair's
      // own concurrency test uses (MockChannelProvider completes too
      // fast for a genuine Promise.all race to reliably overlap).
      const inFlightOpId = 'manufactured-in-flight-op-id';
      const inFlight = await testPrisma.channelListing.create({
        data: { channelId: channel.id, skuId: sku.id, status: 'PROCESSING', currentOperationId: inFlightOpId },
      });

      const result = await service.publishSku(channel.id, sku.id, staffId);
      // Converges to the in-flight claim - no second claim, no new
      // operationId minted, no attempt recorded by this losing call.
      expect(result.id).toBe(inFlight.id);
      expect(result.currentOperationId).toBe(inFlightOpId);
      const attempts = await service.listAttempts(inFlight.id);
      expect(attempts).toHaveLength(0);
    });

    it('F. resolving the operation identity never reads or writes canonical inventory/price/catalog - InventoryBalance is unchanged after a full retry/resync sequence', async () => {
      const { sku, location } = await fixtureSku();
      await seedInventory(sku.id, location.id, 5, 1);
      const before = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
      });
      const service = new ChannelService(app);
      const channel = await service.createChannel({ key: 'op-id-f', name: 'Op Id F', providerName: 'MOCK_UNRELIABLE' }, staffId);
      await service.publishSku(channel.id, sku.id, staffId); // ambiguous, mints an operationId
      await service.publishSku(channel.id, sku.id, staffId); // retries, reuses it
      const after = await testPrisma.inventoryBalance.findUniqueOrThrow({
        where: { skuId_locationId: { skuId: sku.id, locationId: location.id } },
      });
      expect(after.onHand).toBe(before.onHand);
      expect(after.reserved).toBe(before.reserved);
    });
  });
});
