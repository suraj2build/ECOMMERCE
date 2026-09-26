import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110035';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * Refunds / Store Credit browser E2E (M20, specs/19-refunds.md,
 * acceptance/e2e-commerce-flows.md FLOW 10 "COD return -> store
 * credit"). Mirrors returns.spec.ts's own convention: real HTTP API for
 * product/warehouse setup (delivery, return receipt, QC, refund
 * processing - no browser step exists for any of that staff-side work),
 * the browser only for the customer-facing outcome under test - here,
 * seeing "Refunded ... as store credit" appear on the real order-detail
 * page once the server has genuinely settled it. FLOW 9 (prepaid
 * refund) is proven at the integration layer instead
 * (test/integration/refunds.test.ts), same as cancellation.spec.ts's
 * own precedent: no E2E spec in this repo drives a real Razorpay
 * redirect.
 */
test.describe('Refunds & Store Credit', () => {
  let styleId: string;
  let api: APIRequestContext;
  let staffAuthHeaders: Record<string, string>;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    staffAuthHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-refunds-category' },
      update: {},
      create: { name: 'E2E Refunds Category', slug: 'e2e-refunds-category' },
    });
    const size = await prisma.size.upsert({
      where: { label: 'E2E-REF-M' },
      update: {},
      create: { label: 'E2E-REF-M', sortOrder: 0 },
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
      data: { legalName: 'E2E Refunds Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };

    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: staffAuthHeaders,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLE2EREF${Date.now() % 100000}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', {
      headers: staffAuthHeaders,
      data: { code: `E2EREF${Date.now() % 100000}`, name: 'E2E Refunds Brand' },
    });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };

    const locationRes = await api.post('/api/v1/organization/locations', {
      headers: staffAuthHeaders,
      data: { code: `E2EREFLOC${Date.now() % 100000}`, name: 'E2E Refunds Location', type: 'WAREHOUSE' },
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
      data: { styleCode: `E2E-REF-${Date.now()}`, name: 'E2E Refunds Sneaker', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers: staffAuthHeaders, data: { name: 'White', colourCode: 'WHT' } });
    await expectOk(colourRes, 'Add colour');
    const colour = (await colourRes.json()) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers: staffAuthHeaders, data: { sizeIds: [size.id] } });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    const skuId = skus[0]!.skuId;

    await expectOk(
      await api.post(`/api/v1/products/styles/${styleId}/media`, { headers: staffAuthHeaders, data: { colourId: colour.id, url: FIXTURE_IMAGE_URL } }),
      'Add media',
    );
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: staffAuthHeaders }), 'Ready-for-enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: staffAuthHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: staffAuthHeaders }), 'Publish');
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: staffAuthHeaders, data: { styleId, mrp: 2499, sellingPrice: 2499 } }), 'Set price');
    await expectOk(
      await api.post('/api/v1/inventory/adjustments', { headers: staffAuthHeaders, data: { skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' } }),
      'Inventory adjustment',
    );
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  async function placeOneLineCodOrder(page: import('@playwright/test').Page, contactMobile: string) {
    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    await page.getByPlaceholder('Full name').fill('E2E Refunds Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill(contactMobile);
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('7 Refunds Lane');
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

  /** Deliver -> initiate a return -> receive -> QC pass -> process the refund - all via the real staff API, exactly as a warehouse/CS/Finance team would drive it. No browser step exists for any of this (returns.spec.ts's own convention). */
  async function deliverReturnAndRefund(orderId: string, lineId: string) {
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });
    await expectOk(
      await api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, { headers: staffAuthHeaders, data: { idempotencyKey: `e2e-ref-pick-${lineId}`, outcome: 'FULL', pickedQuantity: line.quantity } }),
      'Pick task',
    );
    const fulfilRes = await api.post(`/api/v1/orders/${orderId}/fulfilments`, { headers: staffAuthHeaders, data: { lineIds: [lineId] } });
    const fulfilment = (await expectOk(fulfilRes, 'Create fulfilment')) as { id: string };
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/pack`, { headers: staffAuthHeaders }), 'Pack');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ready-to-ship`, { headers: staffAuthHeaders }), 'Ready to ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/ship`, { headers: staffAuthHeaders, data: {} }), 'Ship');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/deliver`, { headers: staffAuthHeaders }), 'Deliver');

    const returnRes = await api.post('/api/v1/returns', {
      headers: staffAuthHeaders,
      data: { orderId, lines: [{ orderLineId: lineId, reason: 'Wrong size' }], method: 'DROP_OFF', idempotencyKey: `e2e-ref-ret-${lineId}` },
    });
    const created = (await expectOk(returnRes, 'Initiate return')) as { id: string; lines: { id: string }[] };
    await expectOk(await api.post(`/api/v1/returns/${created.id}/receive`, { headers: staffAuthHeaders }), 'Receive return');
    await expectOk(
      await api.post(`/api/v1/returns/${created.id}/lines/${created.lines[0]!.id}/qc`, { headers: staffAuthHeaders, data: { qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE' } }),
      'QC pass',
    );

    const refundRes = await api.post('/api/v1/refunds', { headers: staffAuthHeaders, data: { orderId, orderLineId: lineId, idempotencyKey: `e2e-ref-refund-${lineId}` } });
    const refund = (await expectOk(refundRes, 'Process refund')) as { status: string; amount: string };
    expect(refund.status).toBe('COMPLETED');
    return refund;
  }

  test('a COD return, once QC-passed and refunded, shows as refunded-to-store-credit on the real order-detail page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const { orderId, lineId } = await placeOneLineCodOrder(page, '9876520001');
    const refund = await deliverReturnAndRefund(orderId, lineId);

    await page.goto(`/orders/${orderId}`);
    const row = page.locator('li', { hasText: 'E2E Refunds Sneaker' });
    await expect(row.getByText(/^Refunded - /)).toHaveText(`Refunded - ₹${refund.amount} as store credit`);

    // Database-verified outcome, not just the browser-visible text: a
    // real StoreCreditAccount/StoreCreditEntry pair now exists for this
    // guest, and the return itself rolled all the way to DISPOSITIONED.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const account = await prisma.storeCreditAccount.findUniqueOrThrow({ where: { guestSessionId: order.guestSessionId! } });
    expect(Number(account.balance)).toBeCloseTo(Number(refund.amount), 2);
    const returnRow = await prisma.return.findFirstOrThrow({ where: { orderId } });
    expect(returnRow.status).toBe('DISPOSITIONED');
  });
});
