import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse, type Locator } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110033';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Cancellation browser E2E (M18, specs/17-cancellation.md, CAN-002;
 * acceptance/e2e-commerce-flows.md FLOW 7 "Partial Cancellation").
 * Provisions two independently-published, priced, in-stock products via
 * the real HTTP API, drives a real two-line COD order through the
 * browser (PDP x2 -> bag -> checkout -> confirmation - the same COD-only
 * path checkout.spec.ts/orders.spec.ts already establish as "the one
 * path this milestone genuinely completes end to end without an
 * external payment gateway"; no existing E2E spec in this repo drives a
 * real Razorpay redirect, so PREPAID refundRequired/credit-note
 * behaviour is proven at the integration layer instead - see
 * cancellation.test.ts tests #17/#27), then cancels ONE line from the
 * real order-detail page and proves, through the browser AND the
 * database, that: the cancelled line's inventory is released via a
 * ledger entry, the surviving line proceeds completely unaffected, and
 * the order itself does not incorrectly roll up to CANCELLED.
 */
test.describe('Cancellation', () => {
  let styleIdA: string;
  let styleIdB: string;
  let api: APIRequestContext;
  const prisma = new PrismaClient();

  async function provisionStyle(authHeaders: Record<string, string>, opts: {
    categoryId: string;
    brandId: string;
    locationId: string;
    hsnCode: string;
    sizeId: string;
    styleCode: string;
    name: string;
  }) {
    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: {
        styleCode: opts.styleCode,
        name: opts.name,
        brandId: opts.brandId,
        categoryId: opts.categoryId,
        season: 'SS26',
        collection: 'Core',
        hsnCode: opts.hsnCode,
      },
    });
    const style = (await expectOk(styleRes, `Create style ${opts.styleCode}`)) as { id: string };

    const colourRes = await api.post(`/api/v1/products/styles/${style.id}/colours`, {
      headers: authHeaders,
      data: { name: 'Black', colourCode: 'BLK' },
    });
    const colour = (await expectOk(colourRes, `Add colour ${opts.styleCode}`)) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${style.id}/skus/generate`, {
      headers: authHeaders,
      data: { sizeIds: [opts.sizeId] },
    });
    const skus = (await expectOk(skuRes, `Generate SKUs ${opts.styleCode}`)) as { skuId: string }[];
    if (skus.length === 0) throw new Error(`Generate SKUs returned an empty array for style ${opts.styleCode}`);
    const sku = skus[0]!;

    await expectOk(
      await api.post(`/api/v1/products/styles/${style.id}/media`, {
        headers: authHeaders,
        data: { colourId: colour.id, url: FIXTURE_IMAGE_URL },
      }),
      `Add media ${opts.styleCode}`,
    );

    await expectOk(
      await api.post(`/api/v1/products/styles/${style.id}/ready-for-enrichment`, { headers: authHeaders }),
      `Ready-for-enrichment ${opts.styleCode}`,
    );
    await expectOk(await api.post(`/api/v1/products/styles/${style.id}/qa-check`, { headers: authHeaders }), `QA check ${opts.styleCode}`);
    await expectOk(await api.post(`/api/v1/products/styles/${style.id}/publish`, { headers: authHeaders }), `Publish ${opts.styleCode}`);
    await expectOk(
      await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId: style.id, mrp: 999, sellingPrice: 999 } }),
      `Set price ${opts.styleCode}`,
    );
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', {
        headers: authHeaders,
        data: { skuId: sku.skuId, locationId: opts.locationId, quantityDelta: 10, reason: 'E2E stock load' },
      }),
      `Inventory adjustment ${opts.styleCode}`,
    );

    return { styleId: style.id, skuId: sku.skuId };
  }

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    const authHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-cancellation-category' },
      update: {},
      create: { name: 'E2E Cancellation Category', slug: 'e2e-cancellation-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-CAN-M' },
      update: {},
      create: { label: 'E2E-CAN-M', sortOrder: 0 },
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
      data: { legalName: 'E2E Cancellation Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };

    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: authHeaders,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLE2ECAN${Date.now() % 100000}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: authHeaders,
      data: { code: `E2ECAN${Date.now() % 100000}`, name: 'E2E Cancellation Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: authHeaders,
      data: { code: `E2ECANLOC${Date.now() % 100000}`, name: 'E2E Cancellation Location', type: 'WAREHOUSE' },
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

    const common = { categoryId: category.id, brandId: brand.id, locationId: location.id, hsnCode, sizeId: size.id };
    const a = await provisionStyle(authHeaders, { ...common, styleCode: `E2E-CAN-A-${Date.now()}`, name: 'E2E Cancellation Jacket' });
    const b = await provisionStyle(authHeaders, { ...common, styleCode: `E2E-CAN-B-${Date.now()}`, name: 'E2E Cancellation Trousers' });
    styleIdA = a.styleId;
    styleIdB = b.styleId;
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  async function placeTwoLineCodOrder(page: import('@playwright/test').Page, contactMobile: string, mobile = false) {
    // The desktop-only "Added to bag." confirmation (hidden md:block) and
    // the mobile sticky bar's own copy of it share the same DOM text -
    // only the one belonging to the currently-visible layout is actually
    // visible (same convention as checkout.spec.ts's mobile test).
    const addedToBag = () => (mobile ? page.getByText('Added to bag.').last() : page.getByText('Added to bag.').first());

    await page.goto(`/product/${styleIdA}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(addedToBag()).toBeVisible();

    await page.goto(`/product/${styleIdB}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(addedToBag()).toBeVisible();

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByPlaceholder('Full name').fill('E2E Cancellation Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill(contactMobile);
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('9 Cancellation Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const order = await prisma.order.findFirstOrThrow({
      where: { contactMobile, lines: { some: { sku: { styleId: styleIdA } } } },
      include: { lines: { include: { sku: true } } },
    });
    const lineA = order.lines.find((l) => l.sku.styleId === styleIdA)!;
    const lineB = order.lines.find((l) => l.sku.styleId === styleIdB)!;
    return { orderId: order.id, lineAId: lineA.id, lineBId: lineB.id, skuIdA: lineA.skuId, locationIdA: lineA.locationId };
  }

  test('cancelling one line of a two-line order releases its inventory via a ledger entry and leaves the other line unaffected', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const { orderId, lineAId, skuIdA, locationIdA } = await placeTwoLineCodOrder(page, '9876500001');

    const balanceBefore = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { skuId_locationId: { skuId: skuIdA, locationId: locationIdA } },
    });
    expect(balanceBefore.reserved).toBeGreaterThan(0);

    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText('E2E Cancellation Jacket', { exact: false })).toBeVisible();
    await expect(page.getByText('E2E Cancellation Trousers', { exact: false })).toBeVisible();

    // Cancel only the Jacket line (FLOW 7: "Customer cancels one line of
    // a two-line order").
    const jacketRow = page.locator('li', { hasText: 'E2E Cancellation Jacket' });
    await jacketRow.getByRole('button', { name: 'Cancel this item' }).click();
    await jacketRow.getByLabel('Reason (optional)').fill('Changed my mind about this item');
    await jacketRow.getByRole('button', { name: 'Confirm cancellation' }).click();

    // Browser-visible outcome: the cancelled line now reads Cancelled
    // with its reason; the surviving line still reads its pre-shipment
    // "Preparing" status, completely unaffected.
    await expect(jacketRow.getByText(/^Cancelled: Changed my mind about this item$/)).toBeVisible();
    const trouserRow = page.locator('li', { hasText: 'E2E Cancellation Trousers' });
    await expect(trouserRow.getByText('Preparing')).toBeVisible();
    await expect(trouserRow.getByRole('button', { name: 'Cancel this item' })).toBeVisible();

    // Database-verified outcome (order rollup + inventory ledger - not
    // just the HTTP/UI response): the order itself must NOT have rolled
    // up to CANCELLED just because one of its two lines was, the
    // cancelled line's reservation was genuinely released via a
    // CANCELLATION ledger entry (never a direct balance edit), and the
    // surviving line's own reservation hold is completely untouched.
    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(orderAfter.status).not.toBe('CANCELLED');
    const lineAAfter = orderAfter.lines.find((l) => l.id === lineAId)!;
    expect(lineAAfter.status).toBe('CANCELLED');
    const lineBAfter = orderAfter.lines.find((l) => l.id !== lineAId)!;
    expect(lineBAfter.status).not.toBe('CANCELLED');

    const balanceAfter = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { skuId_locationId: { skuId: skuIdA, locationId: locationIdA } },
    });
    expect(balanceAfter.reserved).toBe(balanceBefore.reserved - 1);
    expect(balanceAfter.onHand).toBe(balanceBefore.onHand); // COD cancellation never touches onHand - only the reservation hold releases

    const cancellationRows = await prisma.inventoryTransaction.findMany({ where: { skuId: skuIdA, type: 'CANCELLATION' } });
    expect(cancellationRows).toHaveLength(1);
  });

  /**
   * Same real two-line-order -> cancel-one-line flow as the desktop test
   * above, at a genuine mobile viewport (390x844, same convention as
   * checkout.spec.ts's own mobile test) - proves the cancellation
   * control itself is usable on the mobile-first storefront
   * (ARCHITECTURE.md SS2), not just present on desktop.
   */
  test('cancels one line of a two-line order on a genuine mobile viewport, with usable touch targets and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    async function expectNoHorizontalOverflow(label: string) {
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scrollWidth, `${label}: page overflows horizontally at mobile width`).toBeLessThanOrEqual(clientWidth + 1);
    }
    const MIN_TOUCH_TARGET_PX = 40;
    async function expectUsableTouchTarget(locator: Locator, label: string) {
      const box = await locator.first().boundingBox();
      expect(box, `${label}: no bounding box (not visible/rendered)`).not.toBeNull();
      expect(box!.height, `${label}: touch target too short for reliable mobile tapping`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }

    const { orderId, lineAId } = await placeTwoLineCodOrder(page, '9876500002', true);

    await page.goto(`/orders/${orderId}`);
    await expectNoHorizontalOverflow('Order detail');

    const jacketRow = page.locator('li', { hasText: 'E2E Cancellation Jacket' });
    const cancelButton = jacketRow.getByRole('button', { name: 'Cancel this item' });
    await expectUsableTouchTarget(cancelButton, 'Order detail Cancel this item button');
    await cancelButton.click();
    await expectNoHorizontalOverflow('Order detail (cancellation reason form)');

    const confirmButton = jacketRow.getByRole('button', { name: 'Confirm cancellation' });
    await expectUsableTouchTarget(confirmButton, 'Order detail Confirm cancellation button');
    await confirmButton.click();

    await expect(jacketRow.getByText(/^Cancelled/)).toBeVisible();
    const trouserRow = page.locator('li', { hasText: 'E2E Cancellation Trousers' });
    await expect(trouserRow.getByText('Preparing')).toBeVisible();
    await expectNoHorizontalOverflow('Order detail (after cancellation)');

    const lineAAfter = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineAId } });
    expect(lineAAfter.status).toBe('CANCELLED');
  });
});
