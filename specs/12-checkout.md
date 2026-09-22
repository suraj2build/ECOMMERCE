# 12. Checkout

**Status:** DRAFT

## Purpose

Define the checkout flow: address collection, shipping method
selection, order review, and handoff to payment, culminating in order
creation.

## Scope

- Checkout steps (address, shipping method, review)
- Inventory reservation at checkout (see open question in
  `11-wishlist-cart.md` and `06-inventory.md`)
- Guest checkout vs. account-required
- Order creation trigger (handoff to `14-order-management.md`)
- Handoff to payment (`13-payment.md`)

## Key architectural constraints (approved)

- Checkout logic must depend only on the payment provider abstraction
  (ADR-0011), never a specific provider's API directly.
- Any inventory reservation made during checkout must be a ledger
  transaction (ADR-0012), with defined release semantics on
  abandonment/failure.

## Open questions — DECISION_REQUIRED

- Is guest checkout supported, or account required? Not yet decided.
- Exact reservation timing and timeout during checkout (see
  `06-inventory.md`).
- Address validation requirements (e.g., serviceability check against
  shipping/warehouse coverage) — depends on `15-warehouse-fulfilment.md`
  / `16-shipping-tracking.md`, not yet defined.
- Shipping cost calculation rules — business-owned, not yet defined.
- Tax calculation approach — not yet decided (jurisdiction rules
  unresolved, see `PRODUCT.md` §4).

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `11-wishlist-cart.md`, `06-inventory.md`. Feeds:
`13-payment.md`, `14-order-management.md`.
