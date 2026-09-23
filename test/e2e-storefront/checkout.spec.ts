import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110011';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Checkout browser E2E (M13, acceptance/m13-checkout.md). Provisions a
 * fully checkout-ready product (published, priced, in-stock, GST/HSN-
 * rate configured, PIN-code serviceable) via the real HTTP API, then
 * drives the actual Bag -> Checkout -> Confirmation flow in a real
 * browser for the COD path - the one path this milestone genuinely
 * completes end to end without an external payment gateway.
 */
test.describe('Checkout', () => {
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
      where: { slug: 'e2e-checkout-category' },
      update: {},
      create: { name: 'E2E Checkout Category', slug: 'e2e-checkout-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-CHK-M' },
      update: {},
      create: { label: 'E2E-CHK-M', sortOrder: 0 },
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
      data: { legalName: 'E2E Checkout Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };

    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: authHeaders,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLE2ECHK${Date.now() % 100000}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2ECHK${Date.now() % 100000}`, name: 'E2E Checkout Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: authHeaders,
      data: { code: `E2ECHKLOC${Date.now() % 100000}`, name: 'E2E Checkout Location', type: 'WAREHOUSE' },
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
        styleCode: `E2E-CHK-${Date.now()}`,
        name: 'E2E Checkout Jacket',
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
      await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 1499, sellingPrice: 1499 } }),
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

  test('completes a COD order end to end: bag -> checkout -> confirmation, with a real reservation created only at checkout submission', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/product/${styleId}`);

    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible();

    const reservationsBeforeCheckout = await prisma.inventoryReservation.count({ where: { sku: { styleId } } });
    expect(reservationsBeforeCheckout).toBe(0);

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByPlaceholder('Full name').fill('E2E Test Buyer');
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
    await expect(page.getByText(/Cash on Delivery order is confirmed/)).toBeVisible();

    const reservationsAfterCheckout = await prisma.inventoryReservation.findMany({ where: { sku: { styleId } } });
    expect(reservationsAfterCheckout).toHaveLength(1);
    expect(reservationsAfterCheckout[0]!.status).toBe('ACTIVE');
  });
});
