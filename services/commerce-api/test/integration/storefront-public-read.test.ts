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

  async function publishedStyle(code: string, categoryId: string, brandId: string) {
    const style = await testPrisma.style.create({
      data: { styleCode: code, name: code, brandId, categoryId, season: 'SS26', collection: 'Core', lifecycleState: 'PUBLISHED', publishedAt: new Date() },
    });
    await testPrisma.price.create({ data: { styleId: style.id, mrp: 1000, sellingPrice: 900, effectiveFrom: new Date(Date.now() - 1000) } });
    return style;
  }

  it('uses the first colour image as the listing thumbnail when a style has only colour images', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const style = await publishedStyle('PUB-COLOUR-ONLY', category.id, brand.id);
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Navy', colourCode: 'NVY' } });
    await testPrisma.productMedia.create({ data: { styleId: style.id, colourId: colour.id, url: 'https://example.test/navy.jpg', sortOrder: 0 } });
    const collection = await testPrisma.collection.create({ data: { name: 'Colour Edit', slug: 'colour-edit', isActive: true } });
    await testPrisma.collectionStyle.create({ data: { collectionId: collection.id, styleId: style.id } });

    const styles = (await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' })).json();
    expect(styles.find((s: { id: string }) => s.id === style.id).thumbnailUrl).toBe('https://example.test/navy.jpg');
    const detail = (await app.inject({ method: 'GET', url: '/api/v1/storefront/collections/colour-edit' })).json();
    expect(detail.styleThumbnails).toEqual(['https://example.test/navy.jpg']);
    // A style-level image still wins over colour images.
    await testPrisma.productMedia.create({ data: { styleId: style.id, url: 'https://example.test/hero.jpg', sortOrder: 5 } });
    const again = (await app.inject({ method: 'GET', url: '/api/v1/storefront/styles' })).json();
    expect(again.find((s: { id: string }) => s.id === style.id).thumbnailUrl).toBe('https://example.test/hero.jpg');
  });

  it('pages through every active collection without skipping or repeating any', async () => {
    const created = new Set<string>();
    for (let i = 0; i < 9; i += 1) {
      created.add((await testPrisma.collection.create({ data: { name: `Edit ${i}`, slug: `edit-${i}`, isActive: true, createdAt: new Date('2026-10-01T00:00:00Z') } })).id);
    }
    const firstDefault = (await app.inject({ method: 'GET', url: '/api/v1/storefront/collections' })).json();
    expect(firstDefault).toHaveLength(6);
    const seen: string[] = [];
    for (let skip = 0; skip <= 40; skip += 4) { // bounded: a broken skip must fail, not spin
      const page = (await app.inject({ method: 'GET', url: `/api/v1/storefront/collections?take=4&skip=${skip}` })).json();
      seen.push(...page.map((c: { id: string }) => c.id));
      if (page.length < 4) break;
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen)).toEqual(created);
  });

  it('answers a category lookup with its visible-product count, and 404 for an unknown or inactive slug', async () => {
    const { brand, category } = await seedBrandAndLocation();
    await publishedStyle('PUB-CAT-1', category.id, brand.id);
    await testPrisma.style.create({ data: { styleCode: 'PUB-CAT-DRAFT', name: 'Draft', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' } });
    const ok = await app.inject({ method: 'GET', url: `/api/v1/storefront/categories/${category.slug}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ slug: category.slug, name: category.name, publishedStyleCount: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/storefront/categories/no-such-category' })).statusCode).toBe(404);
    await testPrisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    expect((await app.inject({ method: 'GET', url: `/api/v1/storefront/categories/${category.slug}` })).statusCode).toBe(404);
  });

  it('lists only categories that have storefront-visible products for the sitemap', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const empty = await testPrisma.category.create({ data: { name: 'Empty', slug: 'empty-cat' } });
    const draftOnly = await testPrisma.category.create({ data: { name: 'Draft only', slug: 'draft-only' } });
    await publishedStyle('PUB-SEO-1', category.id, brand.id);
    await publishedStyle('PUB-SEO-2', category.id, brand.id);
    await testPrisma.style.create({ data: { styleCode: 'PUB-SEO-DRAFT', name: 'Draft', brandId: brand.id, categoryId: draftOnly.id, season: 'SS26', collection: 'Core' } });
    const res = (await app.inject({ method: 'GET', url: '/api/v1/storefront/seo/categories' })).json();
    expect(res.map((c: { slug: string }) => c.slug)).toEqual([category.slug]);
    expect(res[0].publishedStyleCount).toBe(2);
    expect(res.map((c: { slug: string }) => c.slug)).not.toContain(empty.slug);
  });
});
