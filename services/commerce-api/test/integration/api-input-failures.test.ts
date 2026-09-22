import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantAllPermissions, seedBrandAndLocation } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * Certification-pass input/API failure round across representative
 * M00-M07 endpoints: missing fields, wrong types, invalid UUIDs, unknown
 * IDs, invalid enums, negative/unreasonable quantities, malformed JSON.
 * Every case must return a consistent, safe error shape - never a raw
 * stack trace, SQL fragment, or internal detail (SECURITY.md §4).
 */
describe('API input/failure handling certification', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantAllPermissions('SUPER_ADMIN');
    const auth = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);
    token = auth.token;
  });

  function assertSafeErrorShape(body: unknown) {
    const parsed = body as { error?: { code?: string; message?: string } };
    expect(parsed.error).toBeDefined();
    expect(typeof parsed.error!.code).toBe('string');
    expect(typeof parsed.error!.message).toBe('string');
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped lines
    expect(serialized.toLowerCase()).not.toMatch(/password|secret|prisma\.|select \*|node_modules/);
  }

  it('rejects a style creation missing required fields with 400, safe shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'No Style Code' }, // missing styleCode, brandId, categoryId, season, collection
    });
    expect(res.statusCode).toBe(400);
    assertSafeErrorShape(res.json());
  });

  it('rejects wrong-typed fields (number where string expected)', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 12345, name: 'Bad Type', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    expect(res.statusCode).toBe(400);
    assertSafeErrorShape(res.json());
  });

  it('rejects an empty required string', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: '', name: 'Empty Code', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed (non-UUID) id in a path parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products/styles/not-a-real-uuid',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    assertSafeErrorShape(res.json());
  });

  it('returns a clean 404 for a well-formed but unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/products/styles/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    assertSafeErrorShape(res.json());
  });

  it('rejects an invalid enum value (supplier type)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'ENUM-001', name: 'Bad Enum Supplier', type: 'NOT_A_REAL_TYPE' },
    });
    expect(res.statusCode).toBe(400);
    assertSafeErrorShape(res.json());
  });

  it('rejects a negative ordered quantity on a purchase order line', async () => {
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 'NEG-001', name: 'Negative Qty Test', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colourRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${style.json().id}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Black', colourCode: 'BLK' },
    });
    const skuRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${style.json().id}/skus/generate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sizeIds: [size.id] },
    });
    void colourRes;
    const supplierRes = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'NEG-SUP', name: 'Negative Qty Supplier', type: 'FINISHED_GOODS' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        supplierId: supplierRes.json().id,
        locationId: location.id,
        lines: [{ skuId: skuRes.json()[0].skuId, orderedQty: -5, unitCost: 100 }],
      },
    });
    expect(res.statusCode).toBe(400);
    assertSafeErrorShape(res.json());
  });

  it('rejects an unreasonably large integer quantity cleanly (no crash, no overflow corruption)', async () => {
    const { location } = await seedBrandAndLocation();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/reserve',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        skuId: '00000000-0000-0000-0000-000000000000',
        locationId: location.id,
        quantity: Number.MAX_SAFE_INTEGER,
        idempotencyKey: 'overflow-attempt',
      },
    });
    // Either a clean validation rejection or a clean domain error (SKU
    // not found / insufficient stock) - never a 500 or an unhandled crash.
    expect(res.statusCode).toBeLessThan(500);
    assertSafeErrorShape(res.json());
  });

  it('rejects malformed JSON in the request body with a clean 400, not a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '{ this is not valid json ]]]',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized request body at the transport level (Fastify default bodyLimit)', async () => {
    const hugeName = 'x'.repeat(2 * 1024 * 1024); // 2MB, above Fastify's 1MB default
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'HUGE', name: hugeName, type: 'FINISHED_GOODS' }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('rejects an unknown supplier id on PO creation with a clean 404, not a raw FK error', async () => {
    const { location } = await seedBrandAndLocation();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/procurement/purchase-orders',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        supplierId: '00000000-0000-0000-0000-000000000000',
        locationId: location.id,
        lines: [{ skuId: '00000000-0000-0000-0000-000000000000', orderedQty: 1, unitCost: 100 }],
      },
    });
    expect(res.statusCode).toBe(404);
    assertSafeErrorShape(res.json());
  });

  it('rejects an extra/unknown field gracefully (does not crash, ignores or rejects cleanly)', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        styleCode: 'EXTRA-001',
        name: 'Extra Field Test',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        thisFieldDoesNotExist: 'malicious-or-accidental-extra-data',
      },
    });
    expect(res.statusCode).toBe(201);
  });
});
