# 05. Goods Receipt (GRN)

**Status:** DRAFT

## Purpose

Define the Goods Receipt Note (GRN) process: how physically received
inventory is checked in against a purchase order, including quality
inspection and exception handling, before it becomes available stock.

## Scope

- Receipt against PO (full/partial)
- Quality inspection / exceptions (damaged, wrong item, short/over
  shipment)
- GRN-to-inventory-ledger posting (this is the primary point where
  inventory ledger "receipt" entries originate — see
  `06-inventory.md` and ADR-0012)
- Discrepancy resolution workflow (supplier debit/credit, return to
  supplier)

## Key architectural constraints (approved)

- A completed GRN (or the relevant portion of it) must post ledger
  entries into the inventory system — inventory must never be
  incremented by directly editing a stock count (ADR-0012).

## Open questions — DECISION_REQUIRED

- Exact quality inspection checklist/criteria per category — not yet
  defined (likely varies by product type).
- Who performs GRN (warehouse staff role — depends on `01-auth-rbac.md`
  role definitions)?
- Exception resolution workflow: does a damaged-on-receipt item ever
  become sellable (e.g., as "damaged/clearance" stock) or is it always
  quarantined/returned to supplier?
- Barcode/scanning requirements for GRN — in scope for initial build?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `04-purchase-orders.md`. Feeds: `06-inventory.md`.
