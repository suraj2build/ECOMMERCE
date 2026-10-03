import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

/**
 * LR-003 consent-aware GA4 and Meta Pixel, in a real browser against a
 * storefront built with test tag IDs (CI: G-E2ETEST01 / 1234567890). The tag
 * scripts are stubbed at the network layer, so nothing reaches Google or
 * Meta; what is asserted is what the storefront hands to the tags.
 *
 * - Before a choice, and after refusal, no tag script loads and no event is queued.
 * - After consent, discovery-to-purchase events carry SKU codes, INR and the
 *   order number; no name, email, phone or address.
 * - Withdrawal stops further events and deletes the tag cookies.
 * - The choice travels with the order (server-side events honour it), and
 *   the browser Meta Purchase fires once, with event ID purchase:<orderNumber>,
 *   only for a confirmed order.
 */

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const PINCODE = '110013';
const TAG_HOSTS = /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|facebook\.com\/tr/;

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text().catch(() => '')}`);
  return res.json();
}

test.use({ storageState: { cookies: [], origins: [] } });

/** Stubs both tag scripts and records every request to a tag host. */
async function stubTags(page: Page) {
  const requests: string[] = [];
  await page.route(TAG_HOSTS, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* tag stub */' });
  });
  await page.addInitScript(() => localStorage.setItem('vanya_department', 'women'));
  return requests;
}

/** gtag event calls and fbq track calls the storefront has queued. */
async function tagCalls(page: Page) {
  return page.evaluate(() => {
    const ga = ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((args) => Array.from(args as unknown as unknown[]))
      .filter((args) => args[0] === 'event')
      .map((args) => ({ name: args[1] as string, params: args[2] as Record<string, unknown> }));
    const fbq = ((window as unknown as { fbq?: { queue?: unknown[][] } }).fbq?.queue ?? [])
      .filter((args) => args[0] === 'track')
      .map((args) => ({ name: args[1] as string, params: args[2] as Record<string, unknown>, options: args[3] as Record<string, unknown> | undefined }));
    return { ga, fbq };
  });
}

test.describe('Consent-aware analytics (LR-003)', () => {
  test.skip(!process.env.CI && !process.env.E2E_TRACKING_IDS, 'Needs a storefront built with NEXT_PUBLIC_GA4_MEASUREMENT_ID and NEXT_PUBLIC_META_PIXEL_ID');

  let styleId: string;
  let skuCode: string;
  let styleCode: string;
  let api: APIRequestContext;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });
    const { token } = (await expectOk(await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }), 'Staff login')) as { token: string };
    const headers = { authorization: `Bearer ${token}` };
    const stamp = Date.now() % 100000;
    const category = await prisma.category.upsert({ where: { slug: 'e2e-consent-category' }, update: {}, create: { name: 'E2E Consent Category', slug: 'e2e-consent-category' } });
    const size = await prisma.size.upsert({ where: { label: 'E2E-CNS-M' }, update: {}, create: { label: 'E2E-CNS-M', sortOrder: 0 } });
    await expectOk(await api.post('/api/v1/pdp/pincodes', { headers, data: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } }), 'Pincode');
    const entity = (await expectOk(await api.post('/api/v1/tax/legal-entities', { headers, data: { legalName: 'E2E Consent Pvt Ltd', registeredState: 'Delhi' } }), 'Legal entity')) as { id: string };
    const gst = (await expectOk(await api.post('/api/v1/tax/gst-registrations', { headers, data: { legalEntityId: entity.id, gstin: `DLE2ECNS${stamp}A1Z5`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }), 'GST')) as { id: string };
    const brand = (await expectOk(await api.post('/api/v1/organization/brands', { headers, data: { code: `E2ECNS${stamp}`, name: 'E2E Consent Brand' } }), 'Brand')) as { id: string };
    const location = (await expectOk(await api.post('/api/v1/organization/locations', { headers, data: { code: `E2ECNSLOC${stamp}`, name: 'E2E Consent Location', type: 'WAREHOUSE' } }), 'Location')) as { id: string };
    await expectOk(await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, { headers, data: { gstRegistrationId: gst.id } }), 'Assign GST');
    await expectOk(await api.post('/api/v1/tax/rates', { headers, data: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }), 'Tax rate');
    styleCode = `E2E-CNS-${Date.now()}`;
    const style = (await expectOk(await api.post('/api/v1/products/styles', { headers, data: { styleCode, name: 'E2E Consent Kurta', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode: '6109' } }), 'Style')) as { id: string };
    styleId = style.id;
    const colour = (await expectOk(await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers, data: { name: 'Black', colourCode: 'BLK' } }), 'Colour')) as { id: string };
    const [sku] = (await expectOk(await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers, data: { sizeIds: [size.id] } }), 'SKUs')) as { skuId: string }[];
    skuCode = (await prisma.sku.findUniqueOrThrow({ where: { id: sku!.skuId } })).skuCode;
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/media`, { headers, data: { colourId: colour.id, url: `${STOREFRONT_URL}/e2e-fixture.png` } }), 'Media');
    for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) await expectOk(await api.post(`/api/v1/products/styles/${styleId}/${step}`, { headers }), step);
    await expectOk(await api.post('/api/v1/catalog/prices', { headers, data: { styleId, mrp: 1299, sellingPrice: 1299 } }), 'Price');
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers, data: { skuId: sku!.skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load', idempotencyKey: `e2e-consent-stock-${sku!.skuId}` } }), 'Stock');
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  test('nothing loads or is queued before a choice or after refusal; the choice can be reopened', async ({ page }) => {
    const requests = await stubTags(page);
    await page.goto(`/product/${styleId}`);
    await expect(page.getByTestId('consent-banner')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requests).toEqual([]);
    expect(await tagCalls(page)).toEqual({ ga: [], fbq: [] });

    await page.getByRole('button', { name: 'Reject all' }).click();
    await expect(page.getByTestId('consent-banner')).toHaveCount(0);
    await page.reload();
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible();
    await expect(page.getByTestId('consent-banner')).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(await tagCalls(page)).toEqual({ ga: [], fbq: [] });

    await page.getByRole('button', { name: 'Privacy choices' }).click();
    await expect(page.getByTestId('consent-banner')).toBeVisible();
  });

  test('after consent, events carry SKU codes, the style group and INR, and no personal data; withdrawal stops them', async ({ page, context }) => {
    const requests = await stubTags(page);
    await page.goto(`/product/${styleId}`);
    await page.getByRole('button', { name: 'Accept all' }).click();
    await expect.poll(() => requests.some((url) => url.includes('googletagmanager.com/gtag/js?id=G-'))).toBe(true);
    await expect.poll(() => requests.some((url) => url.includes('connect.facebook.net'))).toBe(true);

    await page.reload();
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible();
    const calls = await tagCalls(page);
    const viewItem = calls.ga.find((c) => c.name === 'view_item')!;
    expect(viewItem.params).toMatchObject({ currency: 'INR', items: [expect.objectContaining({ item_group_id: styleCode })] });
    const addToCart = calls.ga.find((c) => c.name === 'add_to_cart')!;
    expect(addToCart.params).toMatchObject({ currency: 'INR', items: [expect.objectContaining({ item_id: skuCode, item_group_id: styleCode })] });
    expect(calls.fbq.find((c) => c.name === 'AddToCart')!.params).toMatchObject({ content_ids: [skuCode], currency: 'INR' });
    expect(calls.fbq.find((c) => c.name === 'ViewContent')!.params).toMatchObject({ content_ids: [styleCode], content_type: 'product_group' });

    // Withdraw: no new events, tag cookies removed.
    await context.addCookies([
      { name: '_ga', value: 'GA1.1.111.222', url: STOREFRONT_URL },
      { name: '_fbp', value: 'fb.1.1700000000000.123', url: STOREFRONT_URL },
    ]);
    await page.getByRole('button', { name: 'Privacy choices' }).click();
    for (const box of await page.getByTestId('consent-banner').getByRole('checkbox').all()) await box.uncheck();
    await page.getByRole('button', { name: 'Save choices' }).click();
    const before = await tagCalls(page);
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible();
    const after = await tagCalls(page);
    expect(after.ga.length).toBe(before.ga.length);
    expect(after.fbq.length).toBe(before.fbq.length);
    const cookies = (await context.cookies(STOREFRONT_URL)).map((c) => c.name);
    expect(cookies).not.toContain('_ga');
    expect(cookies).not.toContain('_fbp');
  });

  test('a consented COD order carries the choice to the server and records the Meta purchase once, with the order number as event ID', async ({ page, context }) => {
    const requests = await stubTags(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/product/${styleId}`);
    await page.getByRole('button', { name: 'Accept all' }).click();
    await context.addCookies([
      { name: '_ga', value: 'GA1.1.555666777.1700000000', url: STOREFRONT_URL },
      { name: '_fbp', value: 'fb.1.1700000000000.424242', url: STOREFRONT_URL },
    ]);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/checkout');
    await page.getByPlaceholder('Full name').fill('Consent Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill('9876500001');
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('7 Consent Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    const beginCheckout = (await tagCalls(page)).ga.find((c) => c.name === 'begin_checkout');
    expect(beginCheckout?.params).toMatchObject({ currency: 'INR', items: [expect.objectContaining({ item_id: skuCode })] });
    // Choosing a payment method is not a purchase.
    await page.getByLabel('Cash on Delivery').check();
    expect((await tagCalls(page)).fbq.some((c) => c.name === 'Purchase')).toBe(false);
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({ timeout: 10_000 });

    const sessionId = page.url().split('/').pop()!;
    const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
    expect(order).toMatchObject({ analyticsConsent: true, marketingConsent: true, analyticsClientId: '555666777.1700000000', metaBrowserId: 'fb.1.1700000000000.424242' });

    await expect.poll(async () => (await tagCalls(page)).fbq.filter((c) => c.name === 'Purchase').length).toBe(1);
    const purchase = (await tagCalls(page)).fbq.find((c) => c.name === 'Purchase')!;
    expect(purchase.options).toEqual({ eventID: `purchase:${order.orderNumber}` });
    expect(purchase.params).toMatchObject({ currency: 'INR', content_ids: [skuCode], value: Number(order.grandTotal) });
    // GA4's purchase is server-side only.
    expect((await tagCalls(page)).ga.some((c) => c.name === 'purchase')).toBe(false);
    const everything = JSON.stringify(await tagCalls(page)).toLowerCase();
    for (const personal of ['consent buyer', '9876500001', 'consent lane', PINCODE]) expect(everything).not.toContain(personal);

    // A reload of the confirmation page does not record the purchase again.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect((await tagCalls(page)).fbq.filter((c) => c.name === 'Purchase')).toHaveLength(0);
    expect(requests.length).toBeGreaterThan(0);
  });
});
