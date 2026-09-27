import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;
const SERVICEABLE_PINCODE = '110017';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/** Same brute-force OTP recovery idiom as account.spec.ts - no plaintext-OTP backdoor exists in this codebase. */
function bruteForceOtp(codeHash: string, length = 6): string {
  const max = 10 ** length;
  for (let i = 0; i < max; i++) {
    const candidate = String(i).padStart(length, '0');
    if (createHash('sha256').update(candidate).digest('hex') === codeHash) return candidate;
  }
  throw new Error('Could not recover the OTP code from its hash - OTP_LENGTH may have changed');
}

/**
 * Loyalty browser E2E (M23, specs/22-loyalty.md, acceptance/m23-loyalty.md;
 * acceptance/e2e-commerce-flows.md FLOW 17 "Loyalty earn / redeem /
 * reverse / expire"). Drives the REAL mobile-OTP sign-in, a genuine
 * high-value COD purchase (EARN), a second real checkout that redeems
 * points through the checkout page's own redemption input (REDEEM,
 * server-authoritative), then a real self-service cancellation of that
 * second order's line (REVERSE) - each stage verified both in the
 * browser and against the real ledger via Prisma. The EXPIRE sweep is
 * exercised directly against the real database + the real staff-gated
 * sweep route (never simulated) since waiting out a real ~1-year
 * expiry window is not meaningful for a browser test - its concurrency
 * properties are already proven adversarially in
 * test/integration/loyalty.test.ts (tests #15/#16).
 */
test.describe('Loyalty (M23)', () => {
  let styleId: string;
  let skuId: string;
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
      where: { slug: 'e2e-loyalty-category' },
      update: {},
      create: { name: 'E2E Loyalty Category', slug: 'e2e-loyalty-category' },
    });
    const size = await prisma.size.upsert({ where: { label: 'E2E-LOY-M' }, update: {}, create: { label: 'E2E-LOY-M', sortOrder: 0 } });

    const legalEntityRes = await api.post('/api/v1/tax/legal-entities', {
      headers: authHeaders,
      data: { legalName: 'E2E Loyalty Pvt Ltd', registeredState: 'Delhi' },
    });
    const legalEntity = (await expectOk(legalEntityRes, 'Create legal entity')) as { id: string };
    const gstRes = await api.post('/api/v1/tax/gst-registrations', {
      headers: authHeaders,
      data: { legalEntityId: legalEntity.id, gstin: `DLE2ELOY${Date.now() % 100000}A1Z5`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() },
    });
    const gstRegistration = (await expectOk(gstRes, 'Create GST registration')) as { id: string };

    const brandRes = await api.post('/api/v1/organization/brands', { headers: authHeaders, data: { code: `E2ELOY${Date.now() % 100000}`, name: 'E2E Loyalty Brand' } });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };
    const locationRes = await api.post('/api/v1/organization/locations', { headers: authHeaders, data: { code: `E2ELOYLOC${Date.now() % 100000}`, name: 'E2E Loyalty Location', type: 'WAREHOUSE' } });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };
    await expectOk(await api.post(`/api/v1/tax/locations/${location.id}/gst-registration`, { headers: authHeaders, data: { gstRegistrationId: gstRegistration.id } }), 'Assign GST registration');

    const hsnCode = '6109';
    await expectOk(await api.post('/api/v1/tax/rates', { headers: authHeaders, data: { hsnCode, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }), 'Create tax rate');

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: { styleCode: `E2E-LOY-${Date.now()}`, name: 'E2E Loyalty Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers: authHeaders, data: { name: 'Black', colourCode: 'BLK' } });
    const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };
    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers: authHeaders, data: { sizeIds: [size.id] } });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    skuId = skus[0]!.skuId;

    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/media`, { headers: authHeaders, data: { colourId: colour.id, url: FIXTURE_IMAGE_URL } }), 'Add media');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: authHeaders }), 'Ready for enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: authHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: authHeaders }), 'Publish style');
    // Priced well above the 100-point minimum redemption at the default
    // 1-point-per-100-INR earn rate (floor(12000/100) = 120 points per
    // unit purchased) - a genuine, deliberately test-environment-only
    // relaxation of COD_MAX_ORDER_VALUE_INR (see .env, gitignored, never
    // committed) makes a single-unit COD purchase at this price possible.
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 12000, sellingPrice: 12000 } }), 'Set price');
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers: authHeaders, data: { skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' } }), 'Inventory adjustment');
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

  async function buyOneUnitViaCod(page: import('@playwright/test').Page, contactMobile: string) {
    await page.goto(`/product/${styleId}`);
    await page.locator('fieldset', { hasText: 'Size' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Add to Bag' }).first().click();
    await expect(page.getByText('Added to bag.').first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/bag');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByPlaceholder('Full name').fill('E2E Loyalty Buyer');
    await page.getByPlaceholder('10-digit mobile number').fill(contactMobile);
    await page.getByPlaceholder('House / Flat, Building, Street').first().fill('17 Loyalty Lane');
    await page.getByPlaceholder('City').first().fill('New Delhi');
    await page.getByPlaceholder('PIN code').first().fill(SERVICEABLE_PINCODE);
    await page.locator('select').first().selectOption('Delhi');
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    return { placeOrder: () => page.getByLabel('Cash on Delivery').check().then(() => page.getByRole('button', { name: 'Place Order' }).click()) };
  }

  test('earn on COD purchase, redeem at a real checkout, reverse on self-service cancellation - each stage verified in the browser and the real ledger', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { mobile } });

    // --- EARN: a real COD purchase earns real points ---
    const flow1 = await buyOneUnitViaCod(page, mobile);
    await flow1.placeOrder();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    const order1 = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' } });
    expect(order1.loyaltyPointsEarned).toBeGreaterThanOrEqual(100);

    await page.goto('/account/loyalty');
    await expect(page.getByText(`${order1.loyaltyPointsEarned} pts`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Earned', { exact: false }).first()).toBeVisible();

    const balanceAfterEarn = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id } });
    expect(balanceAfterEarn.balance).toBe(order1.loyaltyPointsEarned);

    // --- REDEEM: a second real checkout, applying points through the real UI ---
    const flow2 = await buyOneUnitViaCod(page, mobile);
    await expect(page.getByText(`You have ${balanceAfterEarn.balance} points available to redeem.`)).toBeVisible({ timeout: 10_000 });
    const redeemPoints = 100;
    await page.getByLabel('Points to redeem').fill(String(redeemPoints));
    await flow2.placeOrder();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await expect(page.getByText(`Loyalty points redeemed (${redeemPoints} pts)`)).toBeVisible({ timeout: 10_000 });

    const order2 = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
    expect(order2.id).not.toBe(order1.id);
    expect(order2.loyaltyPointsRedeemed).toBe(redeemPoints);
    const redeemEntry = await prisma.loyaltyLedgerEntry.findFirst({ where: { accountId: balanceAfterEarn.id, type: 'REDEEM' } });
    expect(redeemEntry).toBeTruthy();

    // Server-authoritative net balance: spent minus whatever order2 itself
    // just earned on its own subtotal (EARN runs for every confirmed
    // order, redemption or not) - never a bare `before - redeemed`.
    const expectedBalanceAfterRedeem = balanceAfterEarn.balance - redeemPoints + order2.loyaltyPointsEarned;
    await page.goto('/account/loyalty');
    await expect(page.getByText(`${expectedBalanceAfterRedeem} pts`)).toBeVisible({ timeout: 10_000 });
    const accountAfterRedeem = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id } });
    expect(accountAfterRedeem.balance).toBe(expectedBalanceAfterRedeem);

    // --- REVERSE: a real self-service cancellation reverses order2's own earned points ---
    await page.goto(`/orders/${order2.id}`);
    await page.getByRole('button', { name: 'Cancel this item' }).click();
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText(/^Cancelled/).first()).toBeVisible({ timeout: 10_000 });

    const reverseEntry = await prisma.loyaltyLedgerEntry.findFirst({ where: { accountId: balanceAfterEarn.id, type: 'REVERSE' } });
    expect(reverseEntry).toBeTruthy();
    expect(reverseEntry!.pointsDelta).toBe(-order2.loyaltyPointsEarned);

    const expectedBalanceAfterReverse = expectedBalanceAfterRedeem - order2.loyaltyPointsEarned;
    await page.goto('/account/loyalty');
    await expect(page.getByText(`${expectedBalanceAfterReverse} pts`)).toBeVisible({ timeout: 10_000 });
  });

  test('EXPIRE sweep: a real staff-gated sweep call expires a past-window earn batch, reflected in the customer-facing balance', async ({ page }) => {
    const mobile = `8${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { mobile } });

    const flow = await buyOneUnitViaCod(page, mobile);
    await flow.placeOrder();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({ timeout: 10_000 });

    const order = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id } });
    const earnEntry = await prisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderId: order.id } });
    await prisma.loyaltyLedgerEntry.update({ where: { id: earnEntry.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const loginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    const sweepRes = await expectOk(
      await api.post('/api/v1/loyalty/sweep/expire', { headers: { authorization: `Bearer ${token}` } }),
      'Loyalty expire sweep',
    );
    expect((sweepRes as { expired: number }).expired).toBeGreaterThanOrEqual(1);

    await page.goto('/account/loyalty');
    await expect(page.getByText('0 pts')).toBeVisible({ timeout: 10_000 });
    const expireEntry = await prisma.loyaltyLedgerEntry.findFirst({ where: { accountId: earnEntry.accountId, type: 'EXPIRE' } });
    expect(expireEntry).toBeTruthy();
  });
});
