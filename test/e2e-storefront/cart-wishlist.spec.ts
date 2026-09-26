import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
// Same-origin static asset, not an external image host - see pdp.spec.ts's identical fixture for why.
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Cart / Wishlist browser E2E (M12, acceptance/m12-wishlist-cart.md).
 * Provisions its own published, priced, in-stock product via the real
 * HTTP API (same pattern as pdp.spec.ts) then drives the actual PDP ->
 * Bag / Wishlist flow in a real browser - this is the only place that
 * proves add-to-cart never reserves inventory end-to-end through the UI,
 * not just at the API layer (already covered by the vitest integration
 * suite).
 */
test.describe('Cart / Wishlist', () => {
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
      where: { slug: 'e2e-cart-category' },
      update: {},
      create: { name: 'E2E Cart Category', slug: 'e2e-cart-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-CART-M' },
      update: {},
      create: { label: 'E2E-CART-M', sortOrder: 0 },
    });

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2ECART${Date.now() % 100000}`, name: 'E2E Cart Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: authHeaders,
      data: { code: `E2ECARTLOC${Date.now() % 100000}`, name: 'E2E Cart Location', type: 'WAREHOUSE' },
    });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: {
        styleCode: `E2E-CART-${Date.now()}`,
        name: 'E2E Cart Jacket',
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
      data: { name: 'Navy', colourCode: 'NVY' },
    });
    const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, {
      headers: authHeaders,
      data: { sizeIds: [size.id] },
    });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    if (skus.length === 0) {
      throw new Error(`Generate SKUs returned an empty array for style ${styleId}, colour ${colour.id}, size ${size.id}`);
    }
    const sku = skus[0]!;

    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/media`, {
        headers: authHeaders,
        data: { colourId: colour.id, url: FIXTURE_IMAGE_URL },
      }),
      'Add media',
    );
    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: authHeaders }),
      'Transition to ready-for-enrichment',
    );
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: authHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: authHeaders }), 'Publish style');
    await expectOk(
      await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 2999, sellingPrice: 2999 } }),
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

  test('adds an item to the bag from the PDP without reserving inventory, then updates and removes it in the bag', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/product/${styleId}`);

    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    // The header's live count updates from the real cart, not a guess.
    await expect(page.getByRole('link', { name: /Shopping bag, 1 item/ })).toBeVisible();

    const reservations = await prisma.inventoryReservation.count({ where: { sku: { styleId } } });
    expect(reservations).toBe(0);

    await page.getByRole('link', { name: /Shopping bag/ }).click();
    await expect(page).toHaveURL(/\/bag$/);
    await expect(page.getByText('E2E Cart Jacket').first()).toBeVisible();
    await expect(page.getByText('₹2999').first()).toBeVisible();

    await page.getByLabel(/Quantity for/).selectOption('2');
    await expect(page.getByText('Subtotal (2 items)')).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your bag is empty.')).toBeVisible();
  });

  test('saves an item to the wishlist from the PDP and moves it to the bag from the wishlist page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/product/${styleId}`);

    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved to wishlist.')).toBeVisible({ timeout: 10_000 });

    await page.goto('/wishlist');
    await expect(page.getByText('E2E Cart Jacket').first()).toBeVisible();

    await page.getByRole('button', { name: 'Move to Bag' }).click();
    await expect(page.getByText('Moved to bag.')).toBeVisible();
    await expect(page.getByText('Nothing saved yet.')).toBeVisible();

    await page.goto('/bag');
    await expect(page.getByText('E2E Cart Jacket').first()).toBeVisible();
  });

  test('bag and wishlist render on mobile with no horizontal overflow and touch-scale controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    // At mobile width the desktop add-to-bag block (DOM order: first) is
    // CSS-hidden and the sticky mobile bar's own copy (DOM order: last) is
    // the visible one - the inverse of the desktop test's .first().
    await page.getByRole('button', { name: 'Add to Bag' }).last().click();
    await expect(page.getByText('Added to bag.').last()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bag');
    const [bagScrollWidth, bagClientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(bagScrollWidth).toBeLessThanOrEqual(bagClientWidth + 1);
    const removeButton = page.getByRole('button', { name: 'Remove' });
    const removeBox = await removeButton.boundingBox();
    expect(removeBox?.height).toBeGreaterThanOrEqual(44);

    await page.goto('/wishlist');
    const [wishlistScrollWidth, wishlistClientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(wishlistScrollWidth).toBeLessThanOrEqual(wishlistClientWidth + 1);
  });

  test('bag and wishlist pages have no critical or serious automated accessibility violations', async ({ page }) => {
    await page.goto('/bag');
    const bagResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(bagResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    await page.goto('/wishlist');
    const wishlistResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(wishlistResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
