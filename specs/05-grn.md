# 05. Goods Receipt (GRN)

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `GRN-001`–`003`)

## Purpose

Define the Goods Receipt Note (GRN) process: how physically received
inventory is checked in against a purchase order, including quality
inspection and exception handling, before it becomes available stock.

## Scope

- Receipt against PO (full/partial)
- Quality inspection / exceptions (damaged, wrong item, short/over
  shipment)
- GRN-to-inventory-ledger posting
- Discrepancy resolution workflow

## Approved requirements (2026-09-22)

- **QC is required.** GRN MUST support each of: received quantity,
  short receipt, excess receipt, damaged receipt, and rejected/
  QC-failed receipt, each with defined exception handling.
- The per-category inspection checklist content is a configurable
  operational parameter, not hard-coded — the *capability* to define
  and apply a checklist per category is what's required.
- Exception resolution (supplier debit/credit note, return-to-supplier,
  write-off) MUST be supported as configurable resolution paths keyed
  to the exception type recorded at GRN. Credit-note generation for a
  supplier exception ties to `specs/32-india-tax-invoicing.md` `TAX-005`
  once its compliance verification completes.
- A completed GRN MUST post the corresponding inventory ledger
  transaction (`specs/06-inventory.md` `INV-001`) — QC-passed
  quantities post as `receipt`; QC-failed quantities post as `damaged`
  or are excluded pending resolution, never silently added to sellable
  stock.
- Barcode/scanning-based receipt is **not required at launch** — manual/
  UI-based entry is acceptable; the architecture MUST NOT block adding
  scanning later.

## Remaining open items

None within this spec's own scope. Credit-note format specifics remain
`UNDER_REVIEW` in `specs/32-india-tax-invoicing.md`.

## Acceptance criteria

See `acceptance/m05-grn.md`.

## Dependencies

Depends on: `specs/04-purchase-orders.md`. Feeds: `specs/06-inventory.md`.
