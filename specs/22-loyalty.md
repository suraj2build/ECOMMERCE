# 22. Loyalty

**Status:** DRAFT

## Purpose

Define the loyalty program: how customers earn, redeem, and lose
loyalty value, backed by an auditable ledger.

## Scope

- Ledger transaction types: earn, redeem, reverse, expire, adjust
  (ADR-0013)
- Earn rules (e.g., points per order value) — business-owned, not yet
  defined
- Redemption rules (e.g., points-to-discount conversion, minimum
  redemption) — not yet defined
- Expiry policy — not yet defined
- Reversal triggers (cancellation, return — see `17-cancellation.md`,
  `18-returns.md`)

## Key architectural constraints (approved — binding, see ADR-0013)

- Loyalty **must** be modeled as an auditable transaction/ledger. A
  mutable "points balance" field as sole source of truth is explicitly
  disallowed.
- Every operation affecting a customer's loyalty standing must write a
  ledger entry.

## Open questions — DECISION_REQUIRED

- **The entire business rule set is undefined**: earn rate, redemption
  mechanics, tiering (if any), expiry period, and whether loyalty is a
  points system, cashback/credit system, or tiered-benefits system.
  This is explicitly called out as not frozen in `PRODUCT.md` §2.C.
- Does loyalty interact with promotions (`23-promotions.md`) — can
  loyalty redemption stack with promotional discounts?
- Loyalty program launch timing relative to other milestones — is this
  needed for initial launch or a post-launch addition?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. This is one of the
domains explicitly flagged in the founding brief as having no frozen
business rules; do not implement any earn/redeem logic until a
concrete rule set is approved.

## Dependencies

Depends on: `14-order-management.md`, `17-cancellation.md`,
`18-returns.md`. Feeds: `21-customer-profile.md`,
`27-analytics-reporting.md`.
