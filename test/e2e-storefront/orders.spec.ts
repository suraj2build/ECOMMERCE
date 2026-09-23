import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110099';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Order history browser E2E (M15, specs/14-order-management.md - "Full
 * order history MUST be retained and queryable for the customer's
 * account"). Provisions a checkout-ready product the same way
 * checkout.spec.ts does, completes a real COD order through the browser,
 * then proves the resulting Order is genuinely visible on /orders and
 * /orders/[id] - not just present in the database.
 */
test.describe('Order history', () => {
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
      where: { slug: 'e2e-orders-category' },
      update: {},
      create: { name: 'E2E Orders Category', slug: 'e2e-orders-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-ORD-M' },
      update: {},
      create: { label: 'E2E-ORD-M', sortOrder: 0 },
    });

    await expectOk(
      await api.post('/api/v1/pdp/pincodes', {
        headers: authHeaders,
        data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
      }),
      'Upsert serviceable pincode',
    );

    const legalEntityRes = await api.post('/api/v1/tax/legal-entities', {
      headers: authHeaders,
      data: { legalName: 'E2E Orders Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };

    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: authHeaders,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLE2EORD${Date.now() % 100000}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2EORD${Date.now() % 100000}`, name: 'E2E Orders Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: authHeaders,
      data: { code: `E2EORDLOC${Date.now() % 100000}`, name: 'E2E Orders Location', type: 'WAREHOUSE' },
    });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };

    await expectOk(
      await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, {
        headers: authHeaders,
        data: { gstRegistrationId: gstRegistration.id },
      }),
      'Assign GST registration to location',
    );

    const hsnCode = '6109';
    await expectOk(
      await api.post('/api/v1/tax/rates', {
        headers: authHeaders,
        data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() },
      }),
      'Create tax rate',
    );

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: {
        styleCode: `E2E-ORD-${Date.now()}`,
        name: 'E2E Order History Jacket',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        hsnCode,
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
      await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 899, sellingPrice: 899 } }),
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

  test('a completed COD order is genuinely visible on the storefront order-history pages', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Before ever ordering: an empty order history, not an error.
    await page.goto('/orders');
    await expect(page.getByText('You have no orders yet.')).toBeVisible();

    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible();

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByPlaceholder('Full name').fill('E2E Order History Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill('9876543210');
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('221B Test Street');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    // Now the order genuinely appears in this same browser's order history.
    await page.getByRole('link', { name: 'Orders' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByText(/^ORD-\d{4}-\d{6}$/)).toBeVisible();
    await expect(page.getByText('Confirmed')).toBeVisible();

    await page.getByText(/^ORD-\d{4}-\d{6}$/).click();
    await expect(page.getByRole('heading', { name: /^Order ORD-\d{4}-\d{6}$/ })).toBeVisible();
    await expect(page.getByText('E2E Order History Jacket', { exact: false })).toBeVisible();
    await expect(page.getByText('Preparing')).toBeVisible();
  });
});
