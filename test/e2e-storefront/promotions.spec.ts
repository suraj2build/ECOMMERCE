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
 * Promotions browser E2E (M24/M25 independent-review certification-
 * repair, Blocker 2; specs/23-promotions.md, PROMO-001/002/LOY-005;
 * acceptance/e2e-commerce-flows.md FLOW 18 "Coupon + Compatible
 * Promotion + Loyalty + Store Credit"). Drives a real mobile-OTP
 * sign-in, a genuine COD purchase that EARNS real loyalty points
 * (never a fabricated balance), then a second real checkout where an
 * automatic promotion applies with no code, an incompatible coupon is
 * rejected in the browser while the automatic promotion's discount
 * line remains visible, a compatible coupon then stacks with it, real
 * loyalty points AND real store credit both apply on top through the
 * checkout page's own redemption inputs (server-revalidated, never a
 * client-computed discount), and a real COD order is placed - verified
 * server-side via Prisma that exactly the two compatible
 * `PromotionRedemption` rows exist (never the incompatible one) and
 * that the confirmation page's `amountPayable` matches the UI's own
 * displayed arithmetic across all three reductions (promotion,
 * loyalty, store credit).
 */
test.describe('Promotions (M24) - FLOW 18', () => {
  let styleId: string;
  let loyaltySeedStyleId: string;
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
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers: authHeaders, data: { skuId: skus[0]!.skuId, locationId: location.id, quantityDelta: 20, reason: 'E2E stock load', idempotencyKey: `e2e-promotions-stock-${skus[0]!.skuId}` } }), 'Inventory adjustment');

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

    // A second, separate, high-value product used ONLY to genuinely EARN
    // real loyalty points for the test customer via one real COD
    // purchase (Blocker 2 repair) - never a fabricated balance. Priced
    // well above the 100-point minimum redemption at the default
    // 1-point-per-100-INR earn rate even after the automatic 10%
    // promotion above also applies to it: floor((12000 - 1200) / 100) =
    // 108 points, still >= LOYALTY_MIN_REDEMPTION_POINTS (100).
    const loyaltySeedStyleRes = await api.post('/api/v1/products/styles', {
      headers: authHeaders,
      data: { styleCode: `E2E-PROMO-LOY-${Date.now()}`, name: 'E2E Promo Loyalty Seed Jacket', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core', hsnCode },
    });
    const loyaltySeedStyle = (await expectOk(loyaltySeedStyleRes, 'Create loyalty-seed style')) as { id: string };
    loyaltySeedStyleId = loyaltySeedStyle.id;
    const loyaltySeedColourRes = await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/colours`, { headers: authHeaders, data: { name: 'Black', colourCode: 'BLK' } });
    const loyaltySeedColour = (await expectOk(loyaltySeedColourRes, 'Add loyalty-seed colour')) as { id: string };
    const loyaltySeedSkuRes = await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/skus/generate`, { headers: authHeaders, data: { sizeIds: [size.id] } });
    const loyaltySeedSkus = (await expectOk(loyaltySeedSkuRes, 'Generate loyalty-seed SKUs')) as { skuId: string }[];

    await expectOk(await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/media`, { headers: authHeaders, data: { colourId: loyaltySeedColour.id, url: FIXTURE_IMAGE_URL } }), 'Add loyalty-seed media');
    await expectOk(await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/ready-for-enrichment`, { headers: authHeaders }), 'Loyalty-seed ready for enrichment');
    await expectOk(await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/qa-check`, { headers: authHeaders }), 'Loyalty-seed QA check');
    await expectOk(await api.post(`/api/v1/products/styles/${loyaltySeedStyleId}/publish`, { headers: authHeaders }), 'Publish loyalty-seed style');
    await expectOk(await api.post('/api/v1/catalog/prices', { headers: authHeaders, data: { styleId: loyaltySeedStyleId, mrp: 12000, sellingPrice: 12000 } }), 'Set loyalty-seed price');
    await expectOk(await api.post('/api/v1/inventory/adjustments', { headers: authHeaders, data: { skuId: loyaltySeedSkus[0]!.skuId, locationId: location.id, quantityDelta: 10, reason: 'E2E stock load', idempotencyKey: `e2e-promotions-loyalty-stock-${loyaltySeedSkus[0]!.skuId}` } }), 'Loyalty-seed inventory adjustment');
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

  test('automatic promotion + compatible coupon + real loyalty redemption + real store credit all apply together; an incompatible second coupon is rejected while the automatic promotion remains applied; the final charged amount is arithmetically correct', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mobile = `9${String(Date.now()).slice(-9)}`;
    await signIn(page, mobile);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { mobile } });

    // Give this customer real store credit, the same way account.spec.ts does.
    const storeCreditAccount = await prisma.storeCreditAccount.create({ data: { customerId: customer.id, balance: 500 } });
    await prisma.storeCreditEntry.create({
      data: { accountId: storeCreditAccount.id, type: 'ISSUE', amount: 500, reason: 'E2E test credit', idempotencyKey: `e2e-promo-${customer.id}` },
    });

    // --- EARN: a genuine real COD purchase of a different product earns
    // real loyalty points for this same customer (Blocker 2 repair) -
    // never a fabricated balance. ---
    await page.goto(`/product/${loyaltySeedStyleId}`);
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
    await expect(page.getByText('Total (tax incl.)')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    // LOY-006: the points just earned above are calculated but PENDING
    // (not yet redeemable) until the line is delivered and its return
    // window closes - deliver it, backdate the window closed, and run
    // the real staff-gated vesting sweep, so this test still genuinely
    // proves loyalty stacking with a promotion using real AVAILABLE
    // points (never a fabricated balance and never the now-obsolete
    // "immediately available" assumption).
    const loyaltyStaffLoginRes = await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const { token: loyaltyStaffToken } = (await expectOk(loyaltyStaffLoginRes, 'Staff login (loyalty vesting)')) as { token: string };
    const loyaltyStaffHeaders = { authorization: `Bearer ${loyaltyStaffToken}` };
    const loyaltySeedOrder = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' } });
    const loyaltySeedLine = await prisma.orderLine.findFirstOrThrow({ where: { orderId: loyaltySeedOrder.id } });
    const pickTask = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: loyaltySeedLine.id } });
    await expectOk(await api.post(`/api/v1/warehouse/pick-tasks/${pickTask.id}/pick`, { headers: loyaltyStaffHeaders, data: { idempotencyKey: `e2e-promo-pick-${loyaltySeedLine.id}`, outcome: 'FULL', pickedQuantity: loyaltySeedLine.quantity } }), 'Pick loyalty-seed line');
    const seedFulfilRes = await expectOk(await api.post(`/api/v1/orders/${loyaltySeedOrder.id}/fulfilments`, { headers: loyaltyStaffHeaders, data: { lineIds: [loyaltySeedLine.id] } }), 'Create loyalty-seed fulfilment');
    const seedFulfilmentId = (seedFulfilRes as { id: string }).id;
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${seedFulfilmentId}/pack`, { headers: loyaltyStaffHeaders }), 'Pack loyalty-seed fulfilment');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${seedFulfilmentId}/ready-to-ship`, { headers: loyaltyStaffHeaders }), 'Ready-to-ship loyalty-seed fulfilment');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${seedFulfilmentId}/ship`, { headers: loyaltyStaffHeaders, data: {} }), 'Ship loyalty-seed fulfilment');
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${seedFulfilmentId}/deliver`, { headers: loyaltyStaffHeaders }), 'Deliver loyalty-seed fulfilment');
    await prisma.orderFulfilment.update({ where: { id: seedFulfilmentId }, data: { deliveredAt: new Date(Date.now() - 10 * 86_400_000) } });
    // The vesting sweep is a GLOBAL, non-customer-scoped, idempotent
    // operation by design (LOY-006 / LoyaltyService.vestEligiblePoints:
    // "whichever transaction acquires the account lock first vests it;
    // the other... safely no-ops"). FLOW 17 (loyalty.spec.ts) calls this
    // SAME shared route and, under Playwright's default cross-file
    // worker parallelism, can legitimately vest THIS test's own entry a
    // moment before this call reaches it - this call then correctly
    // returns `vested: 0` for an entry that is nonetheless now genuinely
    // VESTED. Asserting on the call's own return count therefore asserts
    // an implementation/timing detail (which invocation performed the
    // transition), not the real business invariant - assert directly on
    // the entry's persisted state instead, which is correct regardless
    // of which concurrent sweep call performed the transition.
    await expectOk(await api.post('/api/v1/loyalty/sweep/vest', { headers: loyaltyStaffHeaders }), 'Vest loyalty-seed points');
    const loyaltySeedEarnEntry = await prisma.loyaltyLedgerEntry.findUniqueOrThrow({ where: { qualifyingOrderLineId: loyaltySeedLine.id } });
    expect(loyaltySeedEarnEntry.vestingStatus).toBe('VESTED');

    const loyaltyAccount = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id } });
    expect(loyaltyAccount.balance).toBeGreaterThanOrEqual(100);
    const balanceBeforeRedeem = loyaltyAccount.balance;

    // LR-011: the order took the purchased item out of the bag, so the
    // main scenario's cart holds only the promo product below.
    await page.goto('/bag');
    await expect(page.getByRole('heading', { name: 'Your bag is empty', exact: true })).toBeVisible({ timeout: 10_000 });

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
    // the automatic promotion's own discount line remains visible. This
    // rejection depends on the same debounced, server-revalidated
    // preview fetch as the compatible-coupon case below (see the comment
    // there) - under CI's own resource contention (M29 added a third
    // concurrent Node server, apps/admin, to the same E2E step) this can
    // genuinely take longer than 10s without indicating any product
    // defect, so this assertion uses the same widened timeout.
    await page.getByLabel('Coupon code').fill('E2EINCOMPAT');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/cannot be combined/i)).toBeVisible({ timeout: 20_000 });
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
    await expect(discountLine).toContainText('Compatible coupon', { timeout: 20_000 });
    await expect(discountLine.locator('xpath=following-sibling::span')).toHaveText('-₹400', { timeout: 20_000 });

    // Real loyalty points redeemed on top - both value systems are
    // compatible with both promotions in this scenario (Blocker 2).
    const redeemPoints = 100;
    await expect(page.getByText(`You have ${balanceBeforeRedeem} points available to redeem.`)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Points to redeem').fill(String(redeemPoints));

    // Store credit applied on top.
    await page.getByLabel('Store credit to apply').fill('300');

    const grandTotalText = await page.getByText('Total (tax incl.)').locator('xpath=following-sibling::span').textContent();
    const grandTotal = Number(grandTotalText!.replace(/[^0-9.]/g, ''));

    await page.getByLabel('Cash on Delivery').check();
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await expect(page.getByText(`Loyalty points redeemed (${redeemPoints} pts)`)).toBeVisible({ timeout: 10_000 });

    const order = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
    expect(Number(order.promotionDiscountTotal)).toBeGreaterThan(0);
    expect(Number(order.storeCreditApplied)).toBe(300);
    expect(order.loyaltyPointsRedeemed).toBe(redeemPoints);

    const redemptions = await prisma.promotionRedemption.findMany({ where: { checkoutSessionId: order.checkoutSessionId }, include: { promotion: true } });
    expect(redemptions).toHaveLength(2); // the automatic promotion AND the compatible coupon - never the incompatible one
    expect(redemptions.map((r) => r.promotion.name).sort()).toEqual(['Automatic 10% off', 'Compatible coupon']);

    const loyaltyRedeemEntry = await prisma.loyaltyLedgerEntry.findFirst({ where: { accountId: loyaltyAccount.id, type: 'REDEEM' } });
    expect(loyaltyRedeemEntry).toBeTruthy();
    expect(loyaltyRedeemEntry!.pointsDelta).toBe(-redeemPoints);

    // Final arithmetic: grandTotal (already net of the promotion
    // discount, per TAX-006's pre-tax reduction of subtotal/grandTotal
    // itself) minus the loyalty redemption value minus store credit
    // equals the real amountPayable shown on the confirmation page -
    // server-authoritative, never a client computation trusted at face
    // value. LOYALTY_REDEMPTION_PAISE_PER_POINT's default (25) is a
    // documented engineering default (LOY-002), not guessed here.
    const loyaltyRedemptionValue = (redeemPoints * 25) / 100;
    await expect(page.getByText('Amount payable')).toBeVisible({ timeout: 10_000 });
    const amountPayableText = await page.getByText('Amount payable').locator('xpath=following-sibling::span').textContent();
    const amountPayable = Number(amountPayableText!.replace(/[^0-9.]/g, ''));
    expect(Math.round((grandTotal - loyaltyRedemptionValue - 300) * 100) / 100).toBe(amountPayable);

    const account = await prisma.storeCreditAccount.findUniqueOrThrow({ where: { id: storeCreditAccount.id } });
    expect(Number(account.balance)).toBe(200);

    // Server-authoritative net loyalty balance: spend-only. This very
    // order also earns its own new points on its own subtotal (EARN
    // still runs for every confirmed order, redemption or not), but
    // under LOY-006 those are freshly-created PENDING entries that never
    // touch `balance` until the line is delivered and its return window
    // closes - never added here (that would be the now-obsolete
    // immediately-available assumption).
    const loyaltyAfter = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: loyaltyAccount.id } });
    expect(loyaltyAfter.balance).toBe(balanceBeforeRedeem - redeemPoints);
    expect(order.loyaltyPointsEarned).toBeGreaterThan(0); // calculated, but genuinely PENDING
  });
});
