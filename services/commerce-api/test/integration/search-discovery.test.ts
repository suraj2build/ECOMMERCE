import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { STYLES_INDEX_UID } from '../../src/modules/search/index-service.js';

/**
 * M10 Search / Discovery (specs/09-search-discovery.md). Exercises the
 * real catalog-to-Meilisearch pipeline end to end against a real
 * Meilisearch instance (never a mock) - publish/price/stock changes,
 * facet filtering, sorting, ranking (pin/stock/recency), RBAC, and the
 * graceful negative-result paths.
 */
describe('Search / Discovery (M10)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    // Deterministic: converge index settings before any test runs, rather
    // than racing the fire-and-forget call app.ts makes at boot.
    await app.searchIndex.configureIndex();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await app.meilisearch.index(STYLES_INDEX_UID).deleteAllDocuments().waitTask();
  });

  /** Builds one fully-published, priced, in-stock style via the real HTTP API. */
  async function publishStyle(
    token: string,
    locationId: string,
    opts: {
      styleCode: string;
      name: string;
      brandId: string;
      categoryId: string;
      sizeId: string;
      sellingPrice: number;
      mrp?: number;
      onHand?: number;
      colourName?: string;
    },
  ): Promise<{ styleId: string; skuId: string }> {
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: opts.styleCode,
        name: opts.name,
        brandId: opts.brandId,
        categoryId: opts.categoryId,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const styleId = styleRes.json().id as string;

    const colourRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: opts.colourName ?? 'Black', colourCode: 'BLK' },
    });
    const colourId = colourRes.json().id as string;

    const skuRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/skus/generate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sizeIds: [opts.sizeId] },
    });
    const skuId = skuRes.json()[0].skuId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId, url: 'https://example.com/x.jpg' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/qa-check`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleId, mrp: opts.mrp ?? opts.sellingPrice, sellingPrice: opts.sellingPrice },
    });

    if (opts.onHand) {
      await testPrisma.inventoryBalance.create({
        data: { skuId, locationId, onHand: opts.onHand, reserved: 0 },
      });
      await app.searchIndex.indexStyleForSku(skuId);
    }

    return { styleId, skuId };
  }

  it('propagates a publish to the search index within the same request (no polling needed)', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const { styleId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-001',
      name: 'Oxford Shirt',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 1999,
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Oxford' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits.map((h: { id: string }) => h.id)).toContain(styleId);
  });

  it('removes a style from the index the instant it is unpublished', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const { styleId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-002',
      name: 'Unpublish Test Jacket',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 2999,
    });

    const before = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Jacket' });
    expect(before.json().hits.map((h: { id: string }) => h.id)).toContain(styleId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/unpublish`,
      headers: { authorization: `Bearer ${token}` },
    });

    const after = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Jacket' });
    expect(after.json().hits.map((h: { id: string }) => h.id)).not.toContain(styleId);
  });

  it('reflects a price change (base price and sort-by-price) immediately', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const { styleId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-003',
      name: 'Price Change Trousers',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 1500,
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleId, mrp: 1500, sellingPrice: 999 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Trousers' });
    const hit = res.json().hits.find((h: { id: string }) => h.id === styleId);
    expect(hit.sellingPrice).toBe(999);
  });

  it('propagates a stock change (inventory adjustment) to availability', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    await grantPermissions('WAREHOUSE_MANAGER', ['inventory:adjust', 'inventory:read']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { token: whToken } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const { styleId, skuId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-004',
      name: 'Stock Tracked Kurta',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 1200,
    });

    const initial = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Kurta' });
    expect(initial.json().hits.find((h: { id: string }) => h.id === styleId).inStock).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/adjustments',
      headers: { authorization: `Bearer ${whToken}` },
      payload: { skuId, locationId: location.id, quantityDelta: 10, reason: 'Initial stock load' },
    });

    const afterAdjust = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Kurta' });
    const hitAfterAdjust = afterAdjust.json().hits.find((h: { id: string }) => h.id === styleId);
    expect(hitAfterAdjust.inStock).toBe(true);
    expect(hitAfterAdjust.availableQuantity).toBe(10);
  });

  it('filters by category, brand, color, size, and price range', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();
    const otherCategory = await testPrisma.category.create({ data: { name: 'Other', slug: 'other-category' } });

    const cheap = await publishStyle(token, location.id, {
      styleCode: 'SRCH-F1',
      name: 'Cheap Tee',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 500,
      colourName: 'Red',
    });
    await publishStyle(token, location.id, {
      styleCode: 'SRCH-F2',
      name: 'Pricey Coat',
      brandId: brand.id,
      categoryId: otherCategory.id,
      sizeId: size.id,
      sellingPrice: 5000,
      colourName: 'Blue',
    });

    const byCategory = await app.inject({ method: 'GET', url: `/api/v1/storefront/search?category=${category.slug}` });
    const categoryIds = byCategory.json().hits.map((h: { id: string }) => h.id);
    expect(categoryIds).toContain(cheap.styleId);
    expect(categoryIds).toHaveLength(1);

    const byColor = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?color=Red' });
    expect(byColor.json().hits.map((h: { id: string }) => h.id)).toEqual([cheap.styleId]);

    const byPrice = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?priceMin=0&priceMax=1000' });
    expect(byPrice.json().hits.map((h: { id: string }) => h.id)).toEqual([cheap.styleId]);

    const byBrand = await app.inject({ method: 'GET', url: `/api/v1/storefront/search?brand=${encodeURIComponent(brand.name)}` });
    expect(byBrand.json().hits.length).toBe(2);
  });

  it('sorts by price ascending/descending and newest', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const a = await publishStyle(token, location.id, {
      styleCode: 'SRCH-S1',
      name: 'Sort Item A',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 300,
    });
    const b = await publishStyle(token, location.id, {
      styleCode: 'SRCH-S2',
      name: 'Sort Item B',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });

    const asc = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?sort=price_asc' });
    expect(asc.json().hits.map((h: { id: string }) => h.id)).toEqual([b.styleId, a.styleId]);

    const desc = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?sort=price_desc' });
    expect(desc.json().hits.map((h: { id: string }) => h.id)).toEqual([a.styleId, b.styleId]);
  });

  it('paginates results', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    for (let i = 0; i < 3; i += 1) {
      await publishStyle(token, location.id, {
        styleCode: `SRCH-P${i}`,
        name: `Page Item ${i}`,
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 100 + i,
      });
    }

    const page1 = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?pageSize=2&page=1' });
    expect(page1.json().hits.length).toBe(2);
    expect(page1.json().totalHits).toBe(3);
    expect(page1.json().totalPages).toBe(2);

    const page2 = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?pageSize=2&page=2' });
    expect(page2.json().hits.length).toBe(1);
  });

  it('returns a clean empty result for a keyword with no matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=NoSuchProductXYZ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits).toEqual([]);
    expect(res.json().totalHits).toBe(0);
  });

  it('returns a clean empty result for a filter combination yielding zero results', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    await publishStyle(token, location.id, {
      styleCode: 'SRCH-Z1',
      name: 'Zero Result Test',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 500,
      colourName: 'Green',
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?color=Green&priceMin=10000' });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits).toEqual([]);
  });

  it('ranks a merchandiser-pinned style above ordinary relevance ordering', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
      'catalog:search:pin',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const first = await publishStyle(token, location.id, {
      styleCode: 'SRCH-PIN1',
      name: 'Pin Ranking Alpha',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });
    const second = await publishStyle(token, location.id, {
      styleCode: 'SRCH-PIN2',
      name: 'Pin Ranking Beta',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });

    // Without a pin, both show up (order not asserted here).
    const before = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Pin%20Ranking' });
    expect(before.json().hits.map((h: { id: string }) => h.id).sort()).toEqual(
      [first.styleId, second.styleId].sort(),
    );

    await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/styles/${second.styleId}/pin`,
      headers: { authorization: `Bearer ${token}` },
    });

    const after = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Pin%20Ranking' });
    expect(after.json().hits[0].id).toBe(second.styleId);
  });

  it('deprioritizes but never hides an out-of-stock style', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const outOfStock = await publishStyle(token, location.id, {
      styleCode: 'SRCH-OOS',
      name: 'Stock Ranking Alpha',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });
    const inStock = await publishStyle(token, location.id, {
      styleCode: 'SRCH-INS',
      name: 'Stock Ranking Beta',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
      onHand: 5,
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Stock%20Ranking' });
    const ids = res.json().hits.map((h: { id: string }) => h.id);
    // Not hidden - both present.
    expect(ids).toContain(outOfStock.styleId);
    expect(ids).toContain(inStock.styleId);
    // But in-stock is ranked ahead.
    expect(ids.indexOf(inStock.styleId)).toBeLessThan(ids.indexOf(outOfStock.styleId));
  });

  it('rejects pinning without catalog:search:pin permission', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size, location } = await seedBrandAndLocation();
    const { styleId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-RBAC1',
      name: 'RBAC Pin Test',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/styles/${styleId}/pin`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a manual reindex without search:reindex permission, and rebuilds correctly for a caller who has it', async () => {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
      'search:reindex',
    ]);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { token: noPermToken } = await createAuthenticatedStaff(app, ['CATALOG']);
    await grantPermissions('CATALOG', ['product:read']);
    const { brand, category, size, location } = await seedBrandAndLocation();

    const { styleId } = await publishStyle(token, location.id, {
      styleCode: 'SRCH-REIDX',
      name: 'Reindex Target',
      brandId: brand.id,
      categoryId: category.id,
      sizeId: size.id,
      sellingPrice: 100,
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/search/reindex',
      headers: { authorization: `Bearer ${noPermToken}` },
    });
    expect(denied.statusCode).toBe(403);

    // Wipe the index directly (simulating drift) and prove reindexAll recovers it.
    await app.meilisearch.index(STYLES_INDEX_UID).deleteAllDocuments().waitTask();
    const goneRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Reindex' });
    expect(goneRes.json().hits).toEqual([]);

    const reindexRes = await app.inject({
      method: 'POST',
      url: '/api/v1/search/reindex',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reindexRes.statusCode).toBe(200);
    expect(reindexRes.json().indexed).toBeGreaterThanOrEqual(1);

    const recoveredRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/search?q=Reindex' });
    expect(recoveredRes.json().hits.map((h: { id: string }) => h.id)).toContain(styleId);
  });
});
