# M28 — Analytics / Reporting Acceptance Criteria

**Spec(s):** `specs/27-analytics-reporting.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] The following are producible from the event/data foundation:
      sales, orders, returns, refunds, inventory, customer metrics,
      margin, profitability; style/colour/size performance, stock
      ageing, sell-through, availability, return reasons, size-related
      returns; supplier fill rate, short/excess/damaged receipts, lead
      time, purchase vs. sales, supplier performance.

## Functional acceptance

- [ ] Analytics queries read from the ledger models (inventory,
      loyalty, store credit) rather than duplicating or bypassing them
      — verified by architecture review confirming no parallel
      "shadow" balance tracking exists purely for reporting.
- [ ] Margin/profitability calculations correctly use PO purchase cost
      (`acceptance/m04-purchase-orders.md`) against actual transaction
      sale price (`acceptance/m07-catalog-merchandising.md`).

## Negative scenarios / edge cases

1. A cancelled/refunded order is correctly excluded from (or clearly
   marked in) net-sales figures — not double-counted as both a sale
   and a separate refund without reconciliation.

## Test requirements

- [ ] Integration tests: each required analytics category has at least
      one correctness test against known seed data.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
