import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff, createAuthenticatedCustomer } from '../helpers/auth.js';

/**
 * M11 PDP (specs/10-pdp.md): the public product-detail aggregate read,
 * ratings/reviews (PDP-001), PIN-code serviceability static-list
 * fallback (IND-002), and cross-sell (PDP-002).
 */
describe('PDP (M11)', () => {
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

  /** Builds one fully-published, priced style via the real HTTP API. */
  async function publishStyle(
    token: string,
    opts: {
      styleCode: string;
      name: string;
      brandId: string;
      categoryId: string;
      sizeId: string;
      sellingPrice: number;
      mrp?: number;
      colourName?: string;
    },
  ): Promise<{ styleId: string; skuId: string; colourId: string }> {
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

    return { styleId, skuId, colourId };
  }

  async function merchandisingToken() {
    await grantPermissions('MERCHANDISING', [
      'product:read',
      'product:write',
      'product:publish',
      'catalog:price:write',
      'catalog:cross_sell:manage',
    ]);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  describe('GET /storefront/products/:styleId', () => {
    it('returns full product detail for a published, priced style', async () => {
      const token = await merchandisingToken();
      const { brand, category, size, location } = await seedBrandAndLocation();
      const { styleId, skuId } = await publishStyle(token, {
        styleCode: 'PDP-001',
        name: 'Classic Shirt',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1499,
      });
      await testPrisma.inventoryBalance.create({ data: { skuId, locationId: location.id, onHand: 8, reserved: 2 } });

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('Classic Shirt');
      expect(body.sellingPrice).toBe(1499);
      expect(body.variants).toHaveLength(1);
      expect(body.variants[0].availableQuantity).toBe(6);
      expect(body.variants[0].inStock).toBe(true);
      expect(body.ratingSummary).toEqual({ averageRating: null, reviewCount: 0 });
      expect(body.reviews).toEqual([]);
    });

    it('404s for an unpublished style (never distinguishable from unknown)', async () => {
      const { brand, category } = await seedBrandAndLocation();
      const style = await testPrisma.style.create({
        data: { styleCode: 'PDP-DRAFT', name: 'Draft', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });
      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${style.id}` });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a genuinely unknown id, same shape as an unpublished one', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/storefront/products/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('renders correctly (200, clear out-of-stock state) when every size is out of stock', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'PDP-OOS',
        name: 'Sold Out Jacket',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 2500,
      });
      // No inventory balance created at all - zero stock everywhere.

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().variants[0].inStock).toBe(false);
      expect(res.json().variants[0].availableQuantity).toBe(0);
    });

    it('includes the size chart attached to a SKU, correctly versioned', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId, skuId } = await publishStyle(token, {
        styleCode: 'PDP-CHART',
        name: 'Chart Tee',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 799,
      });

      const chartRes = await app.inject({
        method: 'POST',
        url: '/api/v1/products/size-charts',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Tee Chart', entries: [{ sizeLabel: 'M', measurements: { chest: 40 } }] },
      });
      const chartId = chartRes.json().id as string;
      await testPrisma.sku.update({ where: { id: skuId }, data: { sizeChartId: chartId } });

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(res.json().sizeChart.name).toBe('Tee Chart');
      expect(res.json().sizeChart.entries[0]).toEqual({ sizeLabel: 'M', measurements: { chest: 40 } });
    });
  });

  describe('Ratings & reviews (PDP-001)', () => {
    it('lets an authenticated customer submit a review, visible on the PDP with a live-computed summary', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-001',
        name: 'Review Test Dress',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1999,
      });
      const { token: customerToken } = await createAuthenticatedCustomer(app, { fullName: 'Priya' });

      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 5, title: 'Great fit', body: 'Loved it, true to size.' },
      });
      expect(submitRes.statusCode).toBe(201);

      const pdp = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(pdp.json().ratingSummary).toEqual({ averageRating: 5, reviewCount: 1 });
      expect(pdp.json().reviews[0]).toMatchObject({ rating: 5, title: 'Great fit', customerName: 'Priya' });
    });

    it('rejects a review submission without customer auth', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-002',
        name: 'No Auth Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 999,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        payload: { rating: 4, body: 'ok' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a second review from the same customer for the same style', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-003',
        name: 'Duplicate Review Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1200,
      });
      const { token: customerToken } = await createAuthenticatedCustomer(app);

      await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 3, body: 'First review' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 5, body: 'Second review attempt' },
      });
      expect(second.statusCode).toBe(400);
    });

    it('rejects an out-of-range rating', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-004',
        name: 'Range Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1200,
      });
      const { token: customerToken } = await createAuthenticatedCustomer(app);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 6, body: 'Too high' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('lets staff with review:moderate hide a review (removed from PDP + summary) and unhide it', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-005',
        name: 'Moderation Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1200,
      });
      const { token: customerToken } = await createAuthenticatedCustomer(app);
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 1, body: 'Spam or abusive text' },
      });
      const reviewId = submitRes.json().id as string;

      await grantPermissions('MARKETING', ['review:moderate']);
      const { token: modToken } = await createAuthenticatedStaff(app, ['MARKETING']);

      const hideRes = await app.inject({
        method: 'POST',
        url: `/api/v1/pdp/reviews/${reviewId}/hide`,
        headers: { authorization: `Bearer ${modToken}` },
      });
      expect(hideRes.statusCode).toBe(200);

      const afterHide = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(afterHide.json().reviews).toEqual([]);
      expect(afterHide.json().ratingSummary).toEqual({ averageRating: null, reviewCount: 0 });

      const unhideRes = await app.inject({
        method: 'POST',
        url: `/api/v1/pdp/reviews/${reviewId}/unhide`,
        headers: { authorization: `Bearer ${modToken}` },
      });
      expect(unhideRes.statusCode).toBe(200);

      const afterUnhide = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${styleId}` });
      expect(afterUnhide.json().reviews).toHaveLength(1);
    });

    it('rejects hiding a review without review:moderate permission', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'REV-006',
        name: 'RBAC Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1200,
      });
      const { token: customerToken } = await createAuthenticatedCustomer(app);
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/storefront/products/${styleId}/reviews`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { rating: 2, body: 'Text' },
      });
      const reviewId = submitRes.json().id as string;

      await grantPermissions('CATALOG', ['product:read']);
      const { token: noPermToken } = await createAuthenticatedStaff(app, ['CATALOG']);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/pdp/reviews/${reviewId}/hide`,
        headers: { authorization: `Bearer ${noPermToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PIN-code serviceability (IND-002)', () => {
    it('returns known:false, non-serviceable for an unlisted pincode - never an error', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/serviceability?pincode=110001' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ known: false, isServiceable: false });
    });

    it('staff can configure a pincode, then the public check reflects it', async () => {
      await grantPermissions('WAREHOUSE_MANAGER', ['pincode:manage']);
      const { token } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);

      const upsertRes = await app.inject({
        method: 'POST',
        url: '/api/v1/pdp/pincodes',
        headers: { authorization: `Bearer ${token}` },
        payload: { pincode: '400001', city: 'Mumbai', state: 'Maharashtra', estimatedDaysMin: 2, estimatedDaysMax: 4 },
      });
      expect(upsertRes.statusCode).toBe(200);

      const checkRes = await app.inject({ method: 'GET', url: '/api/v1/storefront/serviceability?pincode=400001' });
      expect(checkRes.json()).toMatchObject({
        known: true,
        isServiceable: true,
        city: 'Mumbai',
        state: 'Maharashtra',
        estimatedDaysMin: 2,
        estimatedDaysMax: 4,
      });
    });

    it('rejects a malformed pincode with a clean 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/storefront/serviceability?pincode=ABC' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects pincode configuration without pincode:manage permission', async () => {
      await grantPermissions('CATALOG', ['product:read']);
      const { token } = await createAuthenticatedStaff(app, ['CATALOG']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pdp/pincodes',
        headers: { authorization: `Bearer ${token}` },
        payload: { pincode: '110001', city: 'Delhi', state: 'Delhi' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Cross-sell (PDP-002)', () => {
    it('backfills with same-category rule-based picks when no manual override exists', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId: mainId } = await publishStyle(token, {
        styleCode: 'XS-001',
        name: 'Main Style',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      const { styleId: sameCategoryId } = await publishStyle(token, {
        styleCode: 'XS-002',
        name: 'Same Category Style',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1500,
      });
      const otherCategory = await testPrisma.category.create({ data: { name: 'Other', slug: 'xs-other-category' } });
      await publishStyle(token, {
        styleCode: 'XS-003',
        name: 'Other Category Style',
        brandId: brand.id,
        categoryId: otherCategory.id,
        sizeId: size.id,
        sellingPrice: 1500,
      });

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${mainId}` });
      const ids = res.json().crossSell.map((c: { id: string }) => c.id);
      expect(ids).toContain(sameCategoryId);
      expect(ids).not.toContain(mainId);
    });

    it('ranks a manual override ahead of rule-based picks', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId: mainId } = await publishStyle(token, {
        styleCode: 'XS-010',
        name: 'Main Style 2',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      const { styleId: ruleId } = await publishStyle(token, {
        styleCode: 'XS-011',
        name: 'Rule Pick',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1100,
      });
      const { styleId: manualId } = await publishStyle(token, {
        styleCode: 'XS-012',
        name: 'Manual Pick',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1200,
      });

      const addRes = await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/styles/${mainId}/cross-sell`,
        headers: { authorization: `Bearer ${token}` },
        payload: { relatedStyleId: manualId },
      });
      expect(addRes.statusCode).toBe(201);

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${mainId}` });
      const crossSell = res.json().crossSell;
      expect(crossSell[0]).toMatchObject({ id: manualId, source: 'MANUAL' });
      expect(crossSell.map((c: { id: string }) => c.id)).toContain(ruleId);
    });

    it('silently drops a manual override pointing at an unpublished style', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId: mainId } = await publishStyle(token, {
        styleCode: 'XS-020',
        name: 'Main Style 3',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      const draftStyle = await testPrisma.style.create({
        data: { styleCode: 'XS-021', name: 'Draft Related', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/styles/${mainId}/cross-sell`,
        headers: { authorization: `Bearer ${token}` },
        payload: { relatedStyleId: draftStyle.id },
      });

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${mainId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().crossSell.map((c: { id: string }) => c.id)).not.toContain(draftStyle.id);
    });

    it('rejects a self-referencing cross-sell override', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId } = await publishStyle(token, {
        styleCode: 'XS-030',
        name: 'Self Ref Test',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/styles/${styleId}/cross-sell`,
        headers: { authorization: `Bearer ${token}` },
        payload: { relatedStyleId: styleId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects cross-sell management without catalog:cross_sell:manage permission', async () => {
      await grantPermissions('CATALOG', ['product:read', 'product:write']);
      const { token } = await createAuthenticatedStaff(app, ['CATALOG']);
      const { brand, category } = await seedBrandAndLocation();
      const style = await testPrisma.style.create({
        data: { styleCode: 'XS-040', name: 'RBAC Test', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });
      const other = await testPrisma.style.create({
        data: { styleCode: 'XS-041', name: 'RBAC Test 2', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/styles/${style.id}/cross-sell`,
        headers: { authorization: `Bearer ${token}` },
        payload: { relatedStyleId: other.id },
      });
      expect(res.statusCode).toBe(403);
    });

    it('removes a manual override', async () => {
      const token = await merchandisingToken();
      const { brand, category, size } = await seedBrandAndLocation();
      const { styleId: mainId } = await publishStyle(token, {
        styleCode: 'XS-050',
        name: 'Remove Test Main',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      const { styleId: relatedId } = await publishStyle(token, {
        styleCode: 'XS-051',
        name: 'Remove Test Related',
        brandId: brand.id,
        categoryId: category.id,
        sizeId: size.id,
        sellingPrice: 1000,
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/styles/${mainId}/cross-sell`,
        headers: { authorization: `Bearer ${token}` },
        payload: { relatedStyleId: relatedId },
      });

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/catalog/styles/${mainId}/cross-sell/${relatedId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(delRes.statusCode).toBe(204);

      const res = await app.inject({ method: 'GET', url: `/api/v1/storefront/products/${mainId}` });
      const manualPicks = res.json().crossSell.filter((c: { source: string }) => c.source === 'MANUAL');
      expect(manualPicks).toEqual([]);
    });
  });
});
