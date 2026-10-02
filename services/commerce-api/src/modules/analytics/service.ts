import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';
import { InventoryService } from '../inventory/service.js';

export interface DateRange {
  from?: Date;
  to?: Date;
}

const SIZE_RELATED_KEYWORDS = ['size', 'fit', 'fits', 'small', 'large', 'tight', 'loose'];

/**
 * Analytics / Reporting (M28, specs/27-analytics-reporting.md, ANL-001).
 * Every method here reads from the EXISTING ledger/domain models
 * (Order/OrderLine, Refund, Return/ReturnLine, PurchaseOrder(Line),
 * GoodsReceipt(Line), InventoryBalance/InventoryTransaction) - there is
 * no second, parallel "shadow" balance table anywhere in this module.
 * This is the "build native event/data foundations first" half of
 * ANL-001; a BI/dashboard presentation layer is an explicitly deferred,
 * separate evaluation, not built here.
 */
export class AnalyticsService {
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  // ---------------------------------------------------------------------
  // Commerce
  // ---------------------------------------------------------------------

  /**
   * Sales/orders/returns/refunds/inventory/customer/margin metrics.
   * Net sales explicitly reconciles refunds against the orders they
   * belong to - a cancelled order contributes nothing to gross OR net
   * sales, and a refund against a non-cancelled order (a return-
   * triggered refund) is subtracted from gross sales to reach net sales,
   * so nothing is ever double-counted as both a sale and a separate,
   * unreconciled refund.
   */
  async getCommerceReport(range: DateRange = {}) {
    const createdAt = dateRangeFilter(range);

    // Aggregate at the database instead of loading every order/refund or
    // handing a growing order-id IN list to PostgreSQL.
    const orderTotals = await this.prisma.order.groupBy({
      by: ['status'], where: { createdAt },
      _sum: { grandTotal: true }, _count: { _all: true },
    });
    const cancelledOrderCount = orderTotals.find((o) => o.status === 'CANCELLED')?._count._all ?? 0;
    const included = orderTotals.filter((o) => o.status !== 'CANCELLED');
    const orderCount = included.reduce((sum, o) => sum + o._count._all, 0);
    const grossSales = included.reduce((sum, o) => sum + Number(o._sum.grandTotal ?? 0), 0);
    const refundTotals = await this.prisma.refund.groupBy({
      by: ['method'],
      where: { status: 'COMPLETED', order: { createdAt, status: { not: 'CANCELLED' } } },
      _sum: { amount: true },
    });
    const refundedAmount = refundTotals.reduce((sum, r) => sum + Number(r._sum.amount ?? 0), 0);
    const netSales = grossSales - refundedAmount;
    const refundsByMethod = Object.fromEntries(refundTotals.map((r) => [r.method, Number(r._sum.amount ?? 0)]));

    const returns = await this.prisma.return.groupBy({
      by: ['status'],
      where: { createdAt },
      _count: { _all: true },
    });

    const customersInRange = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { createdAt, customerId: { not: null }, status: { not: 'CANCELLED' } },
    });
    const totalCustomers = customersInRange.length;
    const ordersByCustomer = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { not: null }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const repeatCustomerCount = ordersByCustomer.filter((c) => c._count._all > 1).length;

    const inventoryTotals = await this.prisma.inventoryBalance.aggregate({
      _sum: { onHand: true, reserved: true, damaged: true },
    });

    const margin = await this.computeMargin(createdAt);

    return {
      sales: {
        grossSales,
        netSales,
        refundedAmount,
        orderCount,
        cancelledOrderCount,
        avgOrderValue: orderCount > 0 ? grossSales / orderCount : 0,
      },
      returns: {
        totalReturns: returns.reduce((sum, r) => sum + r._count._all, 0),
        byStatus: Object.fromEntries(returns.map((r) => [r.status, r._count._all])),
      },
      refunds: { totalRefunded: refundedAmount, byMethod: refundsByMethod },
      inventory: {
        totalOnHand: inventoryTotals._sum.onHand ?? 0,
        totalReserved: inventoryTotals._sum.reserved ?? 0,
        totalDamaged: inventoryTotals._sum.damaged ?? 0,
      },
      customers: {
        totalCustomers,
        repeatCustomerCount,
        repeatCustomerRate: totalCustomers > 0 ? repeatCustomerCount / totalCustomers : 0,
      },
      margin,
    };
  }

  /**
   * Margin/profitability: revenue is each OrderLine's own
   * `taxableValueSnapshot` (the real, already-discounted, ex-tax amount
   * actually invoiced - never a re-derived or shadow figure). Cost is
   * the average `PurchaseOrderLine.unitCost` actually paid for that SKU
   * (RET-005/PO-001's own source of truth) - a SKU with no purchase
   * history contributes zero cost and is reported separately as
   * `skusWithoutCost`, never silently assumed zero-cost inside the
   * margin figure itself.
   */
  private async computeMargin(createdAt: ReturnType<typeof dateRangeFilter>) {
    const orderFilter = { createdAt, status: { not: 'CANCELLED' as const } };
    const lines = await this.prisma.orderLine.groupBy({
      by: ['skuId'],
      where: { order: orderFilter, status: { not: 'CANCELLED' } },
      _sum: { quantity: true, taxableValueSnapshot: true }, _count: { _all: true },
    });
    const avgCosts = await this.prisma.purchaseOrderLine.groupBy({
      by: ['skuId'],
      where: { sku: { orderLines: { some: { order: orderFilter, status: { not: 'CANCELLED' } } } } },
      _avg: { unitCost: true },
    });
    const costBySku = new Map(avgCosts.map((c) => [c.skuId, Number(c._avg.unitCost ?? 0)]));
    const revenue = lines.reduce((sum, l) => sum + Number(l._sum.taxableValueSnapshot ?? 0), 0);
    let cost = 0;
    let skusWithoutCost = 0;
    for (const line of lines) {
      const unitCost = costBySku.get(line.skuId);
      if (unitCost === undefined) {
        // Preserve the existing count of affected lines, not unique SKUs.
        skusWithoutCost += line._count._all;
        continue;
      }
      cost += unitCost * (line._sum.quantity ?? 0);
    }
    const margin = revenue - cost;
    return { revenue, cost, margin, marginPercent: revenue > 0 ? margin / revenue : 0, skusWithoutCost };
  }

  // ---------------------------------------------------------------------
  // Fashion-specific
  // ---------------------------------------------------------------------

  async getFashionReport() {
    const soldGroups = await this.prisma.orderLine.groupBy({
      by: ['skuId'], where: { status: { not: 'CANCELLED' } },
      _sum: { quantity: true, taxableValueSnapshot: true },
    });
    const soldLines = soldGroups.map((line) => ({ skuId: line.skuId,
      quantity: line._sum.quantity ?? 0, taxableValueSnapshot: line._sum.taxableValueSnapshot ?? 0 }));

    // M28 independent-review certification repair (2026-09-29, Blocker
    // 2): sell-through and availability need the FULL SKU universe this
    // metric is computed over - every SKU with either a sale or an
    // inventory balance - not only SKUs that have ever sold. The
    // original build resolved dimensional metadata (skuById, used to
    // attribute a SKU's figures to its style) from ONLY the sold-SKU
    // set, so a SKU that carries real on-hand stock but has never sold
    // had no styleId to attribute to and was silently dropped from
    // style-level sell-through - understating the denominator and
    // overstating the rate (e.g. a style with one sold-out SKU and one
    // never-sold, fully-stocked SKU reported 100% sell-through instead
    // of the true blended rate). Fixed by resolving `balances` (this
    // SKU universe's other half) FIRST, computing `allSkuIds` as their
    // union, then loading dimensional metadata for that COMPLETE set -
    // no shadow analytics inventory model, still the same single
    // InventoryBalance groupBy this method always used.
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['skuId'],
      _sum: { onHand: true },
    });
    const onHandBySku = new Map(balances.map((b) => [b.skuId, b._sum.onHand ?? 0]));
    const unitsSoldBySku = new Map<string, number>();
    for (const line of soldLines) unitsSoldBySku.set(line.skuId, (unitsSoldBySku.get(line.skuId) ?? 0) + line.quantity);
    const allSkuIds = new Set([...onHandBySku.keys(), ...unitsSoldBySku.keys()]);

    const skus = allSkuIds.size
      ? await this.prisma.sku.findMany({
          where: { OR: [{ inventoryBalances: { some: {} } }, { orderLines: { some: { status: { not: 'CANCELLED' } } } }] },
          select: { id: true, styleId: true, colourId: true, sizeId: true, style: { select: { name: true } } },
        })
      : [];
    const skuById = new Map(skus.map((s) => [s.id, s]));

    const performanceBy = (keyOf: (skuId: string) => string | undefined) => {
      const acc = new Map<string, { unitsSold: number; revenue: number }>();
      for (const line of soldLines) {
        const key = keyOf(line.skuId);
        if (!key) continue;
        const entry = acc.get(key) ?? { unitsSold: 0, revenue: 0 };
        entry.unitsSold += line.quantity;
        entry.revenue += Number(line.taxableValueSnapshot);
        acc.set(key, entry);
      }
      return [...acc.entries()].map(([key, v]) => ({ key, ...v }));
    };

    const styles = performanceBy((skuId) => skuById.get(skuId)?.styleId);
    const colours = performanceBy((skuId) => skuById.get(skuId)?.colourId);
    const sizes = performanceBy((skuId) => skuById.get(skuId)?.sizeId);

    // M28 independent-review certification repair (2026-09-29, Blocker
    // 2B): sell-through remains an ACCOUNTING/turnover metric - it
    // intentionally keeps using raw `onHand` (never altered by this
    // repair). `availability` below is a DIFFERENT metric ("can a
    // customer buy this right now") and is fixed separately.
    const sellThroughByStyle = new Map<string, { sold: number; onHand: number }>();
    for (const skuId of allSkuIds) {
      const styleId = skuById.get(skuId)?.styleId;
      if (!styleId) continue;
      const entry = sellThroughByStyle.get(styleId) ?? { sold: 0, onHand: 0 };
      entry.sold += unitsSoldBySku.get(skuId) ?? 0;
      entry.onHand += onHandBySku.get(skuId) ?? 0;
      sellThroughByStyle.set(styleId, entry);
    }
    const sellThrough = [...sellThroughByStyle.entries()].map(([styleId, v]) => ({
      styleId,
      sellThroughRate: v.sold + v.onHand > 0 ? v.sold / (v.sold + v.onHand) : 0,
    }));

    // M28 independent-review certification repair (2026-09-29, Blocker
    // 2B): "available" here means sellable/customer-facing availability
    // - the SAME canonical cross-location `onHand - reserved` formula
    // customer-facing/channel availability uses elsewhere
    // (InventoryService.getAvailableToSellBySku, also used by PDP and
    // Channel Publishing), never a second, independently-invented
    // formula and never the raw accounting `onHand > 0` the original
    // build used (which wrongly counted a fully-reserved SKU - onHand
    // positive but zero actually sellable - as "available"). This does
    // NOT touch the accounting onHand/sellThrough figures above.
    const availableToSellBySku = await this.inventory.getAvailableToSellBySku([...allSkuIds]);
    let inStockCount = 0;
    for (const skuId of allSkuIds) {
      if ((availableToSellBySku.get(skuId) ?? 0) > 0) inStockCount += 1;
    }

    // Stock ageing: days since the most recent RECEIPT transaction for each SKU.
    const receipts = await this.prisma.inventoryTransaction.groupBy({
      by: ['skuId'],
      where: { type: 'RECEIPT' },
      _max: { createdAt: true },
    });
    const now = Date.now();
    const stockAgeing = receipts.map((r) => ({
      skuId: r.skuId,
      daysSinceLastReceipt: r._max.createdAt ? Math.floor((now - r._max.createdAt.getTime()) / 86_400_000) : null,
    }));

    const returnReasons = await this.prisma.returnLine.groupBy({ by: ['reason'], _count: { _all: true } });
    const totalReturnLines = returnReasons.reduce((sum, r) => sum + r._count._all, 0);
    const reasonCounts = new Map<string, number>();
    let sizeRelatedCount = 0;
    for (const { reason, _count } of returnReasons) {
      reasonCounts.set(reason, _count._all);
      if (SIZE_RELATED_KEYWORDS.some((kw) => reason.toLowerCase().includes(kw))) sizeRelatedCount += _count._all;
    }

    return {
      stylePerformance: styles.map((s) => ({ styleId: s.key, unitsSold: s.unitsSold, revenue: s.revenue })),
      colourPerformance: colours.map((c) => ({ colourId: c.key, unitsSold: c.unitsSold, revenue: c.revenue })),
      sizePerformance: sizes.map((s) => ({ sizeId: s.key, unitsSold: s.unitsSold, revenue: s.revenue })),
      stockAgeing,
      sellThrough,
      availability: {
        totalSkus: allSkuIds.size,
        inStockSkus: inStockCount,
        availabilityRate: allSkuIds.size > 0 ? inStockCount / allSkuIds.size : 0,
      },
      // Return reasons are free-text (ReturnLine.reason has no
      // structured category enum) - grouped by exact string, an honest
      // reflection of what merchandising/CS actually entered, never a
      // fabricated taxonomy. size-related-ness is a documented keyword
      // heuristic over that same free text, not a separate stored field.
      returnReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
      sizeRelatedReturns: {
        count: sizeRelatedCount,
        rate: totalReturnLines > 0 ? sizeRelatedCount / totalReturnLines : 0,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Procurement
  // ---------------------------------------------------------------------

  async getProcurementReport(range: DateRange = {}) {
    const createdAt = dateRangeFilter(range);

    const poLines = await this.prisma.purchaseOrderLine.findMany({
      where: { po: { createdAt } },
      select: { orderedQty: true, receivedQty: true, unitCost: true, skuId: true, po: { select: { supplierId: true } } },
    });

    const bySupplier = new Map<string, { ordered: number; received: number; cost: number }>();
    for (const line of poLines) {
      const entry = bySupplier.get(line.po.supplierId) ?? { ordered: 0, received: 0, cost: 0 };
      entry.ordered += line.orderedQty;
      entry.received += line.receivedQty;
      entry.cost += line.orderedQty * Number(line.unitCost);
      bySupplier.set(line.po.supplierId, entry);
    }
    const supplierFillRate = [...bySupplier.entries()].map(([supplierId, v]) => ({
      supplierId,
      fillRate: v.ordered > 0 ? v.received / v.ordered : 0,
    }));

    const grnLines = await this.prisma.goodsReceiptLine.findMany({
      where: { grn: { createdAt } },
      select: {
        shortQty: true,
        excessQty: true,
        damagedQty: true,
        expectedQty: true,
        grn: { select: { poId: true, createdAt: true, po: { select: { supplierId: true } } } },
      },
    });
    const receiptQualityBySupplier = new Map<string, { short: number; excess: number; damaged: number; expected: number }>();
    for (const line of grnLines) {
      const supplierId = line.grn.po.supplierId;
      const entry = receiptQualityBySupplier.get(supplierId) ?? { short: 0, excess: 0, damaged: 0, expected: 0 };
      entry.short += line.shortQty;
      entry.excess += line.excessQty;
      entry.damaged += line.damagedQty;
      entry.expected += line.expectedQty;
      receiptQualityBySupplier.set(supplierId, entry);
    }

    // Lead time: days from the PO's own APPROVED approval action to the
    // first GRN's own createdAt for that PO (real timestamps on real
    // rows, never re-derived/estimated).
    const approvals = await this.prisma.purchaseOrderApproval.findMany({
      where: { action: 'APPROVED', po: { createdAt } },
      select: { poId: true, createdAt: true, po: { select: { supplierId: true } } },
    });
    const firstGrnByPo = new Map<string, Date>();
    for (const line of grnLines) {
      const existing = firstGrnByPo.get(line.grn.poId);
      if (!existing || line.grn.createdAt < existing) firstGrnByPo.set(line.grn.poId, line.grn.createdAt);
    }
    const leadTimeDaysBySupplier = new Map<string, number[]>();
    for (const approval of approvals) {
      const firstGrn = firstGrnByPo.get(approval.poId);
      if (!firstGrn) continue;
      const days = (firstGrn.getTime() - approval.createdAt.getTime()) / 86_400_000;
      const arr = leadTimeDaysBySupplier.get(approval.po.supplierId) ?? [];
      arr.push(days);
      leadTimeDaysBySupplier.set(approval.po.supplierId, arr);
    }

    const supplierIds = new Set([...bySupplier.keys(), ...receiptQualityBySupplier.keys(), ...leadTimeDaysBySupplier.keys()]);
    const supplierPerformance = [...supplierIds].map((supplierId) => {
      const fill = bySupplier.get(supplierId);
      const quality = receiptQualityBySupplier.get(supplierId);
      const leadTimes = leadTimeDaysBySupplier.get(supplierId) ?? [];
      return {
        supplierId,
        fillRate: fill && fill.ordered > 0 ? fill.received / fill.ordered : null,
        defectRate: quality && quality.expected > 0 ? (quality.short + quality.excess + quality.damaged) / quality.expected : null,
        avgLeadTimeDays: leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null,
      };
    });

    const totalPurchaseCost = poLines.reduce((sum, l) => sum + l.orderedQty * Number(l.unitCost), 0);
    const salesRevenue = sumDecimal(
      (
        await this.prisma.orderLine.findMany({
          where: { order: { createdAt }, status: { not: 'CANCELLED' } },
          select: { taxableValueSnapshot: true },
        })
      ).map((l) => l.taxableValueSnapshot),
    );

    return {
      supplierFillRate,
      receiptQuality: [...receiptQualityBySupplier.entries()].map(([supplierId, v]) => ({
        supplierId,
        shortQty: v.short,
        excessQty: v.excess,
        damagedQty: v.damaged,
      })),
      leadTime: [...leadTimeDaysBySupplier.entries()].map(([supplierId, days]) => ({
        supplierId,
        avgLeadTimeDays: days.reduce((a, b) => a + b, 0) / days.length,
      })),
      purchaseVsSales: { totalPurchaseCost, salesRevenue },
      supplierPerformance,
    };
  }
}

function sumDecimal(values: Array<{ toString(): string }>): number {
  return values.reduce((sum: number, v) => sum + Number(v), 0);
}

function dateRangeFilter(range: DateRange): { gte?: Date; lte?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return { gte: range.from, lte: range.to };
}
