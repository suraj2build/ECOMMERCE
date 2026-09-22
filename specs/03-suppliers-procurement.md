# 03. Suppliers

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `SUP-001`, `SUP-002`, `PO-001`)

## Purpose

Define the supplier/vendor master data model and supplier relationship
management that underpins procurement (`04-purchase-orders.md`) and
goods receipt (`05-grn.md`).

## Scope

- Supplier master record (identity, contact, terms)
- Supplier-product relationships (which suppliers can supply which
  styles/SKUs, at what cost)
- Supplier onboarding/status lifecycle
- Commercial terms relevant to procurement (payment terms, lead time)
- Finished-goods suppliers AND manufacturing/job-work suppliers

## Approved requirements (2026-09-22)

- The supplier entity MUST accommodate **both** finished-merchandise
  suppliers **and** finished-goods manufacturing/job-work suppliers,
  distinguished by a supplier-type/category field. Both flow through
  the same PO process (`specs/04-purchase-orders.md`).
- Raw-material inventory, Bill of Materials (BOM), cutting/sewing
  production planning, and WIP manufacturing execution are explicitly
  **out of V1 scope** — a manufacturing supplier is procured from as a
  source of *finished garments*, not tracked through a production
  pipeline.
- Supplier hierarchy (agents/sub-vendors) is **not required at
  launch**: a flat supplier list is sufficient, with the schema left
  extensible for hierarchy later without a redesign.
- No supplier self-service portal at launch — all supplier data and
  interaction is internal-only. A future supplier portal is
  **FUTURE_CONSIDERATION**.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m03-suppliers.md`.

## Dependencies

Feeds: `specs/04-purchase-orders.md`, `specs/05-grn.md`.
