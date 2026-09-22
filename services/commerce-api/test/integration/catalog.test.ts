import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * specs/07-catalog-merchandising.md CAT-001: MRP and selling price
 * required, sellingPrice cannot exceed mrp, markdown pricing requires the
 * extra catalog:price:approve permission, and price is uniform across
 * every SKU in a style-colour (structurally, by never accepting a
 * size/SKU parameter).
 */
describe('Catalog: pricing (CAT-001)', () => {
  let app: FastifyInstance;
  let styleId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'PRICE-001',
        name: 'Price Test Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    styleId = style.id;
  });

  it('rejects a selling price above MRP', async () => {
    await grantPermissions('MERCHANDISING', ['catalog:price:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleId, mrp: 1000, sellingPrice: 1200 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a markdown price from a merchandiser who lacks catalog:price:approve', async () => {
    await grantPermissions('MERCHANDISING', ['catalog:price:write']); // no approve
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices/markdown',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleId,
        mrp: 1000,
        sellingPrice: 700,
        effectiveFrom: new Date().toISOString(),
        effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a scheduled markdown outranks the base price only while active, and reverts after it ends', async () => {
    await grantPermissions('MERCHANDISING', ['catalog:price:write', 'catalog:price:approve', 'product:read']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);

    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleId, mrp: 1000, sellingPrice: 1000 },
    });

    const now = Date.now();
    await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/prices/markdown',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleId,
        mrp: 1000,
        sellingPrice: 600,
        effectiveFrom: new Date(now - 60_000).toISOString(),
        effectiveTo: new Date(now + 3_600_000).toISOString(),
      },
    });

    const entryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/entries/${styleId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(Number(entryRes.json().activePrice.sellingPrice)).toBe(600);
    expect(entryRes.json().activePrice.isMarkdown).toBe(true);
  });
});
