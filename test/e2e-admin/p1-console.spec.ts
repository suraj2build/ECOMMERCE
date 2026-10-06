import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import {
  RUN,
  chooseSku,
  confirmDialog,
  deliverLine,
  expectOk,
  loginAs,
  placeCodOrder,
  prisma,
  provisionStyle,
  setUpFixture,
  stock,
  type Fixture,
  type ProvisionedStyle,
} from './p1-fixtures';

/**
 * P1 Commerce Operations Console flows (acceptance/p1-commerce-operations-console.md).
 *
 * Each flow drives the action under test through the rendered console as
 * the role that does the job, and checks both what the console shows and
 * what the database recorded. Anything the flow is not about is set up
 * through the public API's own state machines (see p1-fixtures.ts).
 */

// Fixture prices stay below ₹1000: test/e2e-storefront/promotions.spec.ts leaves an
// automatic 10% promotion active for carts of ₹1000+, which would otherwise turn
// the P1-08 exchange into a customer-pays settlement.
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';

let fx: Fixture;
let tee: ProvisionedStyle;
let mobileSeq = 0;
// Millisecond digits, not RUN's: RUN is base36, and its digits repeat across runs made
// minutes apart against the same database.
const MOBILE_PREFIX = String(Date.now()).slice(-4);
const nextMobile = () => `98${MOBILE_PREFIX}${String(++mobileSeq).padStart(4, '0')}`;

test.beforeAll(async () => {
  fx = await setUpFixture();
  tee = await provisionStyle(fx, `P1 Console Tee ${RUN}`);
  for (const s of tee.skus) await stock(fx, s.skuId, fx.locationA.id, 30);
});

test.afterAll(async () => {
  await fx?.api.dispose();
  await prisma.$disconnect();
});

const PNG_FILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('P1 Commerce Operations Console', () => {
  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test('P1-01 product is created and completed through the product workspace', async ({ page }) => {
    // Admin Ops Phase 1: the workbench became a step-by-step workspace
    // (Basics -> Colours & sizes -> Photos -> Pricing -> ... -> Publish);
    // this flow covers the same outcome, now with a photo uploaded from disk.
    const code = `P1-NEW-${RUN}`;
    await loginAs(page, 'MERCHANDISING');
    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await page.getByRole('link', { name: 'New product' }).click();

    await page.getByLabel('Style code').fill(code);
    await page.getByLabel('Product name').fill('P1 Workbench Shirt');
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'E2E P1 Category' });
    await page.getByLabel('Department').selectOption('Men');
    await page.getByLabel('Brand', { exact: true }).selectOption({ label: fx.brand.name });
    await page.getByLabel('Season', { exact: true }).fill('AW26');
    await page.getByLabel('Collection', { exact: true }).fill('Console');
    await page.getByRole('button', { name: 'Save draft and continue' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();

    // The shop page is opened before publication, so the storefront caches a 404.
    const storefront = await playwrightRequest.newContext({ baseURL: STOREFRONT_URL });
    const draft = await prisma.style.findUniqueOrThrow({ where: { styleCode: code } });
    expect((await storefront.get(`/product/${draft.id}`)).status()).toBe(404);

    await page.getByLabel('New colour').fill('Navy');
    await page.getByLabel('Code', { exact: true }).fill('NVY');
    await page.getByRole('button', { name: 'Add colour' }).click();
    await expect(page.getByText('Navy added.')).toBeVisible();

    await page.getByRole('button', { name: 'Show all sizes' }).click();
    await page.getByLabel('P1-S').check();
    await page.getByLabel('P1-M').check();
    await page.getByRole('button', { name: 'Add 2 sizes (2 SKUs)' }).click();
    await expect(page.getByText('Added 2 sizes.')).toBeVisible();

    const step = (name: RegExp) => page.getByRole('navigation', { name: 'Product steps' }).getByRole('button', { name });
    await step(/Photos/).click();
    await page.getByLabel('Choose photos to upload').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG_FILE });
    await expect(page.getByText('1 of 1 uploaded.')).toBeVisible();

    await step(/Pricing/).click();
    await page.getByLabel('MRP (₹)').fill('1799');
    await page.getByLabel('Selling price (₹)').fill('1499');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByText(/Price saved\./)).toBeVisible();

    await step(/Publish/).click();
    await page.getByRole('region', { name: 'Publishing' }).getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText(/^Published\./)).toBeVisible();

    const style = await prisma.style.findUniqueOrThrow({ where: { styleCode: code }, include: { skus: true, colours: true, media: true, prices: true } });
    expect(style.lifecycleState).toBe('PUBLISHED');
    expect(style.skus).toHaveLength(2);
    expect(style.colours.map((c) => c.colourCode)).toEqual(['NVY']);
    expect(style.media).toHaveLength(1);
    expect(style.media[0]!.url).toMatch(/^\/media\/products\/[0-9a-f-]{36}\.png$/);
    expect(style.prices.map((p) => Number(p.sellingPrice))).toEqual([1499]);
    await expect(page.getByRole('heading', { name: 'P1 Workbench Shirt' })).toBeVisible();

    // Publishing and pricing in the console reach the shop at once, not after
    // the storefront's 30-second page cache expires, and the uploaded photo
    // is served through the storefront's own address.
    await expect.poll(async () => (await storefront.get(`/product/${style.id}`)).status(), { timeout: 5_000 }).toBe(200);
    const shopPage = await (await storefront.get(`/product/${style.id}`)).text();
    expect(shopPage).toContain('P1 Workbench Shirt');
    expect(shopPage).toContain('1499');
    expect(shopPage).toContain(style.media[0]!.url);
    const photo = await storefront.get(style.media[0]!.url);
    expect(photo.status()).toBe(200);
    expect(photo.headers()['content-type']).toBe('image/png');
    await storefront.dispose();
  });

  test('P1-02 supplier, purchase order, submit, approve and goods receipt with QC', async ({ page }) => {
    const supplierName = `P1 Mills ${RUN}`;
    const sku = tee.skus[0]!;
    const before = await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: fx.locationA.id } } });

    await loginAs(page, 'BUYING');
    await page.goto('/dashboard/suppliers');
    await page.getByRole('button', { name: 'New supplier' }).click();
    await page.getByLabel('Supplier code').fill(`P1S${RUN}`);
    await page.getByLabel('Supplier name').fill(supplierName);
    await page.getByRole('button', { name: 'Create supplier' }).click();
    await expect(page.getByRole('link', { name: supplierName })).toBeVisible();

    await page.goto('/dashboard/purchase-orders/new');
    await page.getByRole('combobox', { name: 'Supplier' }).fill(supplierName);
    await page.getByRole('option', { name: new RegExp(supplierName) }).click();
    await page.getByLabel('Deliver to').selectOption({ label: `${fx.locationA.name} (${fx.locationA.code})` });
    await chooseSku(page, sku.skuCode);
    await page.getByLabel('Quantity').fill('12');
    await page.getByLabel('Unit cost (INR)').fill('310');
    await page.getByRole('button', { name: 'Save draft purchase order' }).click();
    await expect(page.getByRole('heading', { name: /Purchase order PO-/ })).toBeVisible();
    const poId = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await confirmDialog(page, 'Submit for approval');
    await expect(page.getByText('Submitted for approval. Once it is approved, receive the goods on this page.')).toBeVisible();

    // Segregation of duties: a different person (Finance) approves.
    await loginAs(page, 'FINANCE');
    await page.goto(`/dashboard/purchase-orders/${poId}`);
    await expect(page.getByRole('cell', { name: sku.skuCode })).toBeVisible(); // SKU codes without product:read
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Comment (optional)').fill('Within budget');
    await confirmDialog(page, 'Approve');
    await expect(page.getByText('Approved. Receive the goods below as they arrive.')).toBeVisible();

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.goto('/dashboard/receiving');
    const { poNumber } = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    await page.getByRole('link', { name: poNumber }).first().click();
    await page.getByLabel(`Received for ${sku.skuCode}`).fill('12');
    await page.getByLabel(`Accepted for ${sku.skuCode}`).fill('10');
    await page.getByLabel(`Damaged for ${sku.skuCode}`).fill('2');
    await page.getByLabel(`QC notes for ${sku.skuCode}`).fill('Two torn seams');
    await page.getByRole('button', { name: 'Record goods receipt' }).click();
    await expect(page.getByText(/Goods receipt GRN-.* recorded\./)).toBeVisible();
    await expect(page.getByText('Fully received').first()).toBeVisible();

    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { goodsReceipts: { include: { lines: true } } } });
    expect(po.status).toBe('FULLY_RECEIVED');
    expect(po.goodsReceipts[0]!.lines[0]).toMatchObject({ acceptedQty: 10, damagedQty: 2, qcResult: 'PARTIAL' });
    const after = await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: fx.locationA.id } } });
    expect(after.onHand - before.onHand).toBe(10);
    expect(after.damaged - before.damaged).toBe(2);
  });

  test('P1-03 stock lookup, adjustment and the resulting balance', async ({ page }) => {
    const sku = tee.skus[1]!;
    const before = await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: fx.locationA.id } } });

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.getByRole('link', { name: 'Stock' }).click();
    await page.getByLabel('Search').fill(sku.skuCode);
    const row = page.getByRole('row').filter({ hasText: sku.skuCode }).filter({ hasText: fx.locationA.name });
    await expect(row.getByRole('cell', { name: String(before.onHand), exact: true }).first()).toBeVisible();
    await row.getByRole('link', { name: 'Adjust' }).click();

    await expect(page.getByText(sku.skuCode).first()).toBeVisible(); // pre-selected from the stock row
    await expect(page.getByTestId('balance-onhand')).toHaveText(String(before.onHand));
    await page.getByLabel('Quantity delta').fill('-3');
    await page.getByLabel('Justification (required by the server)').fill('P1 cycle count shortfall');
    await page.getByRole('button', { name: 'Submit adjustment' }).click();
    await confirmDialog(page, 'Record adjustment');
    await expect(page.locator('form').getByRole('status')).toContainText('Adjustment recorded');
    await expect(page.getByTestId('balance-onhand')).toHaveText(String(before.onHand - 3));

    const after = await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: fx.locationA.id } } });
    expect(after.onHand).toBe(before.onHand - 3);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'inventory.adjust', entityId: `${sku.skuId}/${fx.locationA.id}` }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newValue).toMatchObject({ quantityDelta: -3, reason: 'P1 cycle count shortfall' });
    // D-4: the ledger records the direction, and reconciliation replays it.
    const ledger = await prisma.inventoryTransaction.findFirstOrThrow({ where: { skuId: sku.skuId, locationId: fx.locationA.id, reason: 'P1 cycle count shortfall' } });
    expect(ledger).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: 3 });

    await page.goto(`/dashboard/inventory/reconcile?sku=${encodeURIComponent(sku.skuCode)}&locationId=${fx.locationA.id}`);
    await expect(page.getByTestId('reconcile-status')).toHaveText('The stored balance matches the ledger replay.');
  });

  test('P1-04 transfer out and in between locations', async ({ page }) => {
    const sku = tee.skus[0]!;
    const balance = (locationId: string) => prisma.inventoryBalance.findUnique({ where: { skuId_locationId: { skuId: sku.skuId, locationId } } });
    const beforeA = (await balance(fx.locationA.id))!;

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.getByRole('link', { name: 'Transfers' }).click();
    await chooseSku(page, sku.skuCode);
    await page.getByLabel('From location').selectOption({ label: `${fx.locationA.name} (${fx.locationA.code})` });
    await page.getByLabel('To location').selectOption({ label: `${fx.locationB.name} (${fx.locationB.code})` });
    await page.getByLabel('Quantity').fill('4');
    await page.getByRole('button', { name: 'Send transfer' }).click();
    await expect(page.getByText(`Transfer sent: 4 × ${sku.skuCode}.`)).toBeVisible();

    const transfer = await prisma.inventoryTransfer.findFirstOrThrow({ where: { skuId: sku.skuId, toLocationId: fx.locationB.id }, orderBy: { createdAt: 'desc' } });
    expect(transfer.status).toBe('IN_TRANSIT');
    expect((await balance(fx.locationA.id))!.onHand).toBe(beforeA.onHand - 4);

    await page.getByLabel('Status').selectOption({ label: 'in transit' });
    const row = page.getByRole('row').filter({ hasText: sku.skuCode }).filter({ hasText: fx.locationB.name });
    await row.getByRole('button', { name: 'Receive' }).click();
    await confirmDialog(page, 'Receive');
    await expect(page.getByText(`Received 4 × ${sku.skuCode} at ${fx.locationB.name}.`)).toBeVisible();

    expect((await prisma.inventoryTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe('COMPLETED');
    expect((await balance(fx.locationB.id))!.onHand).toBe(4);
  });

  test('P1-05 order is picked, packed and made ready to ship from the console', async ({ page }) => {
    const order = await placeCodOrder(fx, tee.skus[0]!.skuId, nextMobile());

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await pickFromQueue(page, order.orderNumber);

    await openOrder(page, order.orderNumber);
    await page.getByLabel(new RegExp(`^Select ${escape(tee.name)}`)).check();
    await page.getByRole('button', { name: 'Create fulfilment from selected' }).click();
    await confirmDialog(page, 'Create fulfilment');
    await expect(page.getByText('Fulfilment created.')).toBeVisible();

    await fulfilmentStep(page, 'Mark packed');
    await fulfilmentStep(page, 'Ready to ship');
    await expect(page.getByText('Package 1').locator('..')).toContainText('Ready to ship');

    const fulfilment = await prisma.orderFulfilment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(fulfilment.status).toBe('READY_TO_SHIP');
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: order.lineId } })).status).toBe('PACKED');
  });

  test('P1-06 shipment is booked with the test carrier and delivered', async ({ page }) => {
    const order = await placeCodOrder(fx, tee.skus[1]!.skuId, nextMobile());
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: order.lineId } });
    await expectOk(
      await fx.api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, { headers: fx.auth, data: { idempotencyKey: `p1-06-${task.id}`, outcome: 'FULL', pickedQuantity: 1 } }),
      'Pick',
    );
    const f = await expectOk<{ id: string }>(await fx.api.post(`/api/v1/orders/${order.orderId}/fulfilments`, { headers: fx.auth, data: { lineIds: [order.lineId] } }), 'Fulfilment');
    for (const step of ['pack', 'ready-to-ship']) await expectOk(await fx.api.post(`/api/v1/orders/fulfilments/${f.id}/${step}`, { headers: fx.auth }), step);

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.getByRole('link', { name: 'Pack & ship' }).click();
    await page.getByLabel('Status').selectOption({ label: 'Ready to ship' });
    await page.getByRole('row').filter({ hasText: order.orderNumber }).getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Book shipment with carrier' }).click();
    await confirmDialog(page, 'Book shipment with carrier');
    await expect(page.getByText(`${order.orderNumber}: Booked with the courier. When they collect it, confirm the handover on the Courier handover page.`)).toBeVisible();

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
    expect(shipment.provider).toBe('MOCK');
    expect(shipment.status).toBe('BOOKED');
    expect(shipment.trackingRef).toMatch(/^MOCKAWB/);

    await openOrder(page, order.orderNumber);
    await expect(page.getByText(shipment.trackingRef!).first()).toBeVisible();
    // AO-D5 option B: booked, not collected - nothing to deliver yet, and no stock has left.
    await expect(page.getByText('Booked with the courier, waiting for collection.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark delivered', exact: true })).toHaveCount(0);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: order.lineId } })).toBe(0);
    await confirmHandover(page, order.orderNumber);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: order.lineId } })).toBe(1);

    await openOrder(page, order.orderNumber);
    await fulfilmentStep(page, 'Mark delivered');
    expect((await prisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('DELIVERED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('DELIVERED');
  });

  test('P1-07 return is started, received, QC-passed and its refund is visible', async ({ page }) => {
    const order = await placeCodOrder(fx, tee.skus[0]!.skuId, nextMobile());
    await deliverLine(fx, order.orderId, order.lineId);

    await loginAs(page, 'CUSTOMER_SERVICE');
    await openOrder(page, order.orderNumber);
    await page.getByLabel(new RegExp(`^Select ${escape(tee.name)}`)).check();
    await page.getByRole('button', { name: 'Start return for selected' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Too tight on the shoulders');
    await confirmDialog(page, 'Start return');
    await expect(page.getByText('Return requested.')).toBeVisible();
    const ret = await prisma.return.findFirstOrThrow({ where: { orderId: order.orderId }, include: { lines: true } });

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.getByRole('link', { name: 'Returns' }).click();
    await page.getByRole('link', { name: ret.returnNumber }).click();
    await page.getByRole('button', { name: 'Mark received at warehouse' }).click();
    await confirmDialog(page, 'Mark received at warehouse');
    await expect(page.getByText('Mark received at warehouse: done.')).toBeVisible();
    await page.getByRole('button', { name: 'Record QC' }).click();
    await confirmDialog(page, 'Record QC');
    await expect(page.getByText('QC recorded.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Yes', exact: true })).toBeVisible(); // refund eligible

    // Finance refunds from the order (Finance has no return:read).
    await loginAs(page, 'FINANCE');
    await openOrder(page, order.orderNumber);
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await confirmDialog(page, 'Issue refund');
    await expect(page.getByText('Refund processed')).toBeVisible();
    const refundsSection = page.getByRole('region', { name: 'Refunds' });
    await expect(refundsSection).toContainText('store credit');
    await expect(refundsSection).toContainText('Completed');

    await page.getByRole('link', { name: 'Refunds' }).first().click();
    await expect(page.getByRole('row').filter({ hasText: order.orderNumber })).toContainText('Completed');

    const refund = await prisma.refund.findUniqueOrThrow({ where: { orderLineId: order.lineId } });
    expect(refund).toMatchObject({ status: 'COMPLETED', method: 'STORE_CREDIT', returnLineId: ret.lines[0]!.id });
    const line = await prisma.returnLine.findUniqueOrThrow({ where: { id: ret.lines[0]!.id } });
    expect(line).toMatchObject({ qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE', refundEligible: true });
  });

  test('P1-08 exchange ships its replacement through the normal fulfilment pipeline', async ({ page }) => {
    const [small, medium] = tee.skus;
    const order = await placeCodOrder(fx, small!.skuId, nextMobile());
    await deliverLine(fx, order.orderId, order.lineId);

    await loginAs(page, 'CUSTOMER_SERVICE');
    await openOrder(page, order.orderNumber);
    await page.getByRole('button', { name: 'Exchange', exact: true }).click();
    await chooseSku(page, medium!.skuCode, 'Replacement SKU');
    await page.getByRole('dialog').getByLabel('Reason').fill('Needs one size up');
    await confirmDialog(page, 'Request exchange');
    await expect(page.getByText('Exchange requested.')).toBeVisible();
    const exchange = await prisma.exchange.findUniqueOrThrow({ where: { orderLineId: order.lineId } });
    expect(exchange).toMatchObject({ replacementSkuId: medium!.skuId, paymentDirection: 'EVEN' });

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.goto(`/dashboard/exchanges/${exchange.id}`);
    await page.getByRole('button', { name: 'Mark received' }).click();
    await confirmDialog(page, 'Mark received');
    await expect(page.getByText('Mark received: done.')).toBeVisible();
    await page.getByRole('button', { name: 'Record QC' }).click();
    await confirmDialog(page, 'Record QC');
    await expect(page.getByText('QC recorded.')).toBeVisible();
    await expect(page.getByText('Replacement allocated').first()).toBeVisible();

    // The replacement's pick task appears in the normal pick queue.
    await page.goto(`/dashboard/warehouse/picks?locationId=${fx.locationA.id}`);
    const pickRow = page.getByRole('row').filter({ hasText: 'Exchange replacement' }).filter({ hasText: medium!.sizeLabel });
    await pickRow.first().getByRole('button', { name: 'Record pick' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record pick' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.goto(`/dashboard/exchanges/${exchange.id}`);
    await page.getByRole('button', { name: 'Create replacement package' }).click();
    await confirmDialog(page, 'Create replacement package');
    await expect(page.getByText('Create replacement package: done.')).toBeVisible();
    await fulfilmentStep(page, 'Mark packed');
    await fulfilmentStep(page, 'Ready to ship');
    await fulfilmentStep(page, 'Book shipment with carrier');
    // AO-D5 option B: the replacement leaves stock at the courier handover.
    expect(await prisma.inventoryTransaction.count({ where: { type: 'EXCHANGE_DISPATCH', referenceId: exchange.id } })).toBe(0);
    await confirmHandover(page, exchange.exchangeNumber);
    await page.goto(`/dashboard/exchanges/${exchange.id}`);
    await fulfilmentStep(page, 'Mark delivered');
    // Delivery of the replacement package completes the exchange automatically (EXC-004 Option 2).
    await expect(page.locator('.page-header .badge').first()).toHaveText('Completed');

    const done = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    expect(done.status).toBe('COMPLETED');
    const fulfilment = await prisma.orderFulfilment.findUniqueOrThrow({ where: { exchangeId: exchange.id }, include: { shipment: true, lines: true } });
    expect(fulfilment).toMatchObject({ status: 'DELIVERED', lines: [], orderId: order.orderId });
    expect(fulfilment.shipment?.provider).toBe('MOCK');
    expect(await prisma.inventoryTransaction.count({ where: { type: 'EXCHANGE_DISPATCH', referenceId: exchange.id } })).toBe(1);
    // No second order or order line was created for the replacement.
    const { contactMobile, createdAt } = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(await prisma.order.count({ where: { contactMobile, createdAt: { gte: createdAt } } })).toBe(1);
    expect(await prisma.orderLine.count({ where: { orderId: order.orderId } })).toBe(1);
  });

  test('P1-09 promotion is created, deactivated and activated', async ({ page }) => {
    const name = `P1 Autumn ${RUN}`;
    await loginAs(page, 'MERCHANDISING');
    await page.getByRole('link', { name: 'Promotions' }).click();
    await page.getByRole('link', { name: 'New promotion' }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Promotion type').selectOption({ index: 1 });
    // A coupon only applies when its code is entered, so this promotion can never
    // change the totals of orders placed by other suites running in parallel.
    await page.getByLabel('Requires a coupon code').check();
    await page.getByLabel('Coupon code', { exact: true }).fill(`P1AUT${RUN}`);
    await page.getByLabel('Percent off').fill('15');
    await page.getByLabel('Maximum discount (INR)').fill('300');
    await page.getByLabel('Starts').fill('2026-01-01T00:00');
    await page.getByLabel('Stack group').fill(`p1-${RUN}`);
    await expect(page.getByLabel('Can combine with a gift card')).toBeChecked(); // default unchanged
    await page.getByLabel('Can combine with a gift card').uncheck(); // D-2
    await page.getByRole('button', { name: 'Create promotion' }).click();

    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await confirmDialog(page, 'Deactivate');
    await expect(row).toContainText('Inactive');
    expect((await prisma.promotion.findFirstOrThrow({ where: { name } })).isActive).toBe(false);

    await row.getByRole('button', { name: 'Activate' }).click();
    await confirmDialog(page, 'Activate');
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    const promo = await prisma.promotion.findFirstOrThrow({ where: { name } });
    expect(promo).toMatchObject({ isActive: true, discountType: 'PERCENTAGE', isCoupon: true, couponCode: `P1AUT${RUN}`, stackGroup: `p1-${RUN}`, giftCardCompatible: false });
    expect(Number(promo.discountValue)).toBe(15);
  });

  test('P1-10 Customer 360 lookup leads to a loyalty correction', async ({ page }) => {
    const mobile = nextMobile();
    const customer = await prisma.customer.create({ data: { mobile, fullName: `P1 Shopper ${RUN}`, mobileVerifiedAt: new Date() } });

    await loginAs(page, 'CUSTOMER_SERVICE');
    await page.getByRole('link', { name: 'Customer 360' }).click();
    await page.getByLabel('Customer mobile number').fill(mobile);
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByRole('heading', { name: `P1 Shopper ${RUN}` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Customer summary' })).toContainText('Loyalty available');

    await page.getByRole('link', { name: 'Adjust loyalty points' }).click();
    await expect(page.getByTestId('loyalty-available')).toHaveText('0');
    await page.getByLabel('Points to add or remove').fill('50');
    await page.getByLabel('Reason').fill('Goodwill for delayed delivery');
    await page.getByRole('button', { name: 'Adjust points' }).click();
    await confirmDialog(page, 'Record adjustment');
    await expect(page.getByText('Adjustment recorded.')).toBeVisible();
    await expect(page.getByTestId('loyalty-available')).toHaveText('50');

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id }, include: { entries: true } });
    expect(account.balance).toBe(50);
    expect(account.entries.map((e) => e.type)).toEqual(['ADJUST']);
  });

  test('P1-13 Finance corrects loyalty points through the restricted lookup; a deduction below zero is refused', async ({ page }) => {
    const mobile = nextMobile();
    const customer = await prisma.customer.create({ data: { mobile, fullName: `P1 Finance Case ${RUN}`, mobileVerifiedAt: new Date() } });

    await loginAs(page, 'FINANCE');
    await expect(page.getByRole('link', { name: 'Customer 360' })).toHaveCount(0); // D-1: no Customer 360 for Finance
    await page.getByRole('link', { name: 'Loyalty tools' }).click();
    await page.getByLabel('Customer mobile number').fill(mobile);
    await page.getByRole('button', { name: 'Find customer' }).click();
    // exact: the closed confirmation dialog also holds the name inside a longer sentence.
    await expect(page.getByText(`P1 Finance Case ${RUN}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`******${mobile.slice(-4)}`)).toBeVisible();
    await expect(page.getByText(mobile, { exact: true })).toHaveCount(0); // full number never shown
    await expect(page.getByTestId('loyalty-available')).toHaveText('0');

    await page.getByLabel('Points to add or remove').fill('40');
    await page.getByLabel('Reason').fill('Goodwill credit');
    await page.getByRole('button', { name: 'Adjust points' }).click();
    await confirmDialog(page, 'Record adjustment');
    await expect(page.getByTestId('loyalty-available')).toHaveText('40');

    // D-3: removing more than the balance is refused by the server, and nothing changes.
    await page.getByLabel('Points to add or remove').fill('-41');
    await page.getByLabel('Reason').fill('Reverse goodwill');
    await page.getByRole('button', { name: 'Adjust points' }).click();
    await expect(page.getByRole('dialog').getByText('Balance after this adjustment would be -1 points')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Record adjustment' }).click();
    // The refusal shows on the page once the dialog closes; the closed dialog keeps a hidden copy.
    await expect(page.locator('text=/below zero/ >> visible=true')).toBeVisible();
    await expect(page.getByTestId('loyalty-available')).toHaveText('40');

    await page.getByLabel('Points to add or remove').fill('-40');
    await page.getByRole('button', { name: 'Adjust points' }).click();
    await confirmDialog(page, 'Record adjustment');
    await expect(page.getByTestId('loyalty-available')).toHaveText('0');

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id }, include: { entries: { orderBy: { createdAt: 'asc' } } } });
    expect(account.balance).toBe(0);
    expect(account.entries.map((e) => e.pointsDelta)).toEqual([40, -40]);
  });

  test('P1-11 gift card is issued, found by last four, adjusted and disabled', async ({ page }) => {
    await loginAs(page, 'FINANCE');
    await page.getByRole('link', { name: 'Gift cards' }).click();
    await page.getByRole('button', { name: 'Issue gift card' }).click();
    const drawer = page.getByRole('dialog', { name: 'Issue gift card' });
    await drawer.getByLabel('Value (INR)').fill('500');
    await drawer.getByRole('button', { name: 'Issue gift card' }).click();
    await expect(drawer.getByText('This is the only time the full code is shown')).toBeVisible();
    const code = (await drawer.getByTestId('issued-gift-card-code').textContent())!.trim();
    expect(code.length).toBeGreaterThanOrEqual(12);
    await drawer.getByRole('button', { name: 'Close' }).click();

    await page.getByLabel('Last four of code').fill(code.slice(-4));
    await page.getByRole('link', { name: `•••• ${code.slice(-4).toUpperCase()}` }).click();
    await expect(page.getByTestId('gift-card-balance')).toHaveText('₹500.00');
    await expect(page.getByText(code)).toHaveCount(0); // never shown again

    await page.getByRole('button', { name: 'Adjust balance' }).click();
    await page.getByRole('dialog').getByLabel('Change (INR)').fill('100');
    await page.getByRole('dialog').getByLabel('Reason').fill('Service recovery top-up');
    await confirmDialog(page, 'Record adjustment');
    await expect(page.getByTestId('gift-card-balance')).toHaveText('₹600.00');

    await page.getByRole('button', { name: 'Disable card' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Reported lost');
    await confirmDialog(page, 'Disable card');
    await expect(page.getByText('Card disabled.')).toBeVisible();

    const card = await prisma.giftCard.findFirstOrThrow({ where: { codeLast4: code.slice(-4).toUpperCase() }, orderBy: { createdAt: 'desc' }, include: { entries: true } });
    expect(card.status).toBe('DISABLED');
    expect(Number(card.balance)).toBe(600);
    expect(card.entries.map((e) => e.type).sort()).toEqual(['ADJUSTMENT', 'ISSUE']);
    expect(card.codeHash).not.toContain(code);
    expect(JSON.stringify(card)).not.toContain(code);
  });

  test('P1-12 analytics shows the analytics service\'s own figures', async ({ page }) => {
    await loginAs(page, 'ANALYTICS');
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('fcp_admin_session') ?? '{}').token as string);
    const fetchCommerce = async () =>
      expectOk<{ sales: { orderCount: number; netSales: number } }>(await fx.api.get('/api/v1/analytics/commerce', { headers: { authorization: `Bearer ${token}` } }), 'Commerce report');

    // Other suites place orders concurrently: compare against an API read taken on either side of the render and retry until they agree.
    let matched = false;
    for (let attempt = 0; attempt < 5 && !matched; attempt += 1) {
      const before = await fetchCommerce();
      await page.goto('/dashboard/analytics');
      const shownOrders = await page.getByTestId('kpi-orders').textContent({ timeout: 15_000 });
      const shownNet = await page.getByTestId('kpi-net-sales').textContent();
      const after = await fetchCommerce();
      if (before.sales.orderCount !== after.sales.orderCount || before.sales.netSales !== after.sales.netSales) continue;
      expect(shownOrders).toBe(new Intl.NumberFormat('en-IN').format(after.sales.orderCount));
      expect(shownNet).toBe(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(after.sales.netSales));
      matched = true;
    }
    expect(matched).toBe(true);
    expect(Number((await fetchCommerce()).sales.orderCount)).toBeGreaterThan(0);

    // Ids are shown as names for entities the viewer may read (ANALYTICS holds product:read).
    await expect(page.getByRole('region', { name: 'Style performance' }).getByRole('cell').filter({ hasText: / · / }).first()).toBeVisible();
    // No raw JSON dump remains.
    await expect(page.locator('pre')).toHaveCount(0);
  });

  test('AO-11 approval queue: a large adjustment waits until the named approver approves it from their own login', async ({ page }) => {
    const sku = tee.skus[0]!;
    const balance = async () => (await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku.skuId, locationId: fx.locationA.id } } })).onHand;
    const before = await balance();
    const reason = `AO-11 found a carton ${RUN}`;

    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.getByRole('link', { name: 'Stock' }).click();
    await page.getByLabel('Search').fill(sku.skuCode);
    await page.getByRole('row').filter({ hasText: sku.skuCode }).filter({ hasText: fx.locationA.name }).getByRole('link', { name: 'Adjust' }).click();
    await page.getByLabel('Quantity delta').fill('60');
    await page.getByLabel('Justification (required by the server)').fill(reason);
    await page.getByLabel('Finance co-approver (required above threshold)').selectOption({ label: 'E2E P1 finance' });
    await page.getByRole('button', { name: 'Submit adjustment' }).click();
    await confirmDialog(page, 'Record adjustment');
    await expect(page.locator('form').getByRole('status')).toContainText('Sent to E2E P1 finance for approval');
    // Nothing has moved yet.
    expect(await balance()).toBe(before);
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { kind: 'STOCK_ADJUSTMENT', status: 'PENDING', summary: { path: ['reason'], equals: reason } } });

    // The approver sees it on their own Approvals page and approves it.
    await loginAs(page, 'FINANCE');
    await page.goto('/dashboard/approvals');
    const waiting = page.getByRole('table', { name: 'Requests waiting for your approval' }).getByRole('row').filter({ hasText: reason });
    await expect(waiting).toContainText(sku.skuCode);
    await expect(waiting).toContainText('add 60');
    await waiting.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved: the stock adjustment has been carried out.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Requests waiting for your approval' }).getByRole('row').filter({ hasText: reason })).toHaveCount(0);

    expect(await balance()).toBe(before + 60);
    const approved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(approved.status).toBe('APPROVED');
    const finance = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'e2e-p1-finance@example.com' } });
    const txn = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: approved.resultEntityId! } });
    expect(txn).toMatchObject({ coApproverStaffId: finance.id, quantity: 60, type: 'ADJUSTMENT_IN' });

    // The requester sees the outcome among the requests they sent.
    await loginAs(page, 'WAREHOUSE_MANAGER');
    await page.goto('/dashboard/approvals');
    await expect(page.getByRole('table', { name: 'Requests you sent' }).getByRole('row').filter({ hasText: reason })).toContainText('Approved');
  });

  test('AO-10 dispatch: pick scan, pack scans with parcel measurements, documents, booking and courier handover', async ({ page }) => {
    // Barcodes on the tee's sizes (scanners read these).
    const sku = tee.skus[0]!;
    const barcode = `89${String(Date.now()).slice(-10)}`;
    await prisma.sku.update({ where: { id: sku.skuId }, data: { barcode } });
    const order = await placeCodOrder(fx, sku.skuId, nextMobile());
    const saleBefore = await prisma.inventoryTransaction.count({ where: { skuId: sku.skuId, type: 'SALE' } });

    await loginAs(page, 'WAREHOUSE_MANAGER');
    // Pick: a wrong scan is refused, the right one is accepted.
    await page.getByRole('link', { name: 'Pick queue' }).click();
    await page.getByLabel('Location', { exact: true }).selectOption({ label: `${fx.locationA.name} (${fx.locationA.code})` });
    await page.getByRole('row').filter({ hasText: order.orderNumber }).getByRole('button', { name: 'Record pick' }).click();
    const drawer = page.getByRole('dialog', { name: 'Record pick' });
    await drawer.getByLabel("Scan the item's barcode").fill('0000000000000');
    await drawer.getByRole('button', { name: 'Record pick' }).click();
    await expect(drawer.getByText(/does not match/)).toBeVisible();
    await drawer.getByLabel("Scan the item's barcode").fill(barcode);
    await drawer.getByRole('button', { name: 'Record pick' }).click();
    await expect(drawer).toBeHidden();
    expect((await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: order.lineId } })).scannedBarcode).toBe(barcode);

    // The picked order waits on Pack & ship for its package (walkthrough W-14).
    await page.goto('/dashboard/fulfilments');
    const waiting = page.getByRole('table', { name: 'Picked orders waiting for a package' }).getByRole('row').filter({ hasText: order.orderNumber });
    await waiting.getByRole('button', { name: 'Create package' }).click();
    await expect(page.getByText(`Package created for ${order.orderNumber}. Pack it below.`)).toBeVisible();
    await expect(waiting).toHaveCount(0);

    // Pack: scan the unit and record the parcel.
    await openOrder(page, order.orderNumber);
    await page.getByRole('button', { name: 'Mark packed', exact: true }).first().click();
    const pack = page.getByRole('dialog').last();
    const scan = pack.getByLabel(/Scan item barcode/);
    // A unit that does not belong in the parcel is named as such and can be undone.
    await scan.fill('0000000000000');
    await scan.press('Enter');
    await expect(pack.getByText(/Not in this package: 0000000000000/)).toBeVisible();
    await pack.getByRole('button', { name: 'Undo last scan' }).click();
    await expect(pack.getByText(/Not in this package/)).toHaveCount(0);
    await scan.fill(barcode);
    await scan.press('Enter');
    await expect(pack.getByRole('list', { name: 'Items in this package' })).toContainText(`${tee.name}`);
    await expect(pack.getByRole('list', { name: 'Items in this package' })).toContainText('1 of 1 scanned');
    await pack.getByLabel(/Parcel weight/).fill('420');
    await pack.getByLabel('Length (cm)').fill('30');
    await pack.getByLabel('Width (cm)').fill('22');
    await pack.getByLabel('Height (cm)').fill('4');
    await confirmDialog(page, 'Mark packed');
    await expect(page.getByRole('dialog')).toBeHidden();
    const fulfilment = await prisma.orderFulfilment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(fulfilment).toMatchObject({ status: 'PACKED', parcelWeightGrams: 420, parcelLengthCm: 30, parcelWidthCm: 22, parcelHeightCm: 4 });
    expect(fulfilment.packScanVerifiedAt).not.toBeNull();

    // Packing slip and address label.
    await page.goto(`/dashboard/fulfilments/${fulfilment.id}/documents?doc=slip`);
    const slip = page.getByRole('article', { name: 'Packing slip' });
    await expect(slip.getByText(sku.skuCode)).toBeVisible();
    await expect(slip.getByText(barcode)).toBeVisible();
    await expect(slip.getByText(/Parcel weight 420 g/)).toBeVisible();
    await page.getByRole('link', { name: 'Address label' }).click();
    await expect(page.getByRole('article', { name: 'Address label' }).getByText('9 Console Road')).toBeVisible();
    // The warehouse's own address is the return address.
    await expect(page.getByRole('article', { name: 'Address label' }).getByText('4 Dispatch Yard')).toBeVisible();
    await expect(page.getByRole('article', { name: 'Address label' }).getByText(/Cash on delivery/)).toBeVisible();

    // Book: no stock leaves at booking (AO-D5 option B); the handover posts the sale.
    await openOrder(page, order.orderNumber);
    await fulfilmentStep(page, 'Ready to ship');
    await fulfilmentStep(page, 'Book shipment with carrier');
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: fulfilment.id } });
    expect(shipment.status).toBe('BOOKED');
    expect(shipment.handedOverAt).toBeNull();
    expect((await prisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilment.id } })).status).toBe('BOOKED');
    expect(await prisma.inventoryTransaction.count({ where: { skuId: sku.skuId, type: 'SALE' } })).toBe(saleBefore);

    // Handover manifest: tick the parcel and confirm.
    await page.getByRole('link', { name: 'Courier handover' }).click();
    await page.getByLabel(`Handed over: ${order.orderNumber}`).check();
    await page.getByLabel(/manifest or pickup reference/).fill(`PICKUP-${RUN}`);
    await page.getByRole('button', { name: /Confirm handover of 1 parcel/ }).click();
    await expect(page.getByText('1 parcel recorded as handed over and marked shipped.')).toBeVisible();
    const handed = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(handed.handedOverAt).not.toBeNull();
    expect(handed.handoverReference).toBe(`PICKUP-${RUN}`);
    await expect(page.getByLabel(`Handed over: ${order.orderNumber}`)).toHaveCount(0);
    expect((await prisma.orderFulfilment.findUniqueOrThrow({ where: { id: fulfilment.id } })).status).toBe('SHIPPED');
    expect(await prisma.inventoryTransaction.count({ where: { skuId: sku.skuId, type: 'SALE' } })).toBe(saleBefore + 1);
  });

  test('AO-11 a package booked with the courier is cancelled from the screen; its items are cancelled and no stock leaves', async ({ page }) => {
    const order = await placeCodOrder(fx, tee.skus[1]!.skuId, nextMobile());
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderLineId: order.lineId } });
    await expectOk(
      await fx.api.post(`/api/v1/warehouse/pick-tasks/${task.id}/pick`, { headers: fx.auth, data: { idempotencyKey: `ao-11-${task.id}`, outcome: 'FULL', pickedQuantity: 1 } }),
      'Pick',
    );
    const f = await expectOk<{ id: string }>(await fx.api.post(`/api/v1/orders/${order.orderId}/fulfilments`, { headers: fx.auth, data: { lineIds: [order.lineId] } }), 'Fulfilment');
    for (const step of ['pack', 'ready-to-ship']) await expectOk(await fx.api.post(`/api/v1/orders/fulfilments/${f.id}/${step}`, { headers: fx.auth }), step);
    await expectOk(await fx.api.post(`/api/v1/orders/fulfilments/${f.id}/shipment`, { headers: fx.auth, data: { idempotencyKey: `ao-11-book-${f.id}` } }), 'Book');

    await loginAs(page, 'CUSTOMER_SERVICE');
    await openOrder(page, order.orderNumber);
    // The line cannot be cancelled on its own while the courier has a booking.
    await expect(page.getByText('Booked with the courier: cancel from Pack & ship')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cancel booking', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Cancel booking' });
    const confirm = dialog.getByRole('button', { name: 'Cancel booking' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Reason (required)').fill('Customer called before collection');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('I have cancelled this booking with the courier').check();
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Booking cancelled. The items are cancelled and their stock released.').first()).toBeVisible();

    expect((await prisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('CANCELLED');
    expect((await prisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } })).status).toBe('CANCELLED');
    expect((await prisma.orderLine.findUniqueOrThrow({ where: { id: order.lineId } })).status).toBe('CANCELLED');
    expect(await prisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: order.lineId } })).toBe(0);
  });
});

// ---------------------------------------------------------------- helpers

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openOrder(page: Page, orderNumber: string) {
  await page.goto(`/dashboard/orders?q=${orderNumber}`);
  await page.getByRole('link', { name: orderNumber }).click();
  await expect(page.getByRole('heading', { name: `Order ${orderNumber}` })).toBeVisible();
}

async function pickFromQueue(page: Page, orderNumber: string) {
  await page.getByRole('link', { name: 'Pick queue' }).click();
  await page.getByLabel('Location', { exact: true }).selectOption({ label: `${fx.locationA.name} (${fx.locationA.code})` });
  const row = page.getByRole('row').filter({ hasText: orderNumber });
  await row.getByRole('button', { name: 'Record pick' }).click();
  const drawer = page.getByRole('dialog', { name: 'Record pick' });
  await expect(drawer.getByLabel('Outcome')).toHaveValue('FULL');
  await drawer.getByRole('button', { name: 'Record pick' }).click();
  await expect(drawer).toBeHidden();
}

/** Runs one package transition (button + confirmation) and waits for the confirmation text. */
/** Confirms on the Courier handover page that the courier collected this parcel (AO-D5). */
async function confirmHandover(page: Page, reference: string) {
  await page.goto('/dashboard/fulfilments/handover');
  await page.getByLabel(`Handed over: ${reference}`).check();
  await page.getByRole('button', { name: /Confirm handover of 1 parcel/ }).click();
  await expect(page.getByText('1 parcel recorded as handed over and marked shipped.')).toBeVisible();
}

async function fulfilmentStep(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await confirmDialog(page, label);
  await expect(page.getByRole('dialog')).toBeHidden();
}
