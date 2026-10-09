import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * POST /products/styles/:id/colours/:colourId/media/replace
 * (docs/deployment/PRODUCT_PHOTOGRAPHY.md): the plain media route is
 * append-only by design, so replacing a placeholder colour gallery with
 * reviewed photography needs its own narrowly-scoped, audited update
 * path - one that swaps exactly one colour's gallery atomically, never
 * the whole style's media, and never accumulates duplicates on a rerun.
 */
describe('Product media replace (append-only gap repair)', () => {
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

  async function setupStyleWithTwoColours(token: string, brand: { id: string }, category: { id: string }) {
    const styleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 'REPL-001', name: 'Replace Test', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const styleId = styleRes.json().id as string;

    const colourARes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Black', colourCode: 'C1' },
    });
    const colourBRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'White', colourCode: 'C2' },
    });

    return { styleId, colourAId: colourARes.json().id as string, colourBId: colourBRes.json().id as string };
  }

  it('replaces a placeholder gallery without interspersing or duplicating', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId } = await setupStyleWithTwoColours(token, brand, category);

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId: colourAId, url: 'https://example.com/placeholder.jpg', sortOrder: 0 },
    });

    const replaceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [
          { url: 'https://example.com/real-front.jpg', altText: 'front' },
          { url: 'https://example.com/real-back.jpg', altText: 'back' },
          { url: 'https://example.com/real-side.jpg', altText: 'side' },
          { url: 'https://example.com/real-detail.jpg', altText: 'detail' },
        ],
      },
    });
    expect(replaceRes.statusCode).toBe(200);

    const rows = await testPrisma.productMedia.findMany({ where: { styleId, colourId: colourAId }, orderBy: { sortOrder: 'asc' } });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.url)).toEqual([
      'https://example.com/real-front.jpg',
      'https://example.com/real-back.jpg',
      'https://example.com/real-side.jpg',
      'https://example.com/real-detail.jpg',
    ]);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    // The placeholder must be gone entirely - not left interspersed.
    expect(rows.find((r) => r.url.includes('placeholder'))).toBeUndefined();
  });

  it('is idempotent on rerun - calling replace twice never accumulates duplicate rows', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId } = await setupStyleWithTwoColours(token, brand, category);

    const payload = { items: [{ url: 'https://example.com/a.jpg' }, { url: 'https://example.com/b.jpg' }] };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(res.statusCode).toBe(200);
    }

    const rows = await testPrisma.productMedia.findMany({ where: { styleId, colourId: colourAId } });
    expect(rows).toHaveLength(2);
  });

  it('only touches the targeted colour - a sibling colour on the same style is untouched', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId, colourBId } = await setupStyleWithTwoColours(token, brand, category);

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/media`,
      headers: { authorization: `Bearer ${token}` },
      payload: { colourId: colourBId, url: 'https://example.com/white-front.jpg' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{ url: 'https://example.com/black-front.jpg' }] },
    });

    const colourBRows = await testPrisma.productMedia.findMany({ where: { styleId, colourId: colourBId } });
    expect(colourBRows).toHaveLength(1);
    expect(colourBRows[0].url).toBe('https://example.com/white-front.jpg');
  });

  it('rejects a colourId that belongs to a different style (cross-style contamination)', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { colourAId } = await setupStyleWithTwoColours(token, brand, category);

    const otherStyleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/products/styles',
      headers: { authorization: `Bearer ${token}` },
      payload: { styleCode: 'REPL-002', name: 'Other Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${otherStyleRes.json().id}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{ url: 'https://example.com/x.jpg' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not belong to style/i);
  });

  it('rejects an empty items array', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId } = await setupStyleWithTwoColours(token, brand, category);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for a non-existent style', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/00000000-0000-0000-0000-000000000000/colours/00000000-0000-0000-0000-000000000001/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{ url: 'https://example.com/x.jpg' }] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects the request from a role without product:write (RBAC)', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    await grantPermissions('CATALOG', ['product:read']);
    const { token: writeToken } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { token: readToken } = await createAuthenticatedStaff(app, ['CATALOG']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId } = await setupStyleWithTwoColours(writeToken, brand, category);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${readToken}` },
      payload: { items: [{ url: 'https://example.com/x.jpg' }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('records a product_media.replace audit event', async () => {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write']);
    const { token } = await createAuthenticatedStaff(app, ['MERCHANDISING']);
    const { brand, category } = await seedBrandAndLocation();
    const { styleId, colourAId } = await setupStyleWithTwoColours(token, brand, category);

    await app.inject({
      method: 'POST',
      url: `/api/v1/products/styles/${styleId}/colours/${colourAId}/media/replace`,
      headers: { authorization: `Bearer ${token}` },
      payload: { items: [{ url: 'https://example.com/x.jpg' }] },
    });

    const audit = await testPrisma.auditLog.findFirst({ where: { action: 'product_media.replace', entityId: colourAId } });
    expect(audit).not.toBeNull();
    expect(audit?.reference).toBe(styleId);
  });
});
