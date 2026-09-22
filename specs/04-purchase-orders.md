# 04. Procurement / Purchase Orders

**Status:** IMPLEMENTED (Phase 1 build, 2026-09-22 — was APPROVED, decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `PO-001`–`003`)

## Purpose

Define how purchase orders (POs) are created, approved, and tracked
against suppliers, as the formal record of what inventory is expected
to arrive.

## Scope

- PO creation (style/color/size/SKU, quantities, cost, supplier,
  expected dates)
- PO approval workflow
- PO status lifecycle (draft, submitted, approved, partially received,
  fully received, closed, cancelled)
- Linkage to `05-grn.md` for actual receipt against a PO

## Approved requirements (2026-09-22)

- PO approval workflow is **required**. Value-based approval
  thresholds MUST be supported and MUST be configurable business
  parameters (not hard-coded). Approvers are drawn from the
  Buying/Finance/Business Admin roles per `specs/01-auth-rbac.md`'s
  permission matrix.
- **Partial PO receipt MUST be supported** — a PO can be received in
  more than one GRN event.
- Short/excess delivery tolerance before an exception is flagged MUST
  be a configurable business parameter (see `specs/05-grn.md` `GRN-002`).
- **Purchase cost MUST be captured and maintained** for margin/
  profitability analysis (feeds `specs/27-analytics-reporting.md`).
  Unit cost is captured at minimum; landed-cost components (freight/
  duties/taxes) are captured where available and refined once GST
  input-credit treatment (`specs/32-india-tax-invoicing.md` `TAX-001`)
  is confirmed.
- A PO MUST reference the receiving **location** (`specs/31-organization-locations.md`).
- A PO MUST reference the supplying entity via `specs/03-suppliers-procurement.md`,
  covering both finished-merchandise and manufacturing/job-work
  suppliers uniformly.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m04-purchase-orders.md`.

## Dependencies

Depends on: `specs/03-suppliers-procurement.md`, `specs/02-product-master.md`,
`specs/31-organization-locations.md`. Feeds: `specs/05-grn.md`.
