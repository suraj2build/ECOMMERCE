# M03 — Suppliers Acceptance Criteria

**Spec(s):** `specs/03-suppliers-procurement.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] A supplier record supports both a "finished-merchandise" type and
      a "manufacturing/job-work" type via a distinguishing field, both
      usable identically by the PO process.
- [ ] No raw-material inventory, BOM, or production-execution tracking
      exists in this milestone (explicitly out of scope).

## Functional acceptance

- [ ] Supplier CRUD: identity, contact, commercial terms
      (payment terms, lead time).
- [ ] Supplier-product relationship: which suppliers can supply which
      styles/SKUs, at what cost.
- [ ] Supplier status lifecycle (e.g., active/inactive/onboarding).

## Authorization

- [ ] Only Buying and above (per RBAC matrix) can create/edit supplier
      records.

## Auditability

- [ ] Supplier commercial-term changes (payment terms, lead time) are
      audited.

## Positive scenarios

1. Create a manufacturing-type supplier and a finished-merchandise-type
   supplier; both are selectable when creating a PO in
   `acceptance/m04-purchase-orders.md`.

## Negative scenarios / edge cases

1. Attempt to deactivate a supplier with open POs → warned or blocked
   (defined, not silently allowed to create a dangling reference).

## API / Database behavior

- [ ] Supplier schema is extensible to a future hierarchy (parent/
      sub-vendor) without a breaking migration, even though flat-list
      is sufficient now.

## Security

- [ ] Supplier data is internal-only — no external-facing endpoint
      exists in this milestone (no supplier portal, per `SUP-002`).

## Test requirements

- [ ] Unit tests: supplier-type validation.
- [ ] Integration tests: supplier-product relationship queries used by
      PO creation.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
