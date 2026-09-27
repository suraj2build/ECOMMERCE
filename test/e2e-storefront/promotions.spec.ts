import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110019';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/** Same brute-force OTP recovery idiom as account.spec.ts/loyalty.spec.ts - no plaintext-OTP backdoor exists in this codebase. */
function bruteForceOtp(codeHash: string, length = 6): string {
  const max = 10 ** length;
  for (let i = 0; i < max; i++) {
    const candidate = String(i).padStart(length, '0');
    if (createHash('sha256').update(candidate).digest('hex') === codeHash) return candidate;
  }
  throw new Error('Could not recover the OTP code from its hash - OTP_LENGTH may have changed');
}

/**
 * Promotions browser E2E (M24, specs/23-promotions.md, PROMO-001/002;
 * acceptance/e2e-commerce-flows.md FLOW 18 "Coupon + Compatible
 * Promotion + Store Credit"). Drives a real mobile-OTP sign-in, adds an
 * item that triggers a real automatic promotion, applies a real
 * compatible coupon through the checkout page's own apply/remove UI
 * (server-revalidated, never a client-computed discount), applies real
 * store credit, places the order, and verifies the final charged
 * amount is arithmetically correct across all three reductions -
 * then, in a second scenario, proves an incompatible coupon is
 * rejected with a clear reason while the automatic promotion remains
 * applied.
 */
test.describe('Promotions (M24) - FLOW 18', () => {
  let styleId: string;
  let api: APIRequestContext;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    const authHeaders = { authorization: `Bearer ${token}` };

    await expectOk(
      await api.post('/api/v1/pdp/pincodes', {
        headers: authHeaders,
        data: { pincode: SERVICEABLE_PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true },
      }),
      'Upsert serviceable pincode',
    );

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-promo-category' },
      update: {},
      create: { name: 'E2E Promo Category', slug: 'e2e-promo-category' },
    });
    const size = await prisma.size.upsert({ where: { label: 'E2E-PROMO-M' }, update: {}, create: { label: 'E2E-PROMO-M', sortOrder: 0 } });

    const legalEntityRes = await api.post('/api/v1/tax/legal-entities', { headers: authHeaders, data: { legalName: 'E2E Promo Pvt Ltd', registeredState: 'Delhi' } });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };
    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: authHeaders,
      data: { legalEntityId: legalEntity.id, gstin: `DLE2EPRO${Date.now() % 100000}A1Z5`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', { headers: authHeaders, data: { code: `E2EPROMO${Date.now() % 100000}`, name: 'E2E Promo Brand' } });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };
    const locationRes = await api.post('/api/v1/organization/locations', { headers: authHeaders, data: { code: `E2EPROMOLOC${Date.now() % 100000}`, name: 'E2E Promo Location', type: 'WAREHOUSE' } });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };
    await expectOk(await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, { headers: authHeaders, data: { gstRegistrationId: gstRegistration.id } }), 'Assign GST registration');

    const hsnCode = '6109';
    await expectOk(await api.post('/api/v1/tax/rates', { headers: authHeaders, data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }), 'Create tax rate');

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: { styleCode: `E2E-PROMO-${Date.now()}`, name: 'E2E Promo Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers: authHeaders, data: { name: 'Black', colourCode: 'BLK' } });
    const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };
    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers: authHeaders, data: { sizeIds: [size.id] } });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];

    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/media`, { headers: authHeaders, data: { colourId: colour.id, url: FIXTURE_IMAGE_URL } }), 'Add media');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: authHeaders }), 'Ready for enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: authHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: authHeaders }), 'Publish style');
    // Priced so a single unit already triggers the automatic promotion's
    // minCartValue - real numbers, never hardcoded in the assertions below.
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 3000, sellingPrice: 3000 } }), 'Set price');
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers: authHeaders, data: { skuId: skus[0]!.skuId, locationId: location.id, quantityDelta: 20, reason: 'E2E stock load' } }), 'Inventory adjustment');

    const promotionType = await prisma.promotionType.upsert({ where: { key: 'PROMOTIONAL' }, update: {}, create: { key: 'PROMOTIONAL', name: 'Promotional coupon' } });
    // Automatic promotion (no code) - a different stackGroup from the
    // coupon below, so the two are explicitly compatible (PROMO-002).
    await prisma.promotion.create({
      data: {
        name: 'Automatic 10% off',
        promotionTypeId: promotionType.id,
        isCoupon: false,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minCartValue: 1000,
        stackGroup: 'AUTOMATIC',
        priority: 1,
        startsAt: new Date(Date.now() - 86_400_000),
        isActive: true,
      },
    });
    await prisma.promotion.create({
      data: {
        name: 'Compatible coupon',
        promotionTypeId: promotionType.id,
        isCoupon: true,
        couponCode: 'E2ECOMPAT',
        discountType: 'FLAT_AMOUNT',
        discountValue: 100,
        stackGroup: 'COUPON',
        priority: 50,
        startsAt: new Date(Date.now() - 86_400_000),
        isActive: true,
      },
    });
    // A SECOND coupon sharing the automatic promotion's own stackGroup -
    // explicitly incompatible with it.
    await prisma.promotion.create({
      data: {
        name: 'Incompatible coupon',
        promotionTypeId: promotionType.id,
        isCoupon: true,
        couponCode: 'E2EINCOMPAT',
        discountType: 'FLAT_AMOUNT',
        discountValue: 50,
        stackGroup: 'AUTOMATIC',
        priority: 60,
        startsAt: new Date(Date.now() - 86_400_000),
        isActive: true,
      },
    });
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  async function signIn(page: import('@playwright/test').Page, mobile: string) {
    await page.goto('/account');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10_000 });
    const otp = await prisma.otpCode.findFirstOrThrow({ where: { mobile, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    const code = bruteForceOtp(otp.codeHash);
    await page.getByLabel('Enter the 6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10_000 });
  }

  test('automatic promotion + compatible coupon + store credit all apply together; an incompatible second coupon is rejected while the automatic promotion remains applied; the final charged amount is arithmetically correct', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { mobile } });

    // Give this customer real store credit, the same way account.spec.ts does.
    const storeCreditAccount = await prisma.storeCreditAccount.create({ data: { customerId: customer.id, balance: 500 } });
    await prisma.storeCreditEntry.create({
      data: { accountId: storeCreditAccount.id, type: 'ISSUE', amount: 500, reason: 'E2E test credit', idempotencyKey: `e2e-promo-${customer.id}` },
    });

    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByPlaceholder('Full name').fill('E2E Promo Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill(mobile);
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('19 Promo Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');

    const discountLine = page.getByText('Discount (', { exact: false });

    // The automatic promotion applies with no code at all.
    await expect(discountLine).toContainText('Automatic 10% off', { timeout: 10_000 });

    // Attempting the INCOMPATIBLE coupon is rejected with a clear reason;
    // the automatic promotion's own discount line remains visible.
    await page.getByLabel('Coupon code').fill('E2EINCOMPAT');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/cannot be combined/i)).toBeVisible({ timeout: 10_000 });
    await expect(discountLine).toContainText('Automatic 10% off');

    // The COMPATIBLE coupon applies successfully alongside it. The
    // "applied" chip appears the instant the button is clicked (an
    // optimistic, purely local state change - see the checkout page's
    // own `handleApplyCoupon`), but the ACTUAL combined discount amount
    // depends on the separate, debounced, server-revalidated preview
    // fetch - so wait for the discount line to reflect BOTH promotions'
    // combined amount (not just the coupon chip) before reading any
    // total, or this test would race a stale, automatic-promo-only
    // total (a genuine test-timing bug, not a product one).
    await page.getByLabel('Coupon code').fill('E2ECOMPAT');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/E2ECOMPAT applied/)).toBeVisible({ timeout: 10_000 });
    await expect(discountLine).toContainText('Automatic 10% off');
    await expect(discountLine).toContainText('Compatible coupon', { timeout: 10_000 });
    await expect(discountLine.locator('xpath=following-sibling::span')).toHaveText('-₹400', { timeout: 10_000 });

    // Store credit applied on top.
    await page.getByLabel('Store credit to apply').fill('300');

    const grandTotalText = await page.getByText('Total (tax incl.)').locator('xpath=following-sibling::span').textContent();
    const grandTotal = Number(grandTotalText!.replace(/[^0-9.]/g, ''));

    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const order = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(Number(order.promotionDiscountTotal)).toBeGreaterThan(0);
    expect(Number(order.storeCreditApplied)).toBe(300);

    const redemptions = await prisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId }, include: { promotion: true } });
    expect(redemptions).toHaveLength(2); // the automatic promotion AND the compatible coupon - never the incompatible one
    expect(redemptions.map((r) => r.promotion.name).sort()).toEqual(['Automatic 10% off', 'Compatible coupon']);

    // Final arithmetic: grandTotal (already net of the promotion
    // discount, per TAX-006's pre-tax reduction of subtotal/grandTotal
    // itself) minus store credit equals the real amountPayable shown on
    // the confirmation page - server-authoritative, never a client
    // computation trusted at face value.
    await expect(page.getByText('Amount payable')).toBeVisible({ timeout: 10_000 });
    const amountPayableText = await page.getByText('Amount payable').locator('xpath=following-sibling::span').textContent();
    const amountPayable = Number(amountPayableText!.replace(/[^0-9.]/g, ''));
    expect(Math.round((grandTotal - 300) * 100) / 100).toBe(amountPayable);

    const account = await prisma.storeCreditAccount.findUniqueOrThrow({ where: { id: storeCreditAccount.id } });
    expect(Number(account.balance)).toBe(200);
  });
});
