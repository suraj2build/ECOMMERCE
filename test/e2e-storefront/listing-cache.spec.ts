import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

/**
 * Listings (home, category, search) are served from the storefront's data
 * cache, which keeps serving the last result until it is refreshed. With an
 * existing, warm cache, these checks prove a listing follows:
 *  - a price change and an unpublish, without waiting for the cache;
 *  - data changed behind the application (a restore or reseed), once the
 *    search index is rebuilt (POST /search/reindex), which also drops the
 *    storefront's cached listings.
 * Each check allows a few seconds, well inside the 30-second cache window.
 */

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text().catch(() => '')}`);
  return res.json();
}

test.describe('Listings follow catalogue changes with a warm cache', () => {
  let api: APIRequestContext;
  let auth: Record<string, string>;
  const prisma = new PrismaClient();
  const run = Date.now();
  // A word only these products contain, so the search listing shows just them.
  const word = `lstc${run.toString(36)}`;
  const listing = `/search?q=${word}`;

  const post = async (url: string, data: object | undefined, label: string) => expectOk(await api.post(url, { headers: auth, ...(data ? { data } : {}) }), label);

  async function newPublishedProduct(name: string, price: number) {
    const category = await prisma.category.upsert({ where: { slug: 'e2e-listing-cache' }, update: {}, create: { name: 'E2E Listing Cache', slug: 'e2e-listing-cache' } });
    const size = await prisma.size.upsert({ where: { label: 'E2E-LC-M' }, update: {}, create: { label: 'E2E-LC-M', sortOrder: 0 } });
    const stamp = `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;
    const brand = (await post('/api/v1/organization/brands', { code: `LC${stamp}`, name: 'Listing Cache Brand' }, 'brand')) as { id: string };
    const location = (await post('/api/v1/organization/locations', { code: `LCL${stamp}`, name: 'Listing Cache Location', type: 'WAREHOUSE' }, 'location')) as { id: string };
    const style = (await post('/api/v1/products/styles', { styleCode: `E2E-LC-${stamp}`, name, brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' }, 'style')) as { id: string };
    const colour = (await post(`/api/v1/products/styles/${style.id}/colours`, { name: 'Black', colourCode: 'BLK' }, 'colour')) as { id: string };
    const [sku] = (await post(`/api/v1/products/styles/${style.id}/skus/generate`, { sizeIds: [size.id] }, 'skus')) as { skuId: string }[];
    await post(`/api/v1/products/styles/${style.id}/media`, { colourId: colour.id, url: `${STOREFRONT_URL}/e2e-fixture.png` }, 'media');
    await post('/api/v1/catalog/prices', { styleId: style.id, mrp: price, sellingPrice: price }, 'price');
    await post('/api/v1/inventory/adjustments', { skuId: sku!.skuId, locationId: location.id, quantityDelta: 5, reason: 'E2E listing cache', idempotencyKey: `e2e-lc-${sku!.skuId}` }, 'stock');
    for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) await post(`/api/v1/products/styles/${style.id}/${step}`, undefined, step);
    return style.id;
  }

  const listingHtml = async (request: APIRequestContext) => (await request.get(`${STOREFRONT_URL}${listing}`)).text();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });
    const { token } = (await expectOk(await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }), 'login')) as { token: string };
    auth = { authorization: `Bearer ${token}` };
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('a price change and an unpublish show in a cached listing at once', async ({ request }) => {
    const styleId = await newPublishedProduct(`Listing Probe ${word} Kurta`, 1999);
    await expect.poll(() => listingHtml(request), { timeout: 15_000 }).toContain(`/product/${styleId}`);
    expect(await listingHtml(request)).toContain(`/product/${styleId}`); // served from the warm cache
    expect(await listingHtml(request)).not.toMatch(/1,?299/);

    await post('/api/v1/catalog/prices', { styleId, mrp: 1999, sellingPrice: 1299 }, 'reprice');
    await expect.poll(() => listingHtml(request), { timeout: 5_000 }).toMatch(/1,?299/);

    await post(`/api/v1/products/styles/${styleId}/unpublish`, undefined, 'unpublish');
    await expect.poll(() => listingHtml(request), { timeout: 5_000 }).not.toContain(`/product/${styleId}`);
  });

  test('after a restore or reseed changes data behind the application, a reindex brings cached listings back in line', async ({ request }) => {
    const styleId = await newPublishedProduct(`Restore Probe ${word} Dupatta`, 899);
    await expect.poll(() => listingHtml(request), { timeout: 15_000 }).toContain(`/product/${styleId}`);

    // As if an older backup were restored: the product is not published in
    // the database, but the search index and the storefront cache still list it.
    await prisma.style.update({ where: { id: styleId }, data: { lifecycleState: 'DRAFT', publishedAt: null } });
    expect(await listingHtml(request)).toContain(`/product/${styleId}`);
    expect((await request.get(`${STOREFRONT_URL}/product/${styleId}`)).status()).toBe(404);

    // The runbook step after any restore or reseed.
    await post('/api/v1/search/reindex', undefined, 'reindex');
    await expect.poll(() => listingHtml(request), { timeout: 5_000 }).not.toContain(`/product/${styleId}`);
  });

  test('the storefront catalogue purge refuses a wrong or missing secret', async ({ request }) => {
    expect((await request.post(`${STOREFRONT_URL}/api/revalidate/catalog`, { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
    expect((await request.post(`${STOREFRONT_URL}/api/revalidate/catalog`)).status()).toBe(401);
  });
});
