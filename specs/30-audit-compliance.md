# 30. Audit / Compliance

**Status:** DRAFT

**Cross-cutting domain** — feeds and is fed by multiple milestones
(inventory, orders, payments, loyalty, admin actions, customer data).

## Purpose

Define platform-wide audit trail requirements and regulatory/
compliance posture — what must be logged, retained, and reportable for
financial, operational, and legal accountability.

## Scope

- Audit logging for ledger-backed domains (inventory — ADR-0012;
  loyalty — ADR-0013) and admin actions (`28-admin.md`)
- Financial reconciliation support (orders, payments, refunds against
  the inventory and loyalty ledgers)
- Data retention and deletion policy (interacts with
  `21-customer-profile.md` open question on account deletion)
- Regulatory compliance requirements for the target market(s) — not
  yet identified

## Key architectural constraints (approved)

- The inventory and loyalty ledger principles (ADR-0012, ADR-0013)
  exist specifically to make this domain possible — audit/compliance
  requirements should be satisfied by querying the ledgers, not by
  building a parallel logging system that could drift from them.

## Open questions — DECISION_REQUIRED

- Target market's specific regulatory/compliance requirements (data
  protection law, financial record retention requirements, consumer
  protection rules for returns/refunds) — not yet identified; needs
  product-owner/legal input.
- Data retention periods per data category — not yet defined.
- Who has access to audit logs, and what admin RBAC role governs that
  (`01-auth-rbac.md`, `28-admin.md`)?

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`AUD-001`, `AUD-002`. `AUD-002` requires legal input before it can be
treated as decided — see `blueprint/INDIA_COMMERCE_GAPS.md`.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `06-inventory.md`, `22-loyalty.md`, `28-admin.md`,
`21-customer-profile.md`. This spec's requirements should also inform
`SECURITY.md` as compliance requirements become concrete.
