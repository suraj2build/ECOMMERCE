import { test, expect, type Page } from '@playwright/test';
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
let fx: Fixture;
let tee: ProvisionedStyle;
let mobileSeq = 0;
const nextMobile = () => `98${RUN.replace(/\D/g, '').padEnd(4, '7').slice(0, 4)}${String(++mobileSeq).padStart(4, '0')}`;

test.beforeAll(async () => {
  fx = await setUpFixture();
  tee = await provisionStyle(fx, `P1 Console Tee ${RUN}`);
  for (const s of tee.skus) await stock(fx, s.skuId, fx.locationA.id, 30);
});

test.afterAll(async () => {
  await fx?.api.dispose();
  await prisma.$disconnect();
});

test.describe('P1 Commerce Operations Console', () => {
  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test('P1-01 style is created and completed through the product workbench', async ({ page }) => {
    const code = `P1-NEW-${RUN}`;
    await loginAs(page, 'MERCHANDISING');
    await page.getByRole('link', { name: 'Products' }).click();
    await page.getByRole('link', { name: 'New style' }).click();

    await page.getByLabel('Style code').fill(code);
    await page.getByLabel('Name', { exact: true }).fill('P1 Workbench Shirt');
    await page.getByLabel('Brand', { exact: true }).selectOption({ label: `${fx.brand.name} (${fx.brand.code})` });
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'E2E P1 Category' });
    await page.getByLabel('Season', { exact: true }).fill('AW26');
    await page.getByLabel('Collection', { exact: true }).fill('Console');
    await page.getByRole('button', { name: 'Create style' }).click();
    await expect(page.getByText('Style created in DRAFT')).toBeVisible();

    await page.getByLabel('Colour name').fill('Navy');
    await page.getByLabel('Colour code').fill('NVY');
    await page.getByRole('button', { name: 'Add colour' }).click();
    await expect(page.getByText('Colour added.')).toBeVisible();

    await page.getByLabel('P1-S').check();
    await page.getByLabel('P1-M').check();
    await page.getByRole('button', { name: 'Generate SKUs' }).click();
    await expect(page.getByText('SKU matrix generated')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Colours & SKUs (2)' })).toBeVisible();

    await page.getByRole('tab', { name: /Media/ }).click();
    await page.getByLabel('Media URL').fill('https://example.com/p1-workbench.jpg');
    await page.getByRole('button', { name: 'Add media' }).click();
    await expect(page.getByText('Media added.')).toBeVisible();

    await page.getByRole('button', { name: 'Mark ready for enrichment' }).click();
    await expect(page.getByText('Mark ready for enrichment: done.')).toBeVisible();
    await page.getByRole('button', { name: 'Run QA check' }).click();
    await expect(page.getByText('QA check passed')).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await confirmDialog(page, 'Publish');
    await expect(page.getByText('Publish: done.')).toBeVisible();

    await page.getByRole('tab', { name: 'Pricing' }).click();
    await page.getByLabel('MRP (INR)').fill('1799');
    await page.getByLabel('Selling price (INR)').fill('1499');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByText('Price saved.')).toBeVisible();

    const style = await prisma.style.findUniqueOrThrow({ where: { styleCode: code }, include: { skus: true, colours: true, media: true, prices: true } });
    expect(style.lifecycleState).toBe('PUBLISHED');
    expect(style.skus).toHaveLength(2);
    expect(style.colours.map((c) => c.colourCode)).toEqual(['NVY']);
    expect(style.media).toHaveLength(1);
    expect(style.prices.map((p) => Number(p.sellingPrice))).toEqual([1499]);
    await expect(page.getByRole('heading', { name: `${code} · P1 Workbench Shirt` })).toBeVisible();
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
    await expect(page.getByText('Submit for approval: done.')).toBeVisible();

    // Segregation of duties: a different person (Finance) approves.
    await loginAs(page, 'FINANCE');
    await page.goto(`/dashboard/purchase-orders/${poId}`);
    await expect(page.getByRole('cell', { name: sku.skuCode })).toBeVisible(); // SKU codes without product:read
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Comment (optional)').fill('Within budget');
    await confirmDialog(page, 'Approve');
    await expect(page.getByText('Approve: done.')).toBeVisible();

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
    await page.getByLabel('Status').selectOption({ label: 'ready to ship' });
    await page.getByRole('row').filter({ hasText: order.orderNumber }).getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Book shipment with carrier' }).click();
    await confirmDialog(page, 'Book shipment with carrier');
    await expect(page.getByText(`Package for ${order.orderNumber} updated.`)).toBeVisible();

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
    expect(shipment.provider).toBe('MOCK');
    expect(shipment.status).toBe('BOOKED');
    expect(shipment.trackingRef).toMatch(/^MOCKAWB/);

    await openOrder(page, order.orderNumber);
    await expect(page.getByText(shipment.trackingRef!).first()).toBeVisible();
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
    expect(exchange.paymentDirection).toBe('EVEN');

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
    const pickRow = page.getByRole('row').filter({ hasText: 'Exchange replacement' }).filter({ hasText: 'P1-M' });
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
    const { contactMobile } = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(await prisma.order.count({ where: { contactMobile } })).toBe(1);
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
    expect(promo).toMatchObject({ isActive: true, discountType: 'PERCENTAGE', isCoupon: true, couponCode: `P1AUT${RUN}`, stackGroup: `p1-${RUN}` });
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
async function fulfilmentStep(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await confirmDialog(page, label);
  await expect(page.getByRole('dialog')).toBeHidden();
}
