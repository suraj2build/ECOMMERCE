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
 * SEO (M27, specs/26-seo.md) browser E2E: proves `sitemap.xml` contains
 * only published products (the required test requirement in
 * `acceptance/m27-seo.md`), and `robots.txt` correctly references it and
 * disallows the non-indexable authenticated account/checkout surfaces.
 */
test.describe('SEO', () => {
  let publishedStyleId: string;
  let unpublishedStyleId: string;
  let api: APIRequestContext;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    const authHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-seo-category' },
      update: {},
      create: { name: 'E2E SEO Category', slug: 'e2e-seo-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-SEO-M' },
      update: {},
      create: { label: 'E2E-SEO-M', sortOrder: 0 },
    });
    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2ESEO${Date.now() % 100000}`, name: 'E2E SEO Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    async function createStyle(name: string, styleCode: string) {
      const styleRes = await api.post('/api/v1/products/styles', {
        headers: authHeaders,
        data: { styleCode, name, brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
      });
      const style = (await expectOk(styleRes, 'Create style')) as { id: string };
      const colourRes = await api.post(`/api/v1/products/styles/${style.id}/colours`, {
        headers: authHeaders,
        data: { name: 'Black', colourCode: 'BLK' },
      });
      const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };
      await expectOk(
        await api.post(`/api/v1/products/styles/${style.id}/skus/generate`, {
          headers: authHeaders,
          data: { sizeIds: [size.id] },
        }),
        'Generate SKUs',
      );
      await expectOk(
        await api.post(`/api/v1/products/styles/${style.id}/media`, {
          headers: authHeaders,
          data: { colourId: colour.id, url: FIXTURE_IMAGE_URL },
        }),
        'Add media',
      );
      return style.id;
    }

    publishedStyleId = await createStyle('E2E SEO Published Jacket', `E2E-SEO-PUB-${Date.now()}`);
    await expectOk(
      await api.post(`/api/v1/products/styles/${publishedStyleId}/ready-for-enrichment`, { headers: authHeaders }),
      'Transition to ready-for-enrichment',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${publishedStyleId}/qa-check`, { headers: authHeaders }),
      'QA check',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${publishedStyleId}/publish`, { headers: authHeaders }),
      'Publish style',
    );
    await expectOk(
      await api.post('/api/v1/catalog/prices', {
        headers: authHeaders,
        data: { styleId: publishedStyleId, mrp: 999, sellingPrice: 999 },
      }),
      'Set price',
    );

    // Left in DRAFT deliberately - never publish/price this one, proving
    // the sitemap's publish-gated read excludes it.
    unpublishedStyleId = await createStyle('E2E SEO Unpublished Jacket', `E2E-SEO-DRAFT-${Date.now()}`);
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('sitemap.xml contains only published products', async ({ request }) => {
    const res = await request.get(`${STOREFRONT_URL}/sitemap.xml`);
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toContain(`/product/${publishedStyleId}`);
    expect(body).not.toContain(`/product/${unpublishedStyleId}`);
    // The storefront home page itself is always listed.
    expect(body).toContain(`<loc>${STOREFRONT_URL}</loc>`);
  });

  test('robots.txt references the sitemap and disallows authenticated-only pages', async ({ request }) => {
    const res = await request.get(`${STOREFRONT_URL}/robots.txt`);
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toContain(`Sitemap: ${STOREFRONT_URL}/sitemap.xml`);
    expect(body).toMatch(/Disallow:\s*\/account/);
    expect(body).toMatch(/Disallow:\s*\/checkout/);
  });

  test('an unpublished product PDP returns a proper 404, never an empty/broken 200', async ({ page }) => {
    const response = await page.goto(`/product/${unpublishedStyleId}`);
    expect(response?.status()).toBe(404);
  });

  test('an unknown product id returns the identical 404 as an unpublished one (no existence leak)', async ({ page }) => {
    const response = await page.goto('/product/00000000-0000-0000-0000-000000000000');
    expect(response?.status()).toBe(404);
  });
});
