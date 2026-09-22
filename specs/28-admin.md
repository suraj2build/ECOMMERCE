# 28. Administration

**Status:** DRAFT

## Purpose

Define the internal admin/operations experience: the tools staff use
to manage product, inventory, orders, customers, promotions, and
platform configuration.

## Scope

- Admin application structure (separate app vs. shared codebase with
  route separation — see ADR-0008 and `08-storefront.md`)
- Per-domain admin screens (product management, order management,
  inventory adjustments, customer service tools, promotion management,
  etc.) — each ultimately governed by its own domain spec
- Admin RBAC (depends on `01-auth-rbac.md` role/permission model)
- Audit trail for admin actions (ties into `30-audit-compliance.md`)

## Key architectural constraints (approved)

- Admin experience is separate from the customer storefront "where
  appropriate" (ADR-0008) — exact separation (fully separate app vs.
  shared app with access control) is not yet decided.
- Every admin action that mutates ledger-backed state (inventory,
  loyalty) must go through the same ledger-writing paths as
  customer-facing flows — no direct database edits bypassing the
  ledger (ADR-0012, ADR-0013).

## Open questions — DECISION_REQUIRED

- Separate admin app vs. shared app with role-gated routes — not yet
  decided.
- Full list of admin capabilities required for launch — depends on
  which domains are prioritized in `BUILD_PLAN.md`.
- Manual inventory adjustment workflow (who can adjust stock manually,
  and what justification/audit is required)?

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`ADM-001` through `ADM-003`. See `blueprint/OPERATING_ROLES.md` for
the full candidate persona list (Super Admin, Business Admin, Buyer,
Merchandiser, Catalog Manager, Warehouse Manager, Warehouse Operator,
Customer Service, Marketing, Finance, Analyst) feeding `ADM-001` —
none of these roles are approved yet.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `01-auth-rbac.md` and effectively every other domain spec
(admin surfaces most domains). Feeds: `27-analytics-reporting.md`
(admin-facing dashboards), `30-audit-compliance.md`.
