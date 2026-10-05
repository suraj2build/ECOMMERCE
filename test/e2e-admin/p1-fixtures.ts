import { expect, request as playwrightRequest, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { PrismaClient } from '@fcp/db';
import { hashPassword } from '@fcp/shared';

/**
 * Shared set-up for the P1 console flows (test/e2e-admin/p1-console.spec.ts).
 *
 * Only prerequisites that are not the subject of a flow are created here,
 * and always through the public API's own state machines (product
 * lifecycle, stock adjustment, guest checkout, pick/pack/ship/deliver) -
 * never by writing business tables directly. Prisma is used only for
 * reference data with no workflow (category, sizes, staff accounts, a
 * customer record) and for reading back outcomes.
 */

export const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
export const STAFF_PASSWORD = 'E2eP1ConsolePassword123!';
export const RUN = Date.now().toString(36).toUpperCase();
const PINCODE = '110048';
let stockSequence = 0;

export const prisma = new PrismaClient();

export async function expectOk<T = unknown>(res: APIResponse, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text().catch(() => '')}`);
  return (await res.json()) as T;
}

export const ROLE_EMAILS = {
  MERCHANDISING: `e2e-p1-merch@example.com`,
  BUYING: `e2e-p1-buying@example.com`,
  FINANCE: `e2e-p1-finance@example.com`,
  WAREHOUSE_MANAGER: `e2e-p1-wh-manager@example.com`,
  CUSTOMER_SERVICE: `e2e-p1-cs@example.com`,
  ANALYTICS: `e2e-p1-analytics@example.com`,
} as const;
export type ConsoleRole = keyof typeof ROLE_EMAILS;

export interface Fixture {
  api: APIRequestContext;
  auth: Record<string, string>;
  brand: { id: string; code: string; name: string };
  categoryId: string;
  sizes: Array<{ id: string; label: string }>;
  locationA: { id: string; code: string; name: string };
  locationB: { id: string; code: string; name: string };
}

export interface ProvisionedStyle {
  styleId: string;
  styleCode: string;
  name: string;
  skus: Array<{ skuId: string; skuCode: string; sizeLabel: string }>;
}

export async function ensureStaff(email: string, roleKey: string, fullName: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await hashPassword(STAFF_PASSWORD);
  const staff = await prisma.staffUser.upsert({
    where: { email },
    update: { passwordHash, isActive: true, fullName },
    create: { email, passwordHash, fullName, isActive: true },
  });
  await prisma.staffUserRole.upsert({
    where: { staffUserId_roleId: { staffUserId: staff.id, roleId: role.id } },
    update: {},
    create: { staffUserId: staff.id, roleId: role.id },
  });
}

export async function setUpFixture(): Promise<Fixture> {
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  const { token } = await expectOk<{ token: string }>(await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }), 'Admin login');
  const auth = { authorization: `Bearer ${token}` };

  for (const [role, email] of Object.entries(ROLE_EMAILS)) {
    await ensureStaff(email, role, `E2E P1 ${role.replace('_', ' ').toLowerCase()}`);
  }

  const category = await prisma.category.upsert({ where: { slug: 'e2e-p1-category' }, update: {}, create: { name: 'E2E P1 Category', slug: 'e2e-p1-category' } });
  const sizes = [];
  for (const [i, label] of ['P1-S', 'P1-M'].entries()) {
    sizes.push(await prisma.size.upsert({ where: { label }, update: {}, create: { label, sortOrder: 100 + i } }));
  }

  await expectOk(
    await api.post('/api/v1/pdp/pincodes', { headers: auth, data: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } }),
    'Serviceable pincode',
  );
  const legalEntity = await expectOk<{ id: string }>(
    await api.post('/api/v1/tax/legal-entities', { headers: auth, data: { legalName: `E2E P1 ${RUN} Pvt Ltd`, registeredState: 'Delhi' } }),
    'Legal entity',
  );
  const gst = await expectOk<{ id: string }>(
    await api.post('/api/v1/tax/gst-registrations', {
      headers: auth,
      data: {
        legalEntityId: legalEntity.id,
        gstin: `DLP1${RUN}A1Z5`,
        stateCode: 'DL',
        stateName: 'Delhi',
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      },
    }),
    'GST registration',
  );
  const brand = await expectOk<{ id: string; code: string; name: string }>(
    await api.post('/api/v1/organization/brands', { headers: auth, data: { code: `P1B${RUN}`, name: `P1 Brand ${RUN}` } }),
    'Brand',
  );
  const locationA = await expectOk<{ id: string; code: string; name: string }>(
    await api.post('/api/v1/organization/locations', {
      headers: auth,
      // A full address: courier booking needs it as the sender and return address.
      data: { code: `P1A${RUN}`, name: `P1 Warehouse A ${RUN}`, type: 'WAREHOUSE', addressLine1: '4 Dispatch Yard', city: 'New Delhi', state: 'Delhi', pinCode: '110020' },
    }),
    'Location A',
  );
  const locationB = await expectOk<{ id: string; code: string; name: string }>(
    await api.post('/api/v1/organization/locations', { headers: auth, data: { code: `P1B${RUN}`, name: `P1 Store B ${RUN}`, type: 'STORE' } }),
    'Location B',
  );
  await expectOk(
    await api.post(`/api/v1/tax/locations/${locationA.id}/gst-registration`, { headers: auth, data: { gstRegistrationId: gst.id } }),
    'Location A GST registration',
  );
  await expectOk(
    await api.post('/api/v1/tax/rates', { headers: auth, data: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() } }),
    'Tax rate',
  );

  return { api, auth, brand, categoryId: category.id, sizes, locationA, locationB };
}

/** A published, priced style with one SKU per fixture size, built through the product/catalog lifecycle. */
export async function provisionStyle(fx: Fixture, name: string, price = 999): Promise<ProvisionedStyle> {
  const { api, auth } = fx;
  const styleCode = `P1-${name.replace(/\W+/g, '').toUpperCase().slice(0, 10)}-${RUN}`;
  const style = await expectOk<{ id: string }>(
    await api.post('/api/v1/products/styles', {
      headers: auth,
      data: { styleCode, name, brandId: fx.brand.id, categoryId: fx.categoryId, season: 'SS26', collection: 'Core', hsnCode: '6109' },
    }),
    'Style',
  );
  const colour = await expectOk<{ id: string }>(await api.post(`/api/v1/products/styles/${style.id}/colours`, { headers: auth, data: { name: 'Black', colourCode: 'BLK' } }), 'Colour');
  await expectOk(await api.post(`/api/v1/products/styles/${style.id}/skus/generate`, { headers: auth, data: { sizeIds: fx.sizes.map((s) => s.id) } }), 'SKUs');
  await expectOk(await api.post(`/api/v1/products/styles/${style.id}/media`, { headers: auth, data: { colourId: colour.id, url: `${process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000'}/e2e-fixture.png` } }), 'Media');
  for (const step of ['ready-for-enrichment', 'qa-check', 'publish']) {
    await expectOk(await api.post(`/api/v1/products/styles/${style.id}/${step}`, { headers: auth }), step);
  }
  await expectOk(await api.post('/api/v1/catalog/prices', { headers: auth, data: { styleId: style.id, mrp: price, sellingPrice: price } }), 'Price');
  // Size order, not SKU-code order: generated codes end in a hash of the size id, so
  // sorting by code would make skus[0]/skus[1] vary between databases.
  const skus = await prisma.sku.findMany({ where: { styleId: style.id }, include: { size: true }, orderBy: { size: { sortOrder: 'asc' } } });
  return { styleId: style.id, styleCode, name, skus: skus.map((s) => ({ skuId: s.id, skuCode: s.skuCode, sizeLabel: s.size.label })) };
}

/** Stock arrives through the ledger (an audited adjustment), never by writing the balance table. */
export async function stock(fx: Fixture, skuId: string, locationId: string, qty: number) {
  await expectOk(
    await fx.api.post('/api/v1/inventory/adjustments', {
      headers: fx.auth,
      data: {
        skuId,
        locationId,
        quantityDelta: qty,
        reason: 'E2E P1 stock load',
        idempotencyKey: `p1-stock-${RUN}-${++stockSequence}-${skuId}`,
      },
    }),
    'Stock load',
  );
}

/** A one-line COD order placed through the real guest cart and checkout APIs. */
export async function placeCodOrder(fx: Fixture, skuId: string, mobile: string) {
  const { guestSessionId } = await expectOk<{ guestSessionId: string }>(await fx.api.post('/api/v1/storefront/guest-session'), 'Guest session');
  const headers = { 'x-guest-session-id': guestSessionId };
  await expectOk(await fx.api.post('/api/v1/storefront/cart/items', { headers, data: { skuId, quantity: 1 } }), 'Add to cart');
  const address = { line1: '9 Console Road', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: PINCODE };
  const checkout = await expectOk<{ id: string }>(
    await fx.api.post('/api/v1/storefront/checkout', {
      headers,
      data: {
        contactName: 'E2E P1 Buyer',
        contactMobile: mobile,
        billingAddress: address,
        shippingAddress: address,
        paymentMethod: 'COD',
        idempotencyKey: `p1-${RUN}-${mobile}-${skuId}`,
      },
    }),
    'Checkout',
  );
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkout.id }, include: { lines: true } });
  return { orderId: order.id, orderNumber: order.orderNumber, lineId: order.lines[0]!.id };
}

/** Pick, pack, ship and deliver one line through the warehouse and order APIs (set-up only, for post-purchase flows). */
export async function deliverLine(fx: Fixture, orderId: string, lineId: string) {
  const { api, auth } = fx;
  const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: lineId } });
  await expectOk(
    await api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, { headers: auth, data: { idempotencyKey: `p1-pick-${lineId}`, outcome: 'FULL', pickedQuantity: task.allocatedQuantity } }),
    'Pick',
  );
  const fulfilment = await expectOk<{ id: string }>(await api.post(`/api/v1/orders/${orderId}/fulfilments`, { headers: auth, data: { lineIds: [lineId] } }), 'Fulfilment');
  for (const step of ['pack', 'ready-to-ship', 'ship', 'deliver']) {
    await expectOk(await api.post(`/api/v1/orders/fulfilments/${fulfilment.id}/${step}`, { headers: auth, data: step === 'ship' ? {} : undefined }), step);
  }
}

export async function loginAs(page: Page, role: ConsoleRole) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ROLE_EMAILS[role]);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

/** Clicks the confirm button inside the open dialog (page buttons often share the label). */
export async function confirmDialog(page: Page, label: string) {
  // The last open dialog is the confirmation (it can sit inside a drawer, which is also a dialog).
  await page.getByRole('dialog').last().getByRole('button', { name: label, exact: true }).click();
}

export async function chooseSku(page: Page, skuCode: string, label = 'SKU') {
  await page.getByRole('combobox', { name: label }).fill(skuCode);
  await page.getByRole('option', { name: new RegExp(skuCode) }).click();
}
