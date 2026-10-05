import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { API_URL, RUN, confirmDialog, expectOk, prisma } from './p1-fixtures';

/**
 * AO-D4 approval policy (docs/admin/APPROVALS.md) in the browser: the owner
 * turns on owner approval, approves their own purchase order with a reason
 * and their password, and the approval log shows it as a self-approval.
 * Owner approval is switched back off afterwards so other specs see the
 * default (independent approval only).
 */
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

async function loginAsOwner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe.serial('Approvals (AO-D4)', () => {
  let token: string;
  let ownerId: string;

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    token = (await expectOk<{ token: string }>(await api.post('/api/v1/auth/staff/login', { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } }), 'Owner login')).token;
    ownerId = (await prisma.staffUser.findUniqueOrThrow({ where: { email: OWNER_EMAIL } })).id;
    await api.dispose();
  });

  test.afterAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    await api.put('/api/v1/approvals/policy', {
      headers: { authorization: `Bearer ${token}` },
      data: { ownerApprovalEnabled: false, ownerStaffIds: [], confirmation: { password: OWNER_PASSWORD } },
    });
    await api.dispose();
  });

  test('AO-09 owner approval: turned on in Settings, used on an own purchase order, listed in the log', async ({ page }) => {
    // A submitted PO raised by the owner.
    const brand = await prisma.brand.create({ data: { code: `APB${RUN}`, name: `Approval Brand ${RUN}` } });
    const category = await prisma.category.upsert({ where: { slug: 'e2e-approvals' }, update: {}, create: { name: 'E2E Approvals', slug: 'e2e-approvals' } });
    const size = await prisma.size.upsert({ where: { label: 'AP-M' }, update: {}, create: { label: 'AP-M', sortOrder: 200 } });
    const style = await prisma.style.create({ data: { styleCode: `APS${RUN}`, name: 'Approval Tee', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' } });
    const colour = await prisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await prisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: `APS${RUN}-BLK-M` } });
    const supplier = await prisma.supplier.create({ data: { code: `APSUP${RUN}`, name: `Approval Supplier ${RUN}`, type: 'FINISHED_GOODS' } });
    const location = await prisma.location.create({ data: { code: `APL${RUN}`, name: `Approval Warehouse ${RUN}`, type: 'WAREHOUSE' } });
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    const headers = { authorization: `Bearer ${token}` };
    const po = await expectOk<{ id: string; poNumber: string }>(
      await api.post('/api/v1/procurement/purchase-orders', { headers, data: { supplierId: supplier.id, locationId: location.id, lines: [{ skuId: sku.id, orderedQty: 5, unitCost: 200 }] } }),
      'Create PO',
    );
    await expectOk(await api.post(`/api/v1/procurement/purchase-orders/${po.id}/submit`, { headers }), 'Submit PO');
    await api.dispose();

    await loginAsOwner(page);

    // With owner approval off, the dialog explains that someone else must approve.
    await page.goto(`/dashboard/purchase-orders/${po.id}`);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(/You are approving your own purchase order\. That needs someone else/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Turn owner approval on for the owner.
    await page.getByRole('link', { name: 'Approvals' }).click();
    await page.getByLabel('Turn on owner approval').check();
    const me = (await prisma.staffUser.findUniqueOrThrow({ where: { id: ownerId } })).fullName;
    await page.getByRole('group', { name: 'Owners' }).getByLabel(me, { exact: true }).check();
    await page.getByLabel('Your password, to confirm').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Save approval rule' }).click();
    await expect(page.getByText('Approval rule saved.')).toBeVisible();
    await expect(page.getByText(/Owner approval is on/)).toBeVisible();

    // Approve the own PO with a reason and the password.
    await page.goto(`/dashboard/purchase-orders/${po.id}`);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('group', { name: /Owner approval: you are approving your own purchase order/ })).toBeVisible();
    await dialog.getByLabel('Reason').fill('Sole owner; no second approver yet');
    await dialog.getByLabel('Your password').fill(OWNER_PASSWORD);
    await confirmDialog(page, 'Approve');
    await expect(page.getByText('Approve: done.')).toBeVisible();
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('APPROVED');

    // The log lists it as a self-approval with the reason.
    await page.goto('/dashboard/approvals');
    await page.getByLabel('Self-approvals only').check();
    const row = page.getByRole('row').filter({ hasText: 'Sole owner; no second approver yet' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Purchase order')).toBeVisible();
    const record = await prisma.approvalRecord.findFirstOrThrow({ where: { entityId: po.id } });
    expect(record).toMatchObject({ selfApproved: true, requestedByStaffId: ownerId, approvedByStaffId: ownerId });
  });
});
