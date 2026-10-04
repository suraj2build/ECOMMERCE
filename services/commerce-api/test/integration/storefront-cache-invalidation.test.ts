import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { __resetEnvCacheForTests } from '@fcp/config';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

const SECRET = 'test-only-storefront-revalidate-secret-0001';

interface Received {
  path: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

/**
 * The storefront caches each product page for up to 30 seconds and its
 * listings for 30-60 seconds. A page requested before publication must not
 * stay a cached 404 after publish, and an unpublished product must not stay
 * visible on its page or in any listing: the API asks the storefront to
 * drop the page and its cached catalogue reads after every change that
 * alters them, and after a search reindex (the runbook step after a restore
 * or reseed). A stand-in storefront records those calls here; the real
 * storefront endpoints are exercised by
 * test/e2e-storefront/pdp-publish-cache.spec.ts and listing-cache.spec.ts.
 */
describe('Storefront product-page invalidation', () => {
  let app: FastifyInstance;
  let storefront: Server;
  let received: Received[];
  let respondWith: { status: number; delayMs: number };

  beforeAll(async () => {
    storefront = createServer((req: IncomingMessage, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(raw || 'null') });
        setTimeout(() => {
          res.statusCode = respondWith.status;
          res.end('{}');
        }, respondWith.delayMs);
      });
    });
    await new Promise<void>((resolve) => storefront.listen(0, '127.0.0.1', resolve));
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => storefront.close(() => resolve()));
  });

  beforeEach(async () => {
    received = [];
    respondWith = { status: 200, delayMs: 0 };
    const { port } = storefront.address() as AddressInfo;
    process.env.STOREFRONT_REVALIDATE_URL = `http://127.0.0.1:${port}/api/revalidate/product`;
    process.env.STOREFRONT_REVALIDATE_SECRET = SECRET;
    __resetEnvCacheForTests();
    await resetDatabase();
    await seedRbac();
  });

  afterEach(() => {
    delete process.env.STOREFRONT_REVALIDATE_URL;
    delete process.env.STOREFRONT_REVALIDATE_SECRET;
    __resetEnvCacheForTests();
  });

  async function merchandiser(): Promise<string> {
    await grantPermissions('MERCHANDISING', ['product:read', 'product:write', 'product:publish', 'catalog:price:write']);
    return (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
  }

  async function post(token: string, url: string, payload?: object) {
    return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  }

  /** A style that has passed QA and is ready to publish (not yet public). */
  async function readyStyle(token: string): Promise<string> {
    const { brand, category, size } = await seedBrandAndLocation();
    const styleId = (await post(token, '/api/v1/products/styles', {
      styleCode: `INV-${Date.now()}`, name: 'Invalidation Shirt', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core',
    })).json().id as string;
    const colourId = (await post(token, `/api/v1/products/styles/${styleId}/colours`, { name: 'Black', colourCode: 'BLK' })).json().id as string;
    await post(token, `/api/v1/products/styles/${styleId}/skus/generate`, { sizeIds: [size.id] });
    await post(token, `/api/v1/products/styles/${styleId}/media`, { colourId, url: 'https://example.com/x.jpg' });
    await post(token, `/api/v1/products/styles/${styleId}/ready-for-enrichment`);
    await post(token, `/api/v1/products/styles/${styleId}/qa-check`);
    return styleId;
  }

  const calls = (styleId: string) => received.filter((r) => (r.body as { styleId?: string })?.styleId === styleId).length;
  const catalogPurges = () => received.filter((r) => r.path === '/api/revalidate/catalog').length;

  it('asks the storefront to drop the product page on publish, price change, unpublish and archive', async () => {
    const token = await merchandiser();
    const styleId = await readyStyle(token);
    const beforePublish = calls(styleId);

    expect((await post(token, `/api/v1/products/styles/${styleId}/publish`)).statusCode).toBe(200);
    expect(calls(styleId)).toBe(beforePublish + 1);

    expect((await post(token, '/api/v1/catalog/prices', { styleId, mrp: 1999, sellingPrice: 1499 })).statusCode).toBe(201);
    expect(calls(styleId)).toBe(beforePublish + 2);

    expect((await post(token, `/api/v1/products/styles/${styleId}/unpublish`)).statusCode).toBe(200);
    expect(calls(styleId)).toBe(beforePublish + 3);

    expect((await post(token, `/api/v1/products/styles/${styleId}/archive`)).statusCode).toBe(200);
    expect(calls(styleId)).toBe(beforePublish + 4);

    // Each change also purges the cached listings the product appears in.
    expect(catalogPurges()).toBe(calls(styleId));
    for (const call of received) {
      expect(call.authorization).toBe(`Bearer ${SECRET}`);
      if (call.path === '/api/revalidate/product') expect(call.body).toEqual({ styleId });
      else expect(call.path).toBe('/api/revalidate/catalog');
    }
  });

  it('purges cached listings after a collection change and a search reindex, and not after a refused change', async () => {
    await grantPermissions('MERCHANDISING', ['catalog:collection:manage', 'catalog:publish', 'search:reindex']);
    const token = (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;

    const created = await post(token, '/api/v1/catalog/collections', { name: 'Purge Edit', slug: `purge-edit-${Date.now()}` });
    expect(created.statusCode).toBe(201);
    expect(catalogPurges()).toBe(1);
    expect((await post(token, `/api/v1/catalog/collections/${created.json().id}/publish`)).statusCode).toBe(200);
    expect(catalogPurges()).toBe(2);

    // A refused change leaves the cache alone.
    expect((await post(token, '/api/v1/catalog/collections/00000000-0000-4000-8000-000000000000/publish')).statusCode).toBe(404);
    expect(catalogPurges()).toBe(2);

    expect((await post(token, '/api/v1/search/reindex')).statusCode).toBe(200);
    expect(catalogPurges()).toBe(3);
    for (const call of received) expect(call).toMatchObject({ path: '/api/revalidate/catalog', authorization: `Bearer ${SECRET}`, body: {} });
  });

  it('a purge without permission is refused before anything reaches the storefront', async () => {
    const token = (await createAuthenticatedStaff(app, ['MERCHANDISING'])).token;
    expect((await post(token, '/api/v1/search/reindex')).statusCode).toBe(403);
    expect(received).toHaveLength(0);
  });

  it('still publishes when the storefront refuses or does not answer in time', async () => {
    const token = await merchandiser();

    respondWith = { status: 500, delayMs: 0 };
    const refused = await readyStyle(token);
    expect((await post(token, `/api/v1/products/styles/${refused}/publish`)).statusCode).toBe(200);
    expect(calls(refused)).toBeGreaterThan(0);

    respondWith = { status: 200, delayMs: 5_000 };
    await resetDatabase();
    await seedRbac();
    const token2 = await merchandiser();
    const slow = await readyStyle(token2);
    const started = Date.now();
    const res = await post(token2, `/api/v1/products/styles/${slow}/publish`);
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycleState).toBe('PUBLISHED');
    // The call gives up after its 2-second timeout instead of holding the request.
    expect(Date.now() - started).toBeLessThan(4_500);
  }, 20_000);

  it('makes no call when the storefront endpoint is not configured', async () => {
    delete process.env.STOREFRONT_REVALIDATE_URL;
    delete process.env.STOREFRONT_REVALIDATE_SECRET;
    __resetEnvCacheForTests();
    const token = await merchandiser();
    const styleId = await readyStyle(token);
    expect((await post(token, `/api/v1/products/styles/${styleId}/publish`)).statusCode).toBe(200);
    expect(received).toHaveLength(0);
  });
});
