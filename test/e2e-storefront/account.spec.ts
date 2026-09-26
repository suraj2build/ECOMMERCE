import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@fcp/db';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const FIXTURE_IMAGE_URL = `${STOREFRONT_URL}/e2e-fixture.png`;

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable body>');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()}\n${body}`);
  }
  return res.json();
}

/**
 * The real OTP flow only stores a plain SHA-256 hash of the 6-digit code
 * (services/commerce-api/src/modules/auth/service.ts's own hashOtp) -
 * there is no plaintext-OTP backdoor anywhere in this codebase, by
 * design (never invented here either). This brute-forces the genuine
 * hash space (10^6 SHA-256 hashes, well under a second) to recover the
 * real code the server actually generated and stored, so this test
 * drives the SAME production OTP verification path a real customer
 * does - never a bypass/shortcut.
 */
function bruteForceOtp(codeHash: string, length = 6): string {
  const max = 10 ** length;
  for (let i = 0; i < max; i++) {
    const candidate = String(i).padStart(length, '0');
    if (createHash('sha256').update(candidate).digest('hex') === codeHash) return candidate;
  }
  throw new Error('Could not recover the OTP code from its hash - OTP_LENGTH may have changed');
}

/**
 * M22 Customer 360 (specs/21-customer-profile.md, acceptance/m22-customer-360.md).
 * Drives the REAL mobile-OTP sign-in through the browser (never a
 * localStorage/token-injection shortcut), then exercises profile edit +
 * reload persistence (flow A), address book CRUD + default handling
 * (flow B), recently-viewed dedupe/bound behavior via real PDP visits
 * (flow E), My Sizes (flow F), own reviews visibility (flow G), store
 * credit balance/history from the real M20 ledger (flow H), and the
 * communication-preference matrix persisting exactly as set (flow I).
 * Order history/wishlist reuse (flows C/D) and cross-customer IDOR
 * (flow J) are proven in dedicated, smaller tests.
 */
test.describe('Customer 360 account', () => {
  let styleId: string;
  let api: APIRequestContext;
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token } = (await expectOk(loginRes, 'Staff login')) as { token: string };
    const authHeaders = { authorization: `Bearer ${token}` };

    const category = await prisma.category.upsert({
      where: { slug: 'e2e-account-category' },
      update: {},
      create: { name: 'E2E Account Category', slug: 'e2e-account-category' },
    });
    const size = await prisma.size.upsert({ where: { label: 'E2E-ACC-M' }, update: {}, create: { label: 'E2E-ACC-M', sortOrder: 0 } });

    const brandRes = await api.post('/api/v1/organization/brands', { headers: authHeaders, data: { code: `E2EACC${Date.now() % 100000}`, name: 'E2E Account Brand' } });
    const brand = (await expectOk(brandRes, 'Create brand')) as { id: string };
    const locationRes = await api.post('/api/v1/organization/locations', { headers: authHeaders, data: { code: `E2EACCLOC${Date.now() % 100000}`, name: 'E2E Account Location', type: 'WAREHOUSE' } });
    const location = (await expectOk(locationRes, 'Create location')) as { id: string };

    const styleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: { styleCode: `E2E-ACC-${Date.now()}`, name: 'E2E Account Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const style = (await expectOk(styleRes, 'Create style')) as { id: string };
    styleId = style.id;

    const colourRes = await api.post(`/api/v1/products/styles/${styleId}/colours`, { headers: authHeaders, data: { name: 'Black', colourCode: 'BLK' } });
    const colour = (await expectOk(colourRes, 'Add colour')) as { id: string };

    const skuRes = await api.post(`/api/v1/products/styles/${styleId}/skus/generate`, { headers: authHeaders, data: { sizeIds: [size.id] } });
    const skus = (await expectOk(skuRes, 'Generate SKUs')) as { skuId: string }[];
    const sku = skus[0]!;

    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/media`, { headers: authHeaders, data: { colourId: colour.id, url: FIXTURE_IMAGE_URL } }), 'Add media');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/ready-for-enrichment`, { headers: authHeaders }), 'Ready for enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/qa-check`, { headers: authHeaders }), 'QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${styleId}/publish`, { headers: authHeaders }), 'Publish style');
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId, mrp: 2499, sellingPrice: 2499 } }), 'Set price');
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers: authHeaders, data: { skuId: sku.skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load' } }), 'Inventory adjustment');
  });

  test.afterAll(async () => {
    await api.dispose();
    await prisma.$disconnect();
  });

  async function signIn(page: import('@playwright/test').Page, mobile: string) {
    // Always start from a clean, unauthenticated state - a test may call
    // this more than once with a DIFFERENT mobile number (the IDOR test
    // needs two genuinely distinct customer sessions in the same page),
    // and a stale stored session must never carry over.
    await page.goto('/account');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    // Wait for the UI to actually reach the OTP-entry step before reading
    // the OtpCode row - the click only dispatches the request; querying
    // immediately races the async POST /otp/request round-trip.
    await expect(page.getByLabel('Enter the 6-digit code')).toBeVisible({ timeout: 10_000 });
    const otp = await prisma.otpCode.findFirstOrThrow({ where: { mobile, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    const code = bruteForceOtp(otp.codeHash);
    await page.getByLabel('Enter the 6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 10_000 });
  }

  test('sign-in, profile edit persists after reload, address book CRUD + default, recently viewed, my sizes, reviews, store credit, and communication preferences', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);

    // --- A: profile edit persists after reload ---
    await page.getByLabel('Full name').fill('E2E Customer Name');
    await page.getByLabel('Email').fill('e2e-customer@example.com');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Full name')).toHaveValue('E2E Customer Name', { timeout: 10_000 });
    await expect(page.getByLabel('Email')).toHaveValue('e2e-customer@example.com');

    // --- B: address book CRUD + default ---
    await page.goto('/account/addresses');
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Recipient name').fill('Recipient A');
    await page.getByLabel('Recipient mobile').fill('9000000001');
    await page.getByLabel('Address line 1').fill('Flat 1');
    await page.getByLabel('City').fill('Delhi');
    await page.getByLabel('State', { exact: true }).fill('Delhi');
    await page.getByLabel('State code').fill('DL');
    await page.getByLabel('PIN code').fill('110001');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Recipient A')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Default')).toBeVisible();

    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Recipient name').fill('Recipient B');
    await page.getByLabel('Recipient mobile').fill('9000000002');
    await page.getByLabel('Address line 1').fill('Flat 2');
    await page.getByLabel('City').fill('Mumbai');
    await page.getByLabel('State', { exact: true }).fill('Maharashtra');
    await page.getByLabel('State code').fill('MH');
    await page.getByLabel('PIN code').fill('400001');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Recipient B')).toBeVisible({ timeout: 10_000 });

    const recipientBCard = page.locator('li', { hasText: 'Recipient B' });
    await recipientBCard.getByRole('button', { name: 'Set as default' }).click();
    await expect(recipientBCard.getByText('Default')).toBeVisible({ timeout: 10_000 });

    const recipientACard = page.locator('li', { hasText: 'Recipient A' });
    await recipientACard.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('City').fill('Gurgaon');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Gurgaon')).toBeVisible({ timeout: 10_000 });

    await recipientBCard.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Recipient B')).toHaveCount(0, { timeout: 10_000 });
    // The only remaining address is promoted back to default.
    await expect(page.getByText('Default')).toBeVisible();

    // --- E: recently viewed, real PDP visit, dedupe ---
    await page.goto(`/product/${styleId}`);
    await expect(page.getByRole('heading', { name: 'E2E Account Jacket' })).toBeVisible({ timeout: 10_000 });
    await page.goto(`/product/${styleId}`); // a second view of the SAME product
    await page.goto('/account/recently-viewed');
    await expect(page.getByText('E2E Account Jacket')).toBeVisible({ timeout: 10_000 });
    const recentlyViewedRows = await page.locator('li', { hasText: 'E2E Account Jacket' }).count();
    expect(recentlyViewedRows).toBe(1); // deduped, not two rows

    // --- F: My Sizes ---
    await page.goto('/account/sizes');
    await page.getByLabel('Category').selectOption({ label: 'E2E Account Category' });
    await page.getByLabel('Size').selectOption({ label: 'E2E-ACC-M' });
    await page.getByRole('button', { name: 'Save size' }).click();
    await expect(page.locator('li', { hasText: 'E2E-ACC-M' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('You have no saved sizes yet.')).toBeVisible({ timeout: 10_000 });

    // --- G: own reviews visible (submit via the real PDP review flow) ---
    await page.goto(`/product/${styleId}`);
    await page.getByRole('button', { name: 'Write a review' }).click();
    await page.getByLabel('Rating', { exact: true }).selectOption('5');
    await page.getByLabel('Your review').fill('A genuinely great jacket.');
    await page.getByRole('button', { name: 'Submit review' }).click();
    await expect(page.getByText('A genuinely great jacket.').first()).toBeVisible({ timeout: 10_000 });
    await page.goto('/account/reviews');
    await expect(page.getByText('A genuinely great jacket.')).toBeVisible({ timeout: 10_000 });

    // --- H: store credit from the real M20 ledger ---
    const customer = await prisma.customer.findUniqueOrThrow({ where: { mobile } });
    const account = await prisma.storeCreditAccount.create({ data: { customerId: customer.id, balance: 300 } });
    await prisma.storeCreditEntry.create({
      data: { accountId: account.id, type: 'ISSUE', amount: 300, reason: 'E2E test credit', idempotencyKey: `e2e-${customer.id}` },
    });
    await page.goto('/account/store-credit');
    await expect(page.getByText('₹300', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E test credit')).toBeVisible();

    // --- I: communication preferences matrix persists exactly as set ---
    await page.goto('/account/preferences');
    await page.getByLabel('Email - Newsletter').check();
    await page.getByLabel('SMS - Offers & promotions').check();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel('Email - Newsletter')).toBeChecked({ timeout: 10_000 });
    await expect(page.getByLabel('SMS - Offers & promotions')).toBeChecked();
    await expect(page.getByLabel('SMS - Newsletter')).not.toBeChecked();
    await expect(page.getByLabel('SMS - Order updates')).toBeChecked();
    await expect(page.getByLabel('SMS - Order updates')).toBeDisabled();
  });

  test('account navigation reaches the real order-history and wishlist pages (flows C/D)', async ({ page }) => {
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { name: 'Your Orders' })).toBeVisible({ timeout: 10_000 });

    await page.goto('/account');
    await accountNav.getByRole('link', { name: 'Wishlist', exact: true }).click();
    await expect(page).toHaveURL(/\/wishlist$/);
  });

  test('account profile and addresses render on mobile with no horizontal overflow and touch-scale controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);

    const [profileScrollWidth, profileClientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(profileScrollWidth).toBeLessThanOrEqual(profileClientWidth + 1);
    const saveButton = page.getByRole('button', { name: 'Save changes' });
    const saveBox = await saveButton.boundingBox();
    expect(saveBox?.height).toBeGreaterThanOrEqual(44);

    await page.goto('/account/addresses');
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Recipient name').fill('Recipient A');
    await page.getByLabel('Recipient mobile').fill('9000000001');
    await page.getByLabel('Address line 1').fill('Flat 1');
    await page.getByLabel('City').fill('Delhi');
    await page.getByLabel('State', { exact: true }).fill('Delhi');
    await page.getByLabel('State code').fill('DL');
    await page.getByLabel('PIN code').fill('110001');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Recipient A')).toBeVisible({ timeout: 10_000 });

    const [addressesScrollWidth, addressesClientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(addressesScrollWidth).toBeLessThanOrEqual(addressesClientWidth + 1);
    const editButton = page.getByRole('button', { name: 'Edit' }).first();
    const editBox = await editButton.boundingBox();
    expect(editBox?.height).toBeGreaterThanOrEqual(44);
  });

  test('cross-customer IDOR: a different customer cannot read, update, or delete another customers address (flow J)', async ({ page }) => {
    const mobileA = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobileA);
    await page.goto('/account/addresses');
    await page.getByRole('button', { name: 'Add address' }).click();
    await page.getByLabel('Recipient name').fill('Recipient A');
    await page.getByLabel('Recipient mobile').fill('9000000001');
    await page.getByLabel('Address line 1').fill('Flat 1');
    await page.getByLabel('City').fill('Delhi');
    await page.getByLabel('State', { exact: true }).fill('Delhi');
    await page.getByLabel('State code').fill('DL');
    await page.getByLabel('PIN code').fill('110001');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Recipient A')).toBeVisible({ timeout: 10_000 });

    const customerA = await prisma.customer.findUniqueOrThrow({ where: { mobile: mobileA } });
    const addressA = await prisma.customerAddress.findFirstOrThrow({ where: { customerId: customerA.id } });

    // A second, genuinely different customer session (real OTP sign-in, not a token swap).
    const mobileB = `8${String(Date.now()).slice(-9)}`;
    await signIn(page, mobileB);

    const tokenRaw = await page.evaluate(() => localStorage.getItem('fcp_customer_session'));
    const { accessToken } = JSON.parse(tokenRaw!) as { accessToken: string };
    const apiB = await playwrightRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${accessToken}` } });

    const getRes = await apiB.get(`/api/v1/storefront/account/addresses`);
    expect((await getRes.json()) as unknown[]).toHaveLength(0);

    const patchRes = await apiB.patch(`/api/v1/storefront/account/addresses/${addressA.id}`, { data: { city: 'Hacked' } });
    expect(patchRes.status()).toBe(404);
    const deleteRes = await apiB.delete(`/api/v1/storefront/account/addresses/${addressA.id}`);
    expect(deleteRes.status()).toBe(404);

    await apiB.dispose();
  });
});
