# 30. Audit / Compliance

**Status:** UNDER_REVIEW (audit-logging requirements DECIDED
2026-09-22; regulatory-requirement identification `AUD-002` remains
`UNDER_REVIEW` pending legal input — see `blueprint/DECISION_REGISTER.md`)

**Cross-cutting domain.**

## Purpose

Define platform-wide audit trail requirements and regulatory/
compliance posture.

## Scope

- Audit logging for ledger-backed domains and admin actions
- Financial reconciliation support
- Data retention and deletion policy
- Regulatory compliance requirements

## Approved requirements (2026-09-22)

- **Full auditability is required** for: inventory, pricing, orders,
  refunds, store credit, loyalty, promotions, permissions, and product
  publishing (explicit, §26).
- Every audited change MUST record: **who, what, when, old value, new
  value, reference/context.**
- Audit log access is restricted to Super Admin, Business Admin, and
  Finance by default, extendable per `specs/01-auth-rbac.md`'s
  permission matrix.
- Audit logging MUST be satisfied by querying the inventory and
  loyalty/store-credit ledgers (ADR-0012, ADR-0013), not a parallel
  logging system that could drift from them.

## Remaining open items — UNDER_REVIEW

- **`AUD-002` — Regulatory/compliance requirement identification.**
  What data-protection, consumer-protection, and financial-record-
  retention regulations apply to this platform's target market is
  **explicitly not resolved here** — the Product Owner instruction
  requires this be routed to legal verification, not invented (§28).
  Tracked jointly with `specs/21-customer-profile.md` `CUST-001`. Does
  not block M00/M01, or the audit-logging *mechanism* itself (which is
  fully decided above) — it governs retention-period specifics layered
  on top once confirmed.

## Acceptance criteria

See `acceptance/m29-admin-cms.md` for the audit-logging mechanism's
acceptance criteria (decided, testable now). Regulatory-retention-
specific criteria are deferred pending `AUD-002`.

## Dependencies

Depends on: `specs/06-inventory.md`, `specs/22-loyalty.md`,
`specs/33-store-credit-gift-cards.md`, `specs/28-admin.md`,
`specs/21-customer-profile.md`.
