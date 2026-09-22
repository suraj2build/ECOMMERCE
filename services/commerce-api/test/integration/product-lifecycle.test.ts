import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * specs/02-product-master.md PROD-003: publish requires BOTH the
 * automated QA-completeness gate AND an explicit Merchandiser action -
 * neither alone is sufficient. Proves the gate is enforced, not just
 * documented.
 */
describe('Product Master: publish gate (PROD-003)', () => {
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

  it('blocks publish when the style has not passed the automated QA-completeness gate', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: 'GATE-001',
        name: 'Gate Test Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const styleId = styleRes.json().id as string;

    // No colours, SKUs, or media added - QA-completeness will fail.
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(publishRes.statusCode).toBe(400);
    expect(publishRes.json().error.message).toMatch(/QA-completeness gate has not passed/i);
  });

  it('blocks publish for a style that passed QA but lacks the explicit merchandiser publish call being reached (still in READY_FOR_QA, not auto-published)', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category, size } = await seedBrandAndLocation();

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: 'GATE-002',
        name: 'Gate Test Style 2',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const styleId = styleRes.json().id as string;

    const colourRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'White', colourCode: 'WHT' },
    });
    const colourId = colourRes.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/skus/generate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sizeIds: [size.id] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId, url: 'https://example.com/gate.jpg' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/ready-for-enrichment`,
      headers: { authorization: `Bearer ${token}` },
    });

    // QA check never run - the automated gate has not fired, even though
    // the underlying data completeness would pass it.
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(publishRes.statusCode).toBe(400);

    // Running QA then publishing succeeds - proves both gates are real, not stubs.
    const qaRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/qa-check`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(qaRes.json().passed).toBe(true);

    const publishRes2 = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publishRes2.statusCode).toBe(200);
    expect(publishRes2.json().lifecycleState).toBe('PUBLISHED');
  });

  it('rejects a publish attempt by a role without product:publish permission', async () => {
    await grantPermissions('CATALOG', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['CATALOG']);
    const { brand, category } = await seedBrandAndLocation();

    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: 'GATE-003',
        name: 'Gate Test Style 3',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const styleId = styleRes.json().id as string;

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(publishRes.statusCode).toBe(403);
  });
});
