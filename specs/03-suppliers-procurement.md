# 03. Suppliers

**Status:** DRAFT

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

## Key architectural constraints (approved)

None beyond the general platform baseline (`ARCHITECTURE.md`). This
domain has no dedicated ADR yet — if a significant supplier-management
architectural decision is needed, record it as a new ADR.

## Open questions — DECISION_REQUIRED

- Is supplier management single-entity or does it need to support
  supplier hierarchies (e.g., agents/sub-vendors)?
- What supplier performance/quality tracking is required (ties into
  `05-grn.md` quality/exceptions)?
- Multi-currency / multi-region supplier terms — in scope for initial
  build or future?
- Supplier-facing portal/access — is this required, or is supplier
  data internal-only initially?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Feeds: `04-purchase-orders.md`, `05-grn.md`.
