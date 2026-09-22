# 22. Loyalty

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `LOY-001`–`005`)

## Purpose

Define the loyalty program: how customers earn, redeem, and lose
loyalty value, backed by an auditable ledger.

## Scope

- Ledger transaction types: earn, redeem, reverse, expire, adjust
- Earn/redemption/expiry rules
- Interaction with store credit and promotions

## Approved requirements (2026-09-22)

- **Loyalty IS required. Model: POINTS + TIERS.**
- Loyalty is kept **conceptually and structurally separate** from
  store credit/cashback value and from promotions/coupons — these are
  **four distinct concepts** (loyalty points, tier/status, store
  credit/cashback, promotions/coupons), never collapsed into one data
  structure.
- Loyalty **MUST** use an auditable ledger supporting: earn, redeem,
  reverse, expire, and manual adjustment (per ADR-0013).
- **Points are earned based on qualifying purchase value.** Exact
  earning rate is a **configurable business parameter** — no fixed
  commercial percentage is set by this spec.
- **Points may be redeemed on future purchases.** Exact conversion
  rate, minimum redemption, and per-order maximum cap are configurable
  business parameters.
- **Points expire; the expiry period MUST be configurable.** This
  contrasts explicitly with store credit, which does **not** expire
  (`specs/33-store-credit-gift-cards.md`).
- Loyalty redemption MAY combine with store credit and coupon/
  promotions on the same order, **subject to configurable eligibility/
  stacking rules** (`specs/23-promotions.md` `PROMO-002`) — the
  combination is rule-driven, not unconditional.
- Any loyalty points earned on an order MUST be reversed via a ledger
  entry if that order is later cancelled or returned
  (`specs/17-cancellation.md`, `specs/18-returns.md`).

## Remaining open items

None. Exact earn/redemption/expiry *rates* remain intentionally
configurable business parameters, not open decisions blocking build.

## Acceptance criteria

See `acceptance/m23-loyalty.md`. See `acceptance/e2e-commerce-flows.md`
FLOW 17 (earn/redeem/reverse/expire).

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/17-cancellation.md`,
`specs/18-returns.md`. Feeds: `specs/21-customer-profile.md`,
`specs/27-analytics-reporting.md`.
