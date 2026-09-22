# 04. Procurement / Purchase Orders

**Status:** DRAFT

## Purpose

Define how purchase orders (POs) are created, approved, and tracked
against suppliers, as the formal record of what inventory is expected
to arrive.

## Scope

- PO creation (style/color/size/SKU, quantities, cost, supplier, expected
  dates)
- PO approval workflow
- PO status lifecycle (draft, submitted, approved, partially received,
  fully received, closed, cancelled)
- Linkage to `05-grn.md` for actual receipt against a PO

## Key architectural constraints (approved)

- PO receipt must ultimately produce ledger entries in the inventory
  system (`ARCHITECTURE.md` §5, ADR-0012) — a PO itself is a
  commitment/expectation record, not an inventory-affecting event
  until goods are actually received via GRN.

## Open questions — DECISION_REQUIRED

- PO approval hierarchy — who can approve, are there value-based
  approval thresholds?
- Partial receipt and over/under-delivery tolerance rules?
- PO amendment rules after submission/approval?
- Costing basis captured on the PO (landed cost vs. unit cost vs.
  taxes/duties) — not yet defined, affects `specs/07-catalog-merchandising.md`
  pricing inputs.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `03-suppliers-procurement.md`, `02-product-master.md`.
Feeds: `05-grn.md`.
