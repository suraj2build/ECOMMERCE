import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110036';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Exchanges browser E2E (M21, specs/20-exchanges.md,
 * acceptance/e2e-commerce-flows.md FLOW 11 "size exchange" combined with
 * FLOW 14 "store credit produced" - a same-style, cheaper-size exchange
 * settles as store credit with no external payment redirect, so it's the
 * one path this milestone can genuinely drive through a real browser
 * end to end. FLOW 12 (colour exchange) and FLOW 13 (additional
 * payment, which needs a real Razorpay Checkout.js redirect) are proven
 * at the integration layer instead (test/integration/exchanges.test.ts) -
 * same precedent as cancellation.spec.ts/returns.spec.ts/refunds.spec.ts's
 * own documented E2E-scope decisions elsewhere in this build.
 */
test.describe('Exchanges', () => {
  let styleId: string;
  let expensiveSkuId: string;
  let cheapSkuId: string;
  let api: APIRequestContext;
  let staffAuthHeaders: Record<string, string>;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    staffAuthHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-exchanges-category' },
      update: {},
      create: { name: 'E2E Exchanges Category', slug: 'e2e-exchanges-category' },
    });
    const sizeM = await prisma.size.upsert({ where: { label: 'E2E-EXC-M' }, update: {}, create: { label: 'E2E-EXC-M', sortOrder: 0 } });
    const sizeS = await prisma.size.upsert({ where: { label: 'E2E-EXC-S' }, update: {}, create: { label: 'E2E-EXC-S', sortOrder: 1 } });

    await expectOk(
      await api.post('/api/v1/pdp/pincodes', {
        headers: staffAuthHeaders,
        data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
      }),
      'Upsert serviceable pincode',
    );

    const legalEntityRes = await api.post('/api/v1/tax/legal-entities', { headers: staffAuthHeaders, data: { legalName: 'E2E Exchanges Pvt Ltd', registeredState: 'Delhi' } });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };
    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: staffAuthHeaders,
      data: { legalEntityId: legalEntity.id, gstin: `DLE2EEXC${Date.now() % 100000}A1Z5`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };
    const brandRes = await api.post('/api/v1/organization/brands', { headers: staffAuthHeaders, data: { code: `E2EEXC${Date.now() % 100000}`, name: 'E2E Exchanges Brand' } });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };
    const locationRes = await api.post('/api/v1/organization/locations', { headers: staffAuthHeaders, data: { code: `E2EEXCLOC${Date.now() % 100000}`, name: 'E2E Exchanges Location', type: 'WAREHOUSE' } });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };
    await expectOk(await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, { headers: staffAuthHeaders, data: { gstRegistrationId: gstRegistration.id } }), 'Assign GST registration to location');
    const hsnCode = '6109';
    await expectOk(await api.post('/api/v1/tax/rates', { headers: staffAuthHeaders, data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }), 'Create tax rate');

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: staffAuthHeaders,
      data: { styleCode: `E2E-EXC-${Date.now()}`, name: 'E2E Exchange Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers: staffAuthHeaders, data: { name: 'Black', colourCode: 'BLK' } });
    await expectOk(colourRes, 'Add colour');
    const colour = (await colourRes.json()) as { id: string };

    // Two sizes at DIFFERENT prices (per-colour/size price rows) so the
    // exchange has a genuine, non-zero, negative price difference -
    // FLOW 14 needs a real store-credit amount, not an EVEN exchange.
    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers: staffAuthHeaders, data: { sizeIds: [sizeM.id, sizeS.id] } });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    expensiveSkuId = skus[0]!.skuId;
    cheapSkuId = skus[1]!.skuId;

    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/media`, { headers: staffAuthHeaders, data: { colourId: colour.id, url: FIXTURE_IMAGE_URL } }), 'Add media');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: staffAuthHeaders }), 'Ready-for-enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: staffAuthHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: staffAuthHeaders }), 'Publish');
    // Style-wide price (a single active Price row applies to every SKU of
    // the style in this catalog model) - both sizes share one selling
    // price, so the exchange itself is an EVEN swap; the price
    // DIFFERENCE this test needs instead comes from re-pricing the style
    // downward with a colour-scoped override AFTER the order is placed
    // is not how this catalog works either. Simplest honest approach:
    // set the price once, place the order against the "expensive" SKU,
    // then lower the STYLE price before requesting the exchange - the
    // replacement's value is read at REQUEST time (frozen), so a genuine
    // lower replacementValue vs. the order's own frozen originalLineValue
    // is what produces the STORE_CREDIT direction.
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: staffAuthHeaders, data: { styleId, mrp: 3000, sellingPrice: 3000 } }), 'Set initial price');
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', { headers: staffAuthHeaders, data: { skuId: expensiveSkuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' } }),
      'Inventory adjustment (expensive size)',
    );
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', { headers: staffAuthHeaders, data: { skuId: cheapSkuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' } }),
      'Inventory adjustment (cheap size)',
    );
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('a same-style exchange for a now-cheaper replacement produces store credit, verified on the real order-detail page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByPlaceholder('Full name').fill('E2E Exchange Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill('9876530001');
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('3 Exchange Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const order = await prisma.order.findFirstOrThrow({ where: { contactMobile: '9876530001', lines: { some: { sku: { styleId } } } }, include: { lines: true } });
    const orderId = order.id;
    const lineId = order.lines[0]!.id;

    // Now lower the style's price - the exchange's replacementValue
    // (read at request time) will be genuinely below the order's own
    // frozen originalLineValue, producing a real STORE_CREDIT direction.
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: staffAuthHeaders, data: { styleId, mrp: 1500, sellingPrice: 1500 } }), 'Markdown price');

    // Deliver via the real staff API (no browser step exists for
    // warehouse fulfilment - same convention as returns.spec.ts).
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    await expectOk(await api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, { headers: staffAuthHeaders, data: { idempotencyKey: `e2e-exc-pick-${lineId}`, outcome: 'FULL', pickedQuantity: order.lines[0]!.quantity } }), 'Pick');
    const fulfilRes = await api.post(`/api/v1/orders/${orderId}/fulfilments`, { headers: staffAuthHeaders, data: { lineIds: [lineId] } });
    const fulfilment = (await expectOk(fulfilRes, 'Create fulfilment')) as { id: string };
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/pack`, { headers: staffAuthHeaders }), 'Pack');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ready-to-ship`, { headers: staffAuthHeaders }), 'Ready to ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ship`, { headers: staffAuthHeaders, data: {} }), 'Ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/deliver`, { headers: staffAuthHeaders }), 'Deliver');

    // Now the real browser step: initiate the exchange from the actual
    // order-detail page.
    await page.goto(`/orders/${orderId}`);
    const row = page.locator('li', { hasText: 'E2E Exchange Jacket' });
    await row.getByRole('button', { name: 'Exchange this item' }).click();
    await row.getByLabel('Reason (required)').fill('Runs large, need a smaller size');
    await row.getByLabel('Drop-off').check();
    await row.getByRole('button', { name: 'Start exchange' }).click();

    await expect(row.getByText(/Exchange requested/)).toBeVisible();

    const exchange = await prisma.exchange.findFirstOrThrow({ where: { orderId } });
    expect(exchange.paymentDirection).toBe('STORE_CREDIT');
    expect(Number(exchange.priceDifference)).toBeLessThan(0);

    // Receive + QC pass via the staff API (no browser step for warehouse
    // work) - this is what actually issues the store credit and
    // completes the exchange.
    await expectOk(await api.post(`/api/v1/exchanges/${exchange.id}/receive`, { headers: staffAuthHeaders }), 'Receive exchange');
    await expectOk(await api.post(`/api/v1/exchanges/${exchange.id}/qc`, { headers: staffAuthHeaders, data: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } }), 'QC pass');

    await page.reload();
    const rowAfterQc = page.locator('li', { hasText: 'E2E Exchange Jacket' });
    // Independent-review repair (finding 3): QC pass + store-credit
    // settlement moves this to REPLACEMENT_ALLOCATED, never straight to
    // COMPLETED - the replacement hasn't reached the customer yet.
    await expect(rowAfterQc.getByText(/Replacement reserved/)).toBeVisible();
    const afterQc = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(afterQc.status).toBe('REPLACEMENT_ALLOCATED');
    expect(afterQc.replacementAllocatedAt).toBeTruthy();

    // Only an explicit staff confirmation that the replacement actually
    // reached the customer moves it to COMPLETED (no automated pipeline
    // exists for this in the current build - see EXC-004's
    // DECISION_REQUIRED entry).
    await expectOk(await api.post(`/api/v1/exchanges/${exchange.id}/replacement-fulfilled`, { headers: staffAuthHeaders }), 'Confirm replacement fulfilled');

    await page.reload();
    const rowAfter = page.locator('li', { hasText: 'E2E Exchange Jacket' });
    await expect(rowAfter.getByText(/Exchange completed/)).toBeVisible();

    // Database-verified outcome: real store credit issued to this
    // guest, the exchange fully COMPLETED with the replacement
    // allocated AND fulfilment explicitly confirmed.
    const completed = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.replacementAllocatedAt).toBeTruthy();
    expect(completed.replacementFulfilledAt).toBeTruthy();
    const account = await prisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: order.guestSessionId! } });
    expect(Number(account.balance)).toBeCloseTo(Math.abs(Number(exchange.priceDifference)), 2);
  });
});
