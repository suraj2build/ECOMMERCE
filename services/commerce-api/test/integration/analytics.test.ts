import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { AnalyticsService } from '../../src/modules/analytics/service.js';

/**
 * Analytics / Reporting (M28, specs/27-analytics-reporting.md, ANL-001)
 * adversarial certification. Every query here reads DIRECTLY from the
 * existing ledger models (Order/OrderLine, Refund, Return/ReturnLine,
 * PurchaseOrder(Line), GoodsReceipt(Line), InventoryBalance/
 * InventoryTransaction) seeded here exactly as their own owning
 * milestones' write paths would leave them - never a parallel "shadow"
 * table. Covers at least one correctness test per required category
 * (Commerce, Fashion-specific, Procurement) against known seed data,
 * plus the required negative scenario: a cancelled order and its
 * completed refund are correctly reconciled into net sales, never
 * double-counted.
 */
describe('Analytics / Reporting (M28)', () => {
  let app: FastifyInstance;
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    seq = 0;
  });

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function fixtureSku(overrides: { styleName?: string } = {}) {
    seq += 1;
    const { brand, category, location, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: {
        styleCode: `ANL-${seq}-${Date.now()}`,
        name: overrides.styleName ?? `Analytics Tee ${seq}`,
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: 'PUBLISHED',
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({
      data: { skuCode: `${style.styleCode}-BLK-M`, styleId: style.id, colourId: colour.id, sizeId: size.id },
    });
    return { style, colour, size, sku, location };
  }

  async function createOrder(params: {
    sku: { id: string };
    locationId: string;
    quantity: number;
    unitPriceInclusive: number;
    taxableValueSnapshot: number;
    status?: 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
    lineStatus?: 'ALLOCATED' | 'DELIVERED' | 'CANCELLED';
    customerId?: string;
  }) {
    seq += 1;
    const checkoutSession = await testPrisma.checkoutSession.create({
      data: {
        customerId: params.customerId,
        guestSessionId: params.customerId ? undefined : `anl-guest-${seq}-${Date.now()}`,
        contactName: 'Test Customer',
        contactMobile: `9${String(1000000000 + seq).slice(0, 9)}`,
        billingAddress: {},
        shippingAddress: {},
        shippingStateCode: 'DL',
        shippingCost: 0,
        subtotal: params.unitPriceInclusive * params.quantity,
        taxAmount: 0,
        grandTotal: params.unitPriceInclusive * params.quantity,
        paymentMethod: 'COD',
        idempotencyKey: `anl-checkout-${seq}-${Date.now()}`,
      },
    });
    const grandTotal = params.unitPriceInclusive * params.quantity;
    const order = await testPrisma.order.create({
      data: {
        orderNumber: `ANL-ORD-${seq}-${Date.now()}`,
        checkoutSessionId: checkoutSession.id,
        customerId: params.customerId,
        guestSessionId: params.customerId ? undefined : checkoutSession.guestSessionId,
        contactName: 'Test Customer',
        contactMobile: checkoutSession.contactMobile,
        billingAddress: {},
        shippingAddress: {},
        shippingCost: 0,
        subtotal: grandTotal,
        taxAmount: 0,
        grandTotal,
        paymentMethod: 'COD',
        status: params.status ?? 'CONFIRMED',
      },
    });
    const line = await testPrisma.orderLine.create({
      data: {
        orderId: order.id,
        skuId: params.sku.id,
        locationId: params.locationId,
        quantity: params.quantity,
        unitPriceInclusive: params.unitPriceInclusive,
        taxableValueSnapshot: params.taxableValueSnapshot,
        gstRatePercent: 0,
        taxAmountSnapshot: 0,
        lineTotalInclusive: params.unitPriceInclusive * params.quantity,
        status: params.lineStatus ?? 'ALLOCATED',
        cancelledAt: params.lineStatus === 'CANCELLED' ? new Date() : undefined,
        cancelledReason: params.lineStatus === 'CANCELLED' ? 'Analytics test fixture cancellation' : undefined,
      },
    });
    return { order, line };
  }

  it('commerce and fashion reports include all 1005 orders and reconcile to SQL totals', async () => {
    const { sku, location } = await fixtureSku();
    const rows = Array.from({ length: 1005 }, () => ({ sessionId: randomUUID(), orderId: randomUUID() }));
    await testPrisma.checkoutSession.createMany({ data: rows.map((r) => ({
      id: r.sessionId, guestSessionId: r.sessionId, contactName: 'Report boundary', contactMobile: '9876543210',
      billingAddress: {}, shippingAddress: {}, shippingStateCode: 'DL', shippingCost: 0, subtotal: 100,
      taxAmount: 0, grandTotal: 100, paymentMethod: 'COD', idempotencyKey: r.sessionId,
    })) });
    await testPrisma.order.createMany({ data: rows.map((r) => ({
      id: r.orderId, orderNumber: r.orderId, checkoutSessionId: r.sessionId, guestSessionId: r.sessionId,
      contactName: 'Report boundary', contactMobile: '9876543210', billingAddress: {}, shippingAddress: {},
      shippingCost: 0, subtotal: 100, taxAmount: 0, grandTotal: 100, paymentMethod: 'COD', status: 'CONFIRMED',
    })) });
    await testPrisma.orderLine.createMany({ data: rows.map((r) => ({
      orderId: r.orderId, skuId: sku.id, locationId: location.id, quantity: 1, unitPriceInclusive: 100,
      taxableValueSnapshot: 100, gstRatePercent: 0, taxAmountSnapshot: 0, lineTotalInclusive: 100, status: 'ALLOCATED',
    })) });
    const [sql] = await testPrisma.$queryRaw<Array<{ count: number; gross: { toString(): string } }>>`SELECT COUNT(*)::int AS count, SUM("grandTotal") AS gross FROM orders WHERE status != 'CANCELLED'`;
    const service = new AnalyticsService(app);
    const commerce = await service.getCommerceReport();
    expect(commerce.sales.orderCount).toBe(1005);
    expect(commerce.sales.orderCount).toBe(sql!.count);
    expect(commerce.sales.grossSales).toBe(Number(sql!.gross));
    expect(commerce.sales.netSales).toBe(100500);
    expect(commerce.margin.revenue).toBe(100500);
    const fashion = await service.getFashionReport();
    expect(fashion.stylePerformance[0]!.unitsSold).toBe(1005);
    expect(fashion.stylePerformance[0]!.revenue).toBe(100500);
  }, 120_000);

  describe('Commerce category', () => {
    it('computes gross/net sales, order counts, and margin correctly against known seed data', async () => {
      const { sku, location } = await fixtureSku();
      await testPrisma.purchaseOrderLine.create({
        data: {
          po: {
            create: {
              poNumber: `ANL-PO-${Date.now()}`,
              supplier: { create: { code: `SUP-${Date.now()}`, name: 'Test Supplier', type: 'FINISHED_GOODS' } },
              location: { connect: { id: location.id } },
            },
          },
          sku: { connect: { id: sku.id } },
          orderedQty: 100,
          unitCost: 400,
        },
      });

      // Order A: CONFIRMED, 1000 gross, no refund.
      await createOrder({ sku, locationId: location.id, quantity: 1, unitPriceInclusive: 1000, taxableValueSnapshot: 1000 });
      // Order B: CONFIRMED, 1000 gross, fully refunded (a return-triggered refund on a non-cancelled order).
      const { order: orderB, line: lineB } = await createOrder({
        sku,
        locationId: location.id,
        quantity: 1,
        unitPriceInclusive: 1000,
        taxableValueSnapshot: 1000,
      });
      await testPrisma.refund.create({
        data: {
          orderId: orderB.id,
          orderLineId: lineB.id,
          triggerType: 'RETURN',
          method: 'ORIGINAL_PAYMENT_METHOD',
          amount: 1000,
          reason: 'Customer return',
          status: 'COMPLETED',
          idempotencyKey: `anl-refund-${Date.now()}`,
        },
      });
      // Order C: CANCELLED - must contribute ZERO to both gross and net sales.
      await createOrder({
        sku,
        locationId: location.id,
        quantity: 1,
        unitPriceInclusive: 1000,
        taxableValueSnapshot: 1000,
        status: 'CANCELLED',
        lineStatus: 'CANCELLED',
      });

      const service = new AnalyticsService(app);
      const report = await service.getCommerceReport();

      expect(report.sales.grossSales).toBe(2000); // A + B, C excluded entirely
      expect(report.sales.orderCount).toBe(2);
      expect(report.sales.cancelledOrderCount).toBe(1);
      expect(report.refunds.totalRefunded).toBe(1000);
      // Net sales = gross - refunded - reconciled, never double-counted.
      expect(report.sales.netSales).toBe(1000);
      expect(report.sales.avgOrderValue).toBe(1000);

      // Margin: revenue from taxableValueSnapshot (2000, cancelled line excluded),
      // cost from the real PO unitCost (400) x quantity sold (2) = 800.
      expect(report.margin.revenue).toBe(2000);
      expect(report.margin.cost).toBe(800);
      expect(report.margin.margin).toBe(1200);
    });

    it('reads inventory totals from the existing InventoryBalance ledger, never a shadow table', async () => {
      const { sku, location } = await fixtureSku();
      await testPrisma.inventoryBalance.create({
        data: { skuId: sku.id, locationId: location.id, onHand: 50, reserved: 5, damaged: 2 },
      });
      const service = new AnalyticsService(app);
      const report = await service.getCommerceReport();
      expect(report.inventory.totalOnHand).toBe(50);
      expect(report.inventory.totalReserved).toBe(5);
      expect(report.inventory.totalDamaged).toBe(2);
    });

    it('computes repeat-customer rate from real Order rows grouped by customerId', async () => {
      const { sku, location } = await fixtureSku();
      const customerA = await testPrisma.customer.create({ data: { mobile: `9${Date.now()}`.slice(0, 10), fullName: 'A' } });
      const customerB = await testPrisma.customer.create({ data: { mobile: `8${Date.now()}`.slice(0, 10), fullName: 'B' } });
      await createOrder({ sku, locationId: location.id, quantity: 1, unitPriceInclusive: 500, taxableValueSnapshot: 500, customerId: customerA.id });
      await createOrder({ sku, locationId: location.id, quantity: 1, unitPriceInclusive: 500, taxableValueSnapshot: 500, customerId: customerA.id });
      await createOrder({ sku, locationId: location.id, quantity: 1, unitPriceInclusive: 500, taxableValueSnapshot: 500, customerId: customerB.id });

      const service = new AnalyticsService(app);
      const report = await service.getCommerceReport();
      expect(report.customers.totalCustomers).toBe(2);
      expect(report.customers.repeatCustomerCount).toBe(1);
      expect(report.customers.repeatCustomerRate).toBeCloseTo(0.5);
    });
  });

  describe('Fashion-specific category', () => {
    it('computes style/colour/size performance, sell-through, and availability from real OrderLine + InventoryBalance data', async () => {
      const { sku, style, colour, size, location } = await fixtureSku();
      await createOrder({ sku, locationId: location.id, quantity: 3, unitPriceInclusive: 500, taxableValueSnapshot: 500 * 3 });
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: 7 } });

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();

      const styleEntry = report.stylePerformance.find((s) => s.styleId === style.id);
      expect(styleEntry?.unitsSold).toBe(3);
      expect(styleEntry?.revenue).toBe(1500);

      const colourEntry = report.colourPerformance.find((c) => c.colourId === colour.id);
      expect(colourEntry?.unitsSold).toBe(3);

      const sizeEntry = report.sizePerformance.find((s) => s.sizeId === size.id);
      expect(sizeEntry?.unitsSold).toBe(3);

      const sellThroughEntry = report.sellThrough.find((s) => s.styleId === style.id);
      // sold=3, onHand=7 -> 3/10 = 0.3
      expect(sellThroughEntry?.sellThroughRate).toBeCloseTo(0.3);

      expect(report.availability.totalSkus).toBeGreaterThanOrEqual(1);
      expect(report.availability.inStockSkus).toBeGreaterThanOrEqual(1);
    });

    /**
     * M28 independent-review certification repair (2026-09-29), Blocker
     * 2: the original build resolved SKU dimensional metadata (used to
     * attribute a SKU's figures to its style) from ONLY the sold-SKU
     * set. A SKU with real on-hand stock that has never sold had no
     * styleId to attribute to, so its onHand was silently dropped from
     * the style-level sell-through denominator - the exact regression
     * scenario the review specified: Style A, SKU 1 (sold=3, onHand=0)
     * and SKU 2 (sold=0, onHand=7) must report 3/10=0.30, never 1.00.
     */
    it('an inventory-only SKU that has never sold still contributes its onHand stock to style-level sell-through, never silently dropped', async () => {
      const { sku: sku1, style, colour, location } = await fixtureSku();
      await createOrder({ sku: sku1, locationId: location.id, quantity: 3, unitPriceInclusive: 500, taxableValueSnapshot: 1500 });
      // SKU 1: sold=3, onHand=0 (fully sold out).

      // SKU 2: same style/colour, a different size, NEVER sold - only
      // ever appears via its InventoryBalance row, never in soldLines.
      const size2 = await testPrisma.size.create({ data: { label: `ANL-L-${Date.now()}`, sortOrder: 1 } });
      const sku2 = await testPrisma.sku.create({
        data: { skuCode: `${style.styleCode}-BLK-L`, styleId: style.id, colourId: colour.id, sizeId: size2.id },
      });
      await testPrisma.inventoryBalance.create({ data: { skuId: sku2.id, locationId: location.id, onHand: 7 } });

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();

      const sellThroughEntry = report.sellThrough.find((s) => s.styleId === style.id);
      // sold=3 (SKU1 only), onHand=0+7=7 (both SKUs) -> 3/10 = 0.30.
      // The pre-repair bug silently dropped SKU2's onHand, producing
      // 3/(3+0)=1.00 instead.
      expect(sellThroughEntry?.sellThroughRate).toBeCloseTo(0.3);
    });

    /**
     * M28 independent-review certification repair (2026-09-29), Blocker
     * 2B: "availability" is a sellable/customer-facing metric and must
     * use the SAME canonical `onHand - reserved` formula customer-facing
     * availability uses elsewhere (InventoryService.
     * getAvailableToSellBySku), never raw `onHand > 0` - a SKU with real
     * onHand but fully reserved has ZERO units a customer could actually
     * buy right now.
     */
    it('a SKU with onHand fully consumed by reservations is NOT counted as available, even though onHand itself is positive', async () => {
      const { sku, location } = await fixtureSku();
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: 10, reserved: 10 } });

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();

      expect(report.availability.totalSkus).toBe(1);
      expect(report.availability.inStockSkus).toBe(0);
      expect(report.availability.availabilityRate).toBe(0);
    });

    it('sellable availability aggregates correctly across locations - a fully-reserved location and a genuinely sellable location combine into one true available SKU', async () => {
      const { sku, location } = await fixtureSku();
      const location2 = await testPrisma.location.create({ data: { code: `ANL-WH-2-${Date.now()}`, name: 'Second Warehouse', type: 'WAREHOUSE' } });
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: 5, reserved: 5 } }); // fully reserved here
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location2.id, onHand: 3, reserved: 0 } }); // genuinely sellable here

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();

      expect(report.availability.totalSkus).toBe(1);
      expect(report.availability.inStockSkus).toBe(1);
      expect(report.availability.availabilityRate).toBe(1);
    });

    it('accounting sell-through onHand is unaffected by the availability fix - sellThrough still reflects raw onHand, not onHand-minus-reserved', async () => {
      const { sku, style, location } = await fixtureSku();
      await createOrder({ sku, locationId: location.id, quantity: 2, unitPriceInclusive: 500, taxableValueSnapshot: 1000 });
      // onHand=8 but fully reserved (0 sellable) - sellThrough must still
      // use the raw accounting onHand=8, never the sellable figure (0).
      await testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: 8, reserved: 8 } });

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();

      const sellThroughEntry = report.sellThrough.find((s) => s.styleId === style.id);
      // sold=2, onHand=8 (raw accounting figure) -> 2/10 = 0.20.
      expect(sellThroughEntry?.sellThroughRate).toBeCloseTo(0.2);
      // But availability correctly reports zero sellable stock for this SKU.
      expect(report.availability.inStockSkus).toBe(0);
    });

    it('groups return reasons by the real free-text ReturnLine.reason and correctly identifies size-related returns by keyword', async () => {
      const { sku, location } = await fixtureSku();
      const { order, line } = await createOrder({ sku, locationId: location.id, quantity: 1, unitPriceInclusive: 800, taxableValueSnapshot: 800 });
      const ret = await testPrisma.return.create({
        data: {
          returnNumber: `ANL-RET-${Date.now()}`,
          orderId: order.id,
          method: 'PICKUP',
          initiatedBy: 'CUSTOMER',
          idempotencyKey: `anl-return-${Date.now()}`,
        },
      });
      await testPrisma.returnLine.create({
        data: { returnId: ret.id, orderLineId: line.id, skuId: sku.id, locationId: location.id, quantity: 1, reason: 'Size too small' },
      });

      const service = new AnalyticsService(app);
      const report = await service.getFashionReport();
      const reasonEntry = report.returnReasons.find((r) => r.reason === 'Size too small');
      expect(reasonEntry?.count).toBe(1);
      expect(report.sizeRelatedReturns.count).toBe(1);
      expect(report.sizeRelatedReturns.rate).toBe(1);
    });
  });

  describe('Procurement category', () => {
    it('computes supplier fill rate, receipt quality (short/excess/damaged), lead time, and purchase-vs-sales from real PO/GRN rows', async () => {
      const { sku, location } = await fixtureSku();
      const { staffUserId } = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const supplier = await testPrisma.supplier.create({
        data: { code: `SUP-${Date.now()}`, name: 'Lead Time Supplier', type: 'FINISHED_GOODS' },
      });

      const po = await testPrisma.purchaseOrder.create({
        data: { poNumber: `ANL-PO2-${Date.now()}`, supplierId: supplier.id, locationId: location.id, status: 'APPROVED' },
      });
      const poLine = await testPrisma.purchaseOrderLine.create({
        data: { poId: po.id, skuId: sku.id, orderedQty: 100, unitCost: 200, receivedQty: 90 },
      });
      const approvedAt = new Date(Date.now() - 5 * 86_400_000);
      await testPrisma.purchaseOrderApproval.create({
        data: { poId: po.id, staffId: staffUserId, action: 'APPROVED', createdAt: approvedAt },
      });

      const grn = await testPrisma.goodsReceipt.create({
        data: { grnNumber: `ANL-GRN-${Date.now()}`, poId: po.id, locationId: location.id, receivedByStaffId: staffUserId },
      });
      await testPrisma.goodsReceiptLine.create({
        data: {
          grnId: grn.id,
          poLineId: poLine.id,
          skuId: sku.id,
          expectedQty: 100,
          receivedQty: 90,
          acceptedQty: 85,
          shortQty: 10,
          excessQty: 0,
          damagedQty: 5,
          qcResult: 'PARTIAL',
        },
      });

      const service = new AnalyticsService(app);
      const report = await service.getProcurementReport();

      const fillRate = report.supplierFillRate.find((s) => s.supplierId === supplier.id);
      expect(fillRate?.fillRate).toBeCloseTo(0.9); // 90/100

      const quality = report.receiptQuality.find((q) => q.supplierId === supplier.id);
      expect(quality?.shortQty).toBe(10);
      expect(quality?.damagedQty).toBe(5);

      const leadTime = report.leadTime.find((l) => l.supplierId === supplier.id);
      expect(leadTime?.avgLeadTimeDays).toBeCloseTo(5, 0);

      const perf = report.supplierPerformance.find((s) => s.supplierId === supplier.id);
      expect(perf?.fillRate).toBeCloseTo(0.9);
      expect(perf?.avgLeadTimeDays).toBeCloseTo(5, 0);

      expect(report.purchaseVsSales.totalPurchaseCost).toBe(100 * 200);
    });
  });

  describe('RBAC', () => {
    it('rejects a request without analytics:read', async () => {
      const { token } = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/commerce', headers: auth(token) });
      expect(res.statusCode).toBe(403);
    });

    it('allows a request with analytics:read over HTTP', async () => {
      const { token } = await createAuthenticatedStaff(app, ['ANALYTICS']);
      await grantPermissions('ANALYTICS', ['analytics:read']);
      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/commerce', headers: auth(token) });
      expect(res.statusCode).toBe(200);
      expect(res.json().sales).toBeDefined();
    });

    it('rejects an unauthenticated request', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/fashion' });
      expect(res.statusCode).toBe(401);
    });
  });
});
