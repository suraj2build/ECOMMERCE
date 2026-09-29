# M28 — Analytics / Reporting Acceptance Criteria

**Spec(s):** `specs/27-analytics-reporting.md`
**Status:** BUILT (2026-09-28). **Independent-review certification
repair applied 2026-09-29** (fashion sell-through/availability
correctness — see `ANL-001`'s repair addendum in
`blueprint/DECISION_REGISTER.md`). Not self-declared certified -
awaiting independent review.

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
- [x] **(2026-09-29 repair)** Style-level sell-through in
      `getFashionReport` is computed against the COMPLETE SKU universe
      needed for the metric (every SKU with either sales or an
      inventory balance), not only SKUs that appear in sold order
      lines — an inventory-only SKU that never sold still contributes
      its on-hand stock to the style-level denominator. No shadow
      analytics inventory model was created.
- [x] **(2026-09-29 repair)** Fashion "availability" (`inStockSkus`/
      `availabilityRate`) reuses the SAME canonical sellable-availability
      formula as PDP/Channel Publishing
      (`InventoryService.getAvailableToSellBySku`, cross-location
      `sum(onHand) - sum(reserved)`), not raw `onHand` — a fully-reserved
      SKU (`onHand > 0` but `reserved >= onHand`) is correctly excluded
      from availability. The accounting sell-through metric's own use of
      raw `onHand` is unchanged; only the availability metric's
      definition changed.

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
- [x] **(2026-09-29 repair)** 4 additional adversarial tests
      (`test/integration/analytics.test.ts`, now 13 total): an
      inventory-only, never-sold SKU correctly contributes to
      style-level sell-through (regression for the exact Style
      A/SKU 1/SKU 2 scenario the review specified); a fully-reserved SKU
      is excluded from `inStockSkus`/`availabilityRate`; cross-location
      sellable aggregation correctly counts a SKU in-stock only when its
      net across-location availability is positive; and a combined test
      proving sell-through (raw `onHand`) and availability (sellable)
      are independently correct on the SAME fully-reserved SKU
      simultaneously.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
