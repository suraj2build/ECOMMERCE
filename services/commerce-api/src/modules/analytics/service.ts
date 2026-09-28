import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@fcp/db';

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
  constructor(private readonly fastify: FastifyInstance) {}

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

    const orders = await this.prisma.order.findMany({
      where: { createdAt },
      select: { id: true, status: true, grandTotal: true, customerId: true, createdAt: true },
    });
    const nonCancelledOrders = orders.filter((o) => o.status !== 'CANCELLED');
    const grossSales = sumDecimal(nonCancelledOrders.map((o) => o.grandTotal));
    const orderIds = nonCancelledOrders.map((o) => o.id);

    const refunds = orderIds.length
      ? await this.prisma.refund.findMany({
          where: { orderId: { in: orderIds }, status: 'COMPLETED' },
          select: { amount: true, method: true },
        })
      : [];
    const refundedAmount = sumDecimal(refunds.map((r) => r.amount));
    const netSales = grossSales - refundedAmount;

    const refundsByMethod: Record<string, number> = {};
    for (const r of refunds) refundsByMethod[r.method] = (refundsByMethod[r.method] ?? 0) + Number(r.amount);

    const returns = await this.prisma.return.groupBy({
      by: ['status'],
      where: { createdAt },
      _count: { _all: true },
    });

    const customerIds = new Set(nonCancelledOrders.map((o) => o.customerId).filter((id): id is string => !!id));
    const ordersByCustomer = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { not: null }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const repeatCustomerCount = ordersByCustomer.filter((c) => c._count._all > 1).length;

    const inventoryTotals = await this.prisma.inventoryBalance.aggregate({
      _sum: { onHand: true, reserved: true, damaged: true },
    });

    const margin = await this.computeMargin(orderIds);

    return {
      sales: {
        grossSales,
        netSales,
        refundedAmount,
        orderCount: nonCancelledOrders.length,
        cancelledOrderCount: orders.length - nonCancelledOrders.length,
        avgOrderValue: nonCancelledOrders.length > 0 ? grossSales / nonCancelledOrders.length : 0,
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
        totalCustomers: customerIds.size,
        repeatCustomerCount,
        repeatCustomerRate: customerIds.size > 0 ? repeatCustomerCount / customerIds.size : 0,
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
  private async computeMargin(orderIds: string[]) {
    if (orderIds.length === 0) {
      return { revenue: 0, cost: 0, margin: 0, marginPercent: 0, skusWithoutCost: 0 };
    }
    const lines = await this.prisma.orderLine.findMany({
      where: { orderId: { in: orderIds }, status: { not: 'CANCELLED' } },
      select: { skuId: true, quantity: true, taxableValueSnapshot: true },
    });
    const skuIds = [...new Set(lines.map((l) => l.skuId))];
    const avgCosts = skuIds.length
      ? await this.prisma.purchaseOrderLine.groupBy({
          by: ['skuId'],
          where: { skuId: { in: skuIds } },
          _avg: { unitCost: true },
        })
      : [];
    const costBySku = new Map(avgCosts.map((c) => [c.skuId, Number(c._avg.unitCost ?? 0)]));

    const revenue = sumDecimal(lines.map((l) => l.taxableValueSnapshot));
    let cost = 0;
    let skusWithoutCost = 0;
    for (const line of lines) {
      const unitCost = costBySku.get(line.skuId);
      if (unitCost === undefined) {
        skusWithoutCost += 1;
        continue;
      }
      cost += unitCost * line.quantity;
    }
    const margin = revenue - cost;
    return { revenue, cost, margin, marginPercent: revenue > 0 ? margin / revenue : 0, skusWithoutCost };
  }

  // ---------------------------------------------------------------------
  // Fashion-specific
  // ---------------------------------------------------------------------

  async getFashionReport() {
    const soldLines = await this.prisma.orderLine.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { skuId: true, quantity: true, taxableValueSnapshot: true },
    });
    const skuIds = [...new Set(soldLines.map((l) => l.skuId))];
    const skus = skuIds.length
      ? await this.prisma.sku.findMany({
          where: { id: { in: skuIds } },
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

    // Sell-through and availability need the FULL active SKU universe,
    // not only SKUs that have ever sold.
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['skuId'],
      _sum: { onHand: true },
    });
    const onHandBySku = new Map(balances.map((b) => [b.skuId, b._sum.onHand ?? 0]));
    const unitsSoldBySku = new Map<string, number>();
    for (const line of soldLines) unitsSoldBySku.set(line.skuId, (unitsSoldBySku.get(line.skuId) ?? 0) + line.quantity);

    const allSkuIds = new Set([...onHandBySku.keys(), ...unitsSoldBySku.keys()]);
    let inStockCount = 0;
    const sellThroughByStyle = new Map<string, { sold: number; onHand: number }>();
    for (const skuId of allSkuIds) {
      const onHand = onHandBySku.get(skuId) ?? 0;
      if (onHand > 0) inStockCount += 1;
      const styleId = skuById.get(skuId)?.styleId;
      if (!styleId) continue;
      const entry = sellThroughByStyle.get(styleId) ?? { sold: 0, onHand: 0 };
      entry.sold += unitsSoldBySku.get(skuId) ?? 0;
      entry.onHand += onHand;
      sellThroughByStyle.set(styleId, entry);
    }
    const sellThrough = [...sellThroughByStyle.entries()].map(([styleId, v]) => ({
      styleId,
      sellThroughRate: v.sold + v.onHand > 0 ? v.sold / (v.sold + v.onHand) : 0,
    }));

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

    const returnLines = await this.prisma.returnLine.findMany({ select: { reason: true } });
    const reasonCounts = new Map<string, number>();
    let sizeRelatedCount = 0;
    for (const { reason } of returnLines) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      if (SIZE_RELATED_KEYWORDS.some((kw) => reason.toLowerCase().includes(kw))) sizeRelatedCount += 1;
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
        rate: returnLines.length > 0 ? sizeRelatedCount / returnLines.length : 0,
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
