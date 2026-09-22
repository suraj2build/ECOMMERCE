# 18. Returns

**Status:** DRAFT

## Purpose

Define the post-delivery return process: eligibility, initiation,
pickup/drop-off logistics, quality inspection of returned goods, and
disposition (restock, damage, dispose).

## Scope

- Return eligibility rules (time window, category exclusions,
  condition requirements)
- Return initiation (customer self-service and/or customer service)
- Reverse logistics (pickup/drop-off) — may depend on
  `16-shipping-tracking.md` carrier integration
- Quality inspection of returned goods on arrival (mirrors
  `05-grn.md` inspection concept, but for returns)
- Disposition: restock as sellable, restock as damaged/clearance, or
  dispose — each must produce the correct inventory ledger entry
  (ADR-0012)
- Handoff to `19-refunds.md` once a return is accepted

## Key architectural constraints (approved)

- Every return disposition outcome must post the correct inventory
  ledger entry — a return is not "done" from an inventory perspective
  until the ledger reflects where the stock actually ended up
  (ADR-0012).

## Open questions — DECISION_REQUIRED

- Return window length and category-specific exclusions (e.g.,
  innerwear, altered items) — business-owned, not yet defined.
- Return condition inspection criteria — not yet defined.
- Is exchange (`20-exchanges.md`) a variant of return+reorder, or a
  distinct flow? Not yet decided — affects both specs' data models.
- Self-service vs. assisted return initiation — not yet decided.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `14-order-management.md`, `16-shipping-tracking.md`,
`06-inventory.md`. Feeds: `19-refunds.md`, `20-exchanges.md`.
