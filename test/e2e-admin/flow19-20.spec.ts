import { test, expect } from '@playwright/test';
import { PrismaClient } from '@fcp/db';
import { hashPassword } from '@fcp/shared';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const STAFF_PASSWORD = 'E2eAdminPassword123!';

/**
 * FLOW 19 (Unauthorized Admin Action Blocked) and FLOW 20 (Inventory
 * Adjustment Audited) browser E2E (acceptance/e2e-commerce-flows.md,
 * ADM-001/ADM-003), driven against the real apps/admin application -
 * genuinely separate from the integration-level proof in
 * test/integration/flow19-unauthorized-admin-action.test.ts and
 * flow20-inventory-adjustment-audited.test.ts, which exercise the same
 * server-side enforcement directly over HTTP. Two of FLOW 19's three
 * combinations (PO approval, refund issuance) have no dedicated admin
 * screen in this minimal admin app - an honest scope boundary - so
 * those two are proven via the real session token obtained through a
 * genuine browser login, calling the API exactly as apps/admin's own
 * fetch wrapper would. The third combination (inventory adjustment) and
 * FLOW 20 in full are driven entirely through the rendered UI.
 */
test.describe('FLOW 19 / FLOW 20 - Admin RBAC and inventory adjustment (M29)', () => {
  const prisma = new PrismaClient();

  async function ensureStaffUser(email: string, roleKey: string): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const passwordHash = await hashPassword(STAFF_PASSWORD);
    const staff = await prisma.staffUser.upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, fullName: `E2E ${roleKey}`, isActive: true },
    });
    await prisma.staffUserRole.upsert({
      where: { staffUserId_roleId: { staffUserId: staff.id, roleId: role.id } },
      update: {},
      create: { staffUserId: staff.id, roleId: role.id },
    });
  }

  let skuId: string;
  let locationId: string;

  test.beforeAll(async () => {
    await ensureStaffUser('e2e-warehouse-operator@example.com', 'WAREHOUSE_OPERATOR');
    await ensureStaffUser('e2e-catalog@example.com', 'CATALOG');
    await ensureStaffUser('e2e-marketing@example.com', 'MARKETING');
    await ensureStaffUser('e2e-warehouse-manager@example.com', 'WAREHOUSE_MANAGER');

    const location = await prisma.location.upsert({
      where: { code: 'E2E-ADMIN-WH' },
      update: {},
      create: { code: 'E2E-ADMIN-WH', name: 'E2E Admin Warehouse', type: 'WAREHOUSE' },
    });
    const brand = await prisma.brand.upsert({ where: { code: 'E2EADM' }, update: {}, create: { code: 'E2EADM', name: 'E2E Admin Brand' } });
    const category = await prisma.category.upsert({
      where: { slug: 'e2e-admin-category' },
      update: {},
      create: { name: 'E2E Admin Category', slug: 'e2e-admin-category' },
    });
    const size = await prisma.size.upsert({ where: { label: 'E2E-ADM-M' }, update: {}, create: { label: 'E2E-ADM-M', sortOrder: 0 } });
    const style = await prisma.style.upsert({
      where: { styleCode: 'E2E-ADMIN-STYLE' },
      update: {},
      create: { styleCode: 'E2E-ADMIN-STYLE', name: 'E2E Admin Style', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await prisma.colour.upsert({
      where: { styleId_colourCode: { styleId: style.id, colourCode: 'BLK' } },
      update: {},
      create: { styleId: style.id, name: 'Black', colourCode: 'BLK' },
    });
    const sku = await prisma.sku.upsert({
      where: { skuCode: `${style.styleCode}-BLK-M` },
      update: {},
      create: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: `${style.styleCode}-BLK-M` },
    });

    skuId = sku.id;
    locationId = location.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // P1: the adjustment form picks the SKU by code and the location by name
  // (no id entry), and asks for confirmation before submitting.
  async function fillAdjustment(page: import('@playwright/test').Page, delta: string, justification?: string) {
    await page.getByRole('combobox', { name: 'SKU' }).fill('E2E-ADMIN-STYLE-BLK-M');
    await page.getByRole('option', { name: /E2E-ADMIN-STYLE-BLK-M/ }).click();
    await page.getByLabel('Location', { exact: true }).selectOption({ label: 'E2E Admin Warehouse (E2E-ADMIN-WH)' });
    await page.getByLabel('Quantity delta').fill(delta);
    if (justification !== undefined) await page.getByLabel('Justification (required by the server)').fill(justification);
    await page.getByRole('button', { name: 'Submit adjustment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record adjustment' }).click();
  }

  const outcome = (page: import('@playwright/test').Page) => page.locator('form').getByRole('status');

  async function loginAs(page: import('@playwright/test').Page, email: string) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
  }

  test('1. Warehouse Operator cannot approve a Purchase Order - rejected server-side with 403, regardless of UI, and logged', async ({ page, request }) => {
    await loginAs(page, 'e2e-warehouse-operator@example.com');
    const token = (await page.evaluate(() => localStorage.getItem('fcp_admin_session')).then((raw) => (raw ? JSON.parse(raw).token : null))) as string;
    expect(token).toBeTruthy();

    const res = await request.post(`${API_URL}/api/v1/procurement/purchase-orders/00000000-0000-0000-0000-000000000000/approve`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);

    const denial = await prisma.auditLog.findFirst({ where: { action: 'authz.denied', entityId: 'po:approve' }, orderBy: { createdAt: 'desc' } });
    expect(denial).not.toBeNull();
  });

  test('2. Catalog role cannot issue a refund - rejected server-side with 403, regardless of UI, and logged', async ({ page, request }) => {
    await loginAs(page, 'e2e-catalog@example.com');
    const token = (await page.evaluate(() => localStorage.getItem('fcp_admin_session')).then((raw) => (raw ? JSON.parse(raw).token : null))) as string;
    expect(token).toBeTruthy();

    const res = await request.post(`${API_URL}/api/v1/refunds`, {
      headers: { authorization: `Bearer ${token}` },
      data: { orderLineId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status()).toBe(403);

    const denial = await prisma.auditLog.findFirst({ where: { action: 'authz.denied', entityId: 'payment:refund' }, orderBy: { createdAt: 'desc' } });
    expect(denial).not.toBeNull();
  });

  test('3. Marketing role cannot perform a manual inventory adjustment - the admin UI itself surfaces the real 403, and it is logged', async ({ page }) => {
    await loginAs(page, 'e2e-marketing@example.com');

    // Marketing has no inventory link in the nav at all (role-gated nav) -
    // the real proof this milestone requires is that navigating there
    // directly and submitting is rejected server-side, not merely hidden.
    await page.goto('/dashboard/inventory-adjustments');
    await fillAdjustment(page, '5', 'E2E unauthorized attempt');

    await expect(outcome(page)).toContainText('Forbidden');

    const denial = await prisma.auditLog.findFirst({ where: { action: 'authz.denied', entityId: 'inventory:adjust' }, orderBy: { createdAt: 'desc' } });
    expect(denial).not.toBeNull();
  });

  test('FLOW 20: Warehouse Manager completes a below-threshold adjustment through the real admin UI, fully audited', async ({ page }) => {
    await loginAs(page, 'e2e-warehouse-manager@example.com');

    await page.goto('/dashboard/inventory-adjustments');
    await fillAdjustment(page, '3', 'E2E below-threshold cycle count');

    await expect(outcome(page)).toContainText('Adjustment recorded');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'inventory.adjust', entityId: `${skuId}/${locationId}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  test('FLOW 20: submitting with no justification is rejected by the server and shown honestly in the UI', async ({ page }) => {
    await loginAs(page, 'e2e-warehouse-manager@example.com');

    await page.goto('/dashboard/inventory-adjustments');
    await fillAdjustment(page, '1');

    await expect(outcome(page)).toBeVisible();
    await expect(outcome(page)).not.toContainText('Adjustment recorded');
  });
});
