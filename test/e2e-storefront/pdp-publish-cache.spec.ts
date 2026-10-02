import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Regression: the product page is cached for 30 seconds. A page requested
 * before publication stayed a cached 404 for ~30 seconds after publish,
 * and an unpublished product stayed visible for the same time. The API
 * now asks the storefront to drop the page after each change, so every
 * check below allows a few seconds, well inside the 30-second window.
 * Runs against the production storefront build, as in CI.
 */
test.describe('Product page follows publish, price and unpublish without waiting for the cache', () => {
  let api: APIRequestContext;
  let authHeaders: Record<string, string>;
  let styleId: string;
  const prisma = new PrismaClient();

  const post = async (url: string, data: object | undefined, label: string) =>
    expectOk(await api.post(url, { headers: authHeaders, ...(data ? { data } : {}) }), label);

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });
    const { token } = (await post('/api/v1/auth/staff/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, 'Staff login')) as { token: string };
    authHeaders = { authorization: `Bearer ${token}` };

    const run = Date.now();
    const category = await prisma.category.upsert({ where: { slug: 'e2e-pdp-category' }, update: {}, create: { name: 'E2E PDP Category', slug: 'e2e-pdp-category' } });
    const size = await prisma.size.upsert({ where: { label: 'E2E-M' }, update: {}, create: { label: 'E2E-M', sortOrder: 0 } });
    const brand = (await post('/api/v1/organization/brands', { code: `PC${run % 100000}`, name: 'Cache Brand' }, 'brand')) as { id: string };
    const location = (await post('/api/v1/organization/locations', { code: `PCL${run % 100000}`, name: 'Cache Location', type: 'WAREHOUSE' }, 'location')) as { id: string };
    const style = (await post('/api/v1/products/styles', {
      styleCode: `E2E-CACHE-${run}`, name: 'Cache Regression Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', fabric: 'Cotton',
    }, 'style')) as { id: string };
    styleId = style.id;
    const colour = (await post(`/api/v1/products/styles/${styleId}/colours`, { name: 'Black', colourCode: 'BLK' }, 'colour')) as { id: string };
    const skus = (await post(`/api/v1/products/styles/${styleId}/skus/generate`, { sizeIds: [size.id] }, 'skus')) as { skuId: string }[];
    await post(`/api/v1/products/styles/${styleId}/media`, { colourId: colour.id, url: FIXTURE_IMAGE_URL }, 'media');
    await post('/api/v1/catalog/prices', { styleId, mrp: 1999, sellingPrice: 1999 }, 'price');
    await post('/api/v1/inventory/adjustments', {
      skuId: skus[0]!.skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E cache stock', idempotencyKey: `e2e-cache-${skus[0]!.skuId}`,
    }, 'stock');
    await post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, undefined, 'ready');
    await post(`/api/v1/products/styles/${styleId}/qa-check`, undefined, 'qa');
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('a page requested before publish, then published, repriced and unpublished, shows each change at once', async ({ request }) => {
    const page = `/product/${styleId}`;

    // Requested before publication: a 404, cached by the storefront.
    expect((await request.get(page)).status()).toBe(404);
    const cached404 = await request.get(page);
    expect(cached404.status()).toBe(404);
    expect(cached404.headers()['x-nextjs-cache']).toBe('HIT');

    await post(`/api/v1/products/styles/${styleId}/publish`, undefined, 'publish');
    await expect.poll(async () => (await request.get(page)).status(), { timeout: 5_000 }).toBe(200);
    expect(await (await request.get(page)).text()).toContain('Cache Regression Jacket');

    await post('/api/v1/catalog/prices', { styleId, mrp: 1999, sellingPrice: 1299 }, 'reprice');
    await expect.poll(async () => (await request.get(page)).text(), { timeout: 5_000 }).toContain('1299');

    await post(`/api/v1/products/styles/${styleId}/unpublish`, undefined, 'unpublish');
    await expect.poll(async () => (await request.get(page)).status(), { timeout: 5_000 }).toBe(404);
  });

  test('the storefront revalidation endpoint refuses a wrong secret and a malformed product id', async ({ request }) => {
    const wrong = await request.post('/api/revalidate/product', { headers: { authorization: 'Bearer wrong' }, data: { styleId } });
    expect(wrong.status()).toBe(401);
    const missing = await request.post('/api/revalidate/product', { data: { styleId } });
    expect(missing.status()).toBe(401);
    const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
    test.skip(!secret, 'needs STOREFRONT_REVALIDATE_SECRET to check input validation');
    const malformed = await request.post('/api/revalidate/product', { headers: { authorization: `Bearer ${secret}` }, data: { styleId: '../../x' } });
    expect(malformed.status()).toBe(400);
  });
});
