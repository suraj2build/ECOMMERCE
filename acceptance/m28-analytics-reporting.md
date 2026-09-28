# M28 — Analytics / Reporting Acceptance Criteria

**Spec(s):** `specs/27-analytics-reporting.md`
**Status:** BUILT (2026-09-28). Not self-declared certified - awaiting
independent review.

## Business acceptance

- [x] The following are producible from the event/data foundation via
      `AnalyticsService`/`GET /analytics/{commerce,fashion,procurement}`:
      sales, orders, returns, refunds, inventory, customer metrics,
      margin, profitability (`getCommerceReport`); style/colour/size
      performance, stock ageing, sell-through, availability, return
      reasons, size-related returns (`getFashionReport`); supplier
      fill rate, short/excess/damaged receipts, lead time, purchase
      vs. sales, supplier performance (`getProcurementReport`).

## Functional acceptance

- [x] Analytics queries read from the ledger models (`Order`/
      `OrderLine`, `Refund`, `Return`/`ReturnLine`, `PurchaseOrder(Line)`,
      `GoodsReceipt(Line)`, `InventoryBalance`/`InventoryTransaction`)
      rather than duplicating or bypassing them — verified by
      architecture review: `services/commerce-api/src/modules/
      analytics/service.ts` creates zero new tables and queries these
      models directly; no parallel "shadow" balance tracking exists.
- [x] Margin/profitability calculations correctly use PO purchase cost
      (average `PurchaseOrderLine.unitCost` per SKU) against actual
      transaction sale price (`OrderLine.taxableValueSnapshot`, the
      real post-discount, ex-tax amount actually invoiced) - proven
      against known seed data (`test/integration/analytics.test.ts`).

## Negative scenarios / edge cases

1. A cancelled/refunded order is correctly excluded from (or clearly
   marked in) net-sales figures — not double-counted as both a sale
   and a separate refund without reconciliation. Proven: a CANCELLED
   order contributes zero to gross or net sales; a COMPLETED refund
   against a non-cancelled order is subtracted from gross sales to
   reach net sales (`report.sales.{grossSales,netSales,refundedAmount}`).

## Test requirements

- [x] Integration tests: each required analytics category (Commerce,
      Fashion-specific, Procurement) has at least one correctness test
      against known seed data — 9 tests total in
      `test/integration/analytics.test.ts`, including the required
      negative scenario and staff RBAC (`analytics:read`, an existing
      permission — no new key needed for a read-only reporting surface).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
