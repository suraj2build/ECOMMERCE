import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';

/**
 * Public (unauthenticated) storefront read routes added for M09's Home
 * page (specs/08-storefront.md): must never leak a DRAFT/unpublished
 * style or a published style with no active price, and must require no
 * auth at all - this is the customer-facing read path.
 */
describe('Public storefront read routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  it('excludes an unpublished (DRAFT) style even with a price set', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'PUB-DRAFT', name: 'Draft Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    await testPrisma.price.create({ data: { styleId: style.id, mrp: 1000, sellingPrice: 900, effectiveFrom: new Date(Date.now() - 1000) } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).not.toContain(style.id);
  });

  it('excludes a PUBLISHED style that has no active price', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'PUB-NOPRICE',
        name: 'No Price Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).not.toContain(style.id);
  });

  it('includes a PUBLISHED style with an active price, no auth required', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'PUB-OK',
        name: 'Visible Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await testPrisma.price.create({ data: { styleId: style.id, mrp: 1200, sellingPrice: 999, effectiveFrom: new Date(Date.now() - 1000) } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' });
    expect(res.statusCode).toBe(200);
    const entry = res.json().find((s: { id: string }) => s.id === style.id);
    expect(entry).toBeDefined();
    expect(entry.sellingPrice).toBe('999');
    expect(entry.brandName).toBe(brand.name);
  });

  it('excludes an inactive collection', async () => {
    const collection = await testPrisma.collection.create({
      data: { name: 'Retired Capsule', slug: 'retired-capsule', isActive: false },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/collections' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { id: string }) => c.id)).not.toContain(collection.id);
  });

  it('includes an active collection', async () => {
    const collection = await testPrisma.collection.create({
      data: { name: 'Live Capsule', slug: 'live-capsule', isActive: true },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/collections' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { id: string }) => c.id)).toContain(collection.id);
  });
});
