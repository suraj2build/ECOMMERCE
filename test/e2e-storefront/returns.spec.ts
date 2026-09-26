import path from 'node:path';
import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

// Playwright's config runs from the repo root - a real local file path is
// required for setInputFiles (unlike the URL fixtures used elsewhere in
// this file), so this resolves relative to the process's own cwd rather
// than this module's own location.
const FIXTURE_IMAGE_PATH = path.join(process.cwd(), 'apps/storefront/public/e2e-fixture.png');

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110034';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Returns browser E2E (M19, specs/18-returns.md, RET-001-004;
 * acceptance/m19-returns.md). Provisions one published, priced, in-stock
 * product via the real HTTP API, drives a real one-line COD order all the
 * way to DELIVERED via the same staff pick/pack/ship/deliver API path
 * `returns.test.ts`'s own `deliverOrderLine` helper uses (no browser
 * step exists for warehouse fulfilment - this mirrors cancellation.spec.ts's
 * own convention of using the API for setup and the browser only for the
 * customer-facing action under test), then initiates and withdraws a
 * return from the real order-detail page, proving both the browser-visible
 * outcome and the underlying database state.
 */
test.describe('Returns', () => {
  let styleId: string;
  let api: APIRequestContext;
  let staffAuthHeaders: Record<string, string>;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    staffAuthHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-returns-category' },
      update: {},
      create: { name: 'E2E Returns Category', slug: 'e2e-returns-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-RET-M' },
      update: {},
      create: { label: 'E2E-RET-M', sortOrder: 0 },
    });

    await expectOk(
      await api.post('/api/v1/pdp/pincodes', {
        headers: staffAuthHeaders,
        data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
      }),
      'Upsert serviceable pincode',
    );

    const legalEntityRes = await api.post('/api/v1/tax/legal-entities', {
      headers: staffAuthHeaders,
      data: { legalName: 'E2E Returns Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };

    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: staffAuthHeaders,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLE2ERET${Date.now() % 100000}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: staffAuthHeaders,
      data: { code: `E2ERET${Date.now() % 100000}`, name: 'E2E Returns Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: staffAuthHeaders,
      data: { code: `E2ERETLOC${Date.now() % 100000}`, name: 'E2E Returns Location', type: 'WAREHOUSE' },
    });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };

    await expectOk(
      await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, {
        headers: staffAuthHeaders,
        data: { gstRegistrationId: gstRegistration.id },
      }),
      'Assign GST registration to location',
    );

    const hsnCode = '6109';
    await expectOk(
      await api.post('/api/v1/tax/rates', {
        headers: staffAuthHeaders,
        data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() },
      }),
      'Create tax rate',
    );

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: staffAuthHeaders,
      data: {
        styleCode: `E2E-RET-${Date.now()}`,
        name: 'E2E Returns Hoodie',
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
      headers: staffAuthHeaders,
      data: { name: 'Black', colourCode: 'BLK' },
    });
    await expectOk(colourRes, 'Add colour');
    const colour = (await colourRes.json()) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, {
      headers: staffAuthHeaders,
      data: { sizeIds: [size.id] },
    });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    const skuId = skus[0]!.skuId;

    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/media`, {
        headers: staffAuthHeaders,
        data: { colourId: colour.id, url: FIXTURE_IMAGE_URL },
      }),
      'Add media',
    );

    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: staffAuthHeaders }), 'Ready-for-enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: staffAuthHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: staffAuthHeaders }), 'Publish');
    await expectOk(
      await api.post('/api/v1/catalog/prices', { headers: staffAuthHeaders, data: { styleId, mrp: 1499, sellingPrice: 1499 } }),
      'Set price',
    );
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', {
        headers: staffAuthHeaders,
        data: { skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' },
      }),
      'Inventory adjustment',
    );
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  async function placeOneLineCodOrder(page: import('@playwright/test').Page, contactMobile: string, mobile = false) {
    // The desktop-only "Added to bag." confirmation (hidden md:block) and
    // the mobile sticky bar's own copy of it share the same DOM text -
    // only the one belonging to the currently-visible layout is actually
    // visible (same convention as cancellation.spec.ts/checkout.spec.ts's
    // own mobile tests).
    const addedToBag = () => (mobile ? page.getByText('Added to bag.').last() : page.getByText('Added to bag.').first());

    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(addedToBag()).toBeVisible();

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByPlaceholder('Full name').fill('E2E Returns Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill(contactMobile);
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('12 Returns Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const order = await prisma.order.findFirstOrThrow({
      where: { contactMobile, lines: { some: { sku: { styleId } } } },
      include: { lines: true },
    });
    return { orderId: order.id, lineId: order.lines[0]!.id };
  }

  /** Same pick -> fulfil -> pack -> ready-to-ship -> ship -> deliver API sequence returns.test.ts's own deliverOrderLine helper uses - no browser step exists for warehouse fulfilment. */
  async function deliverOrder(orderId: string, lineId: string) {
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    await expectOk(
      await api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, {
        headers: staffAuthHeaders,
        data: { idempotencyKey: `e2e-pick-${lineId}`, outcome: 'FULL', pickedQuantity: line.quantity },
      }),
      'Pick task',
    );
    const fulfilRes = await api.post(`/api/v1/orders/${orderId}/fulfilments`, { headers: staffAuthHeaders, data: { lineIds: [lineId] } });
    const fulfilment = (await expectOk(fulfilRes, 'Create fulfilment')) as { id: string };
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/pack`, { headers: staffAuthHeaders }), 'Pack');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ready-to-ship`, { headers: staffAuthHeaders }), 'Ready to ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ship`, { headers: staffAuthHeaders, data: {} }), 'Ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/deliver`, { headers: staffAuthHeaders }), 'Deliver');
  }

  test('customer initiates and withdraws a return for a delivered item from the order-detail page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const { orderId, lineId } = await placeOneLineCodOrder(page, '9876510001');
    await deliverOrder(orderId, lineId);

    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText('E2E Returns Hoodie', { exact: false })).toBeVisible();
    await expect(page.getByText('Delivered', { exact: false }).first()).toBeVisible();

    const hoodieRow = page.locator('li', { hasText: 'E2E Returns Hoodie' });
    await hoodieRow.getByRole('button', { name: 'Return this item' }).click();

    // Mandatory reason (RET-001: unlike M18's optional cancellation
    // reason, a return reason is required) - submitting blank must be
    // rejected client-side before any request is sent.
    await hoodieRow.getByRole('button', { name: 'Start return' }).click();
    await expect(hoodieRow.getByRole('alert')).toHaveText(/tell us why/i);

    await hoodieRow.getByLabel(/Reason/).fill('Wrong size, need a smaller one');
    await hoodieRow.getByLabel('Drop-off').check();
    await hoodieRow.getByRole('button', { name: 'Start return' }).click();

    await expect(hoodieRow.getByText(/Return requested/)).toBeVisible();

    const returnRow = await prisma.return.findFirstOrThrow({ where: { orderId }, include: { lines: true } });
    expect(returnRow.method).toBe('DROP_OFF');
    expect(returnRow.status).toBe('REQUESTED');
    expect(returnRow.lines[0]!.reason).toBe('Wrong size, need a smaller one');

    // Withdraw it - browser-visible outcome (status flips to "Return
    // cancelled") and database-verified outcome together.
    await hoodieRow.getByRole('button', { name: 'Cancel return' }).click();
    await expect(hoodieRow.getByText(/Return cancelled/)).toBeVisible();

    const returnAfter = await prisma.return.findUniqueOrThrow({ where: { id: returnRow.id } });
    expect(returnAfter.status).toBe('CANCELLED');

    // "Return this item" must not reappear for a withdrawn return the
    // storefront doesn't let a customer silently re-initiate over its own
    // cancelled record within this page's current UI.
    await expect(hoodieRow.getByRole('button', { name: 'Return this item' })).not.toBeVisible();
  });

  /**
   * Same real order -> deliver -> return flow as the desktop test above,
   * at a genuine mobile viewport (390x844, same convention as
   * cancellation.spec.ts's own mobile test) - proves the return control
   * itself is usable on the mobile-first storefront, not just present on
   * desktop.
   */
  test('initiates a return on a genuine mobile viewport, with usable touch targets and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    async function expectNoHorizontalOverflow(label: string) {
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scrollWidth, `${label}: page overflows horizontally at mobile width`).toBeLessThanOrEqual(clientWidth + 1);
    }
    const MIN_TOUCH_TARGET_PX = 40;
    async function expectUsableTouchTarget(locator: import('@playwright/test').Locator, label: string) {
      const box = await locator.first().boundingBox();
      expect(box, `${label}: no bounding box (not visible/rendered)`).not.toBeNull();
      expect(box!.height, `${label}: touch target too short for reliable mobile tapping`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }

    const { orderId, lineId } = await placeOneLineCodOrder(page, '9876510002', true);
    await deliverOrder(orderId, lineId);

    await page.goto(`/orders/${orderId}`);
    await expectNoHorizontalOverflow('Order detail');

    const hoodieRow = page.locator('li', { hasText: 'E2E Returns Hoodie' });
    const returnButton = hoodieRow.getByRole('button', { name: 'Return this item' });
    await expectUsableTouchTarget(returnButton, 'Order detail Return this item button');
    await returnButton.click();
    await expectNoHorizontalOverflow('Order detail (return form)');

    await hoodieRow.getByLabel(/Reason/).fill('Colour looks different in person');
    await hoodieRow.getByLabel('Carrier pickup').check();

    const startButton = hoodieRow.getByRole('button', { name: 'Start return' });
    await expectUsableTouchTarget(startButton, 'Order detail Start return button');
    await startButton.click();

    await expect(hoodieRow.getByText(/Return requested/)).toBeVisible();
    await expectNoHorizontalOverflow('Order detail (after return initiated)');

    const returnRow = await prisma.return.findFirstOrThrow({ where: { orderId } });
    expect(returnRow.method).toBe('PICKUP');
  });

  /**
   * Independent-review repair (finding 2, specs/18-returns.md mobile
   * behaviour): the mobile-camera-friendly evidence-upload flow, driven
   * through a real browser at a genuine mobile viewport. Playwright's
   * `setInputFiles` is the standard way to drive a
   * `<input type="file" capture="environment">` in an automated test -
   * it exercises the exact same file-selection code path a real phone's
   * camera-capture UI would hand back to the page, without needing an
   * actual camera in CI.
   */
  test('uploads return-condition evidence via the mobile-camera-friendly upload control on a genuine mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const { orderId, lineId } = await placeOneLineCodOrder(page, '9876510003', true);
    await deliverOrder(orderId, lineId);

    await page.goto(`/orders/${orderId}`);
    const hoodieRow = page.locator('li', { hasText: 'E2E Returns Hoodie' });
    await hoodieRow.getByRole('button', { name: 'Return this item' }).click();
    await hoodieRow.getByLabel(/Reason/).fill('Fabric feels different from the photos');
    await hoodieRow.getByLabel('Drop-off').check();
    await hoodieRow.getByRole('button', { name: 'Start return' }).click();
    await expect(hoodieRow.getByText(/Return requested/)).toBeVisible();

    // The upload control is present and offered as optional by default
    // (no evidenceRequired policy configured for this style/category).
    const fileInput = hoodieRow.locator('input[type="file"]');
    await expect(hoodieRow.getByText(/Add a photo of item condition \(optional\)/)).toBeVisible();

    await fileInput.setInputFiles(FIXTURE_IMAGE_PATH);
    await expect(hoodieRow.getByText(/1 photo added/)).toBeVisible({ timeout: 10_000 });

    // Database-verified outcome: a real, private ReturnEvidence row
    // exists, correctly attributed to the customer, sniffed as a
    // genuine PNG.
    const returnRow = await prisma.return.findFirstOrThrow({ where: { orderId }, include: { lines: true } });
    const evidence = await prisma.returnEvidence.findFirstOrThrow({ where: { returnLineId: returnRow.lines[0]!.id } });
    expect(evidence.mimeType).toBe('image/png');
    expect(evidence.uploadedBy).toBe('CUSTOMER');
    expect(evidence.sizeBytes).toBeGreaterThan(0);

    // A second upload increments the count rather than replacing it.
    await fileInput.setInputFiles(FIXTURE_IMAGE_PATH);
    await expect(hoodieRow.getByText(/2 photos added/)).toBeVisible({ timeout: 10_000 });
    expect(await prisma.returnEvidence.count({ where: { returnLineId: returnRow.lines[0]!.id } })).toBe(2);
  });
});
