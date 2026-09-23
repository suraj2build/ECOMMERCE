import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

/**
 * Fails loudly and specifically on the failing call (status + body) rather
 * than letting setup limp on with an unexpected shape and blow up several
 * lines later with an opaque "Cannot read properties of undefined" - that
 * exact failure mode is what made a real CI failure here hard to diagnose
 * from the logs alone (see BUILD_PLAN.md M11 entry).
 */
async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * PDP browser E2E (M11, acceptance/m11-pdp.md): full browse -> variant
 * select -> add-to-bag flow on mobile and desktop, plus structured data
 * and an accessibility scan, mirroring Home's M09 E2E discipline.
 *
 * Provisions its own real, published product via the same HTTP API a
 * merchandiser would use. Category/Size have no admin HTTP surface yet
 * (a pre-existing Phase 1 gap, not this milestone's to fix) so those two
 * are looked up/created directly via Prisma, exactly like the vitest
 * integration suite's seedBrandAndLocation() helper - everything else
 * (style, colour, SKU, media, publish, price, stock) goes through the
 * real API, same as a merchandiser would use it.
 */
test.describe('Product Detail Page', () => {
  let styleId: string;
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
      where: { slug: 'e2e-pdp-category' },
      update: {},
      create: { name: 'E2E PDP Category', slug: 'e2e-pdp-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-M' },
      update: {},
      create: { label: 'E2E-M', sortOrder: 0 },
    });

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2E${Date.now() % 100000}`, name: 'E2E Test Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: authHeaders,
      data: { code: `E2ELOC${Date.now() % 100000}`, name: 'E2E Location', type: 'WAREHOUSE' },
    });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: {
        styleCode: `E2E-PDP-${Date.now()}`,
        name: 'E2E Test Jacket',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        fabric: '100% Cotton',
      },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, {
      headers: authHeaders,
      data: { name: 'Black', colourCode: 'BLK' },
    });
    const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, {
      headers: authHeaders,
      data: { sizeIds: [size.id] },
    });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    if (skus.length === 0) {
      throw new Error(
        `Generate SKUs returned an empty array for style ${styleId}, colour ${colour.id}, size ${size.id}`,
      );
    }
    const sku = skus[0]!;

    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/media`, {
        headers: authHeaders,
        data: { colourId: colour.id, url: 'https://placehold.co/800x1000' },
      }),
      'Add media',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: authHeaders }),
      'Transition to ready-for-enrichment',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: authHeaders }),
      'QA check',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: authHeaders }),
      'Publish style',
    );
    await expectOk(
      await api.post('/api/v1/catalog/prices', {
        headers: authHeaders,
        data: { styleId, mrp: 1999, sellingPrice: 1999 },
      }),
      'Set price',
    );
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', {
        headers: authHeaders,
        data: { skuId: sku.skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' },
      }),
      'Inventory adjustment',
    );
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('renders the full PDP and blocks add-to-bag until a size is selected, on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/product/${styleId}`);
    await expect(page.getByRole('heading', { name: 'E2E Test Jacket' })).toBeVisible();
    await expect(page.getByText('₹1999').first()).toBeVisible();

    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Please select a size').first()).toBeVisible();

    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('coming soon').first()).toBeVisible();
  });

  test('renders correctly on mobile with no horizontal overflow and a reachable footer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/product/${styleId}`);
    await expect(page.getByRole('heading', { name: 'E2E Test Jacket' })).toBeVisible();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeInViewport();
  });

  test('includes valid Product structured data', async ({ page }) => {
    await page.goto(`/product/${styleId}`);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    const data = JSON.parse(jsonLd ?? '{}');
    expect(data['@type']).toBe('Product');
    expect(data.offers.price).toBe(1999);
    expect(data.offers.availability).toBe('https://schema.org/InStock');
  });

  test('has no critical or serious automated accessibility violations', async ({ page }) => {
    await page.goto(`/product/${styleId}`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
