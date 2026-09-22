# 12. Checkout

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `CHK-001`–`004`, `IND-002`, `IND-003`, `IND-005`)

## Purpose

Define the checkout flow: address collection, shipping method
selection, order review, and handoff to payment, culminating in order
creation.

## Scope

- Checkout steps (address, shipping method, review)
- Inventory reservation at checkout
- Guest checkout
- Order creation trigger
- Handoff to payment

## Approved requirements (2026-09-22)

- **Guest checkout is REQUIRED and MUST be genuinely guest** — account
  creation MUST NOT be forced before purchase. Logged-in checkout is
  also supported.
- Checkout triggers the **short-lived inventory reservation**
  (`specs/06-inventory.md` `INV-002`) — reservation begins here, not at
  add-to-cart.
- **PIN-code serviceability MUST be re-validated at checkout** before
  order placement (in addition to the PDP-level check, `specs/10-pdp.md`),
  against carrier API data where available with a static-list fallback.
- Address fields follow the standard Indian address structure (house/
  flat, locality, landmark, city, state, PIN code), with PIN-to-city/
  state auto-complete where feasible.
- Shipping cost is computed by a configurable rule engine (flat,
  weight/value-based, or free-shipping-threshold based); a
  configurable free-shipping threshold is supported.
- Tax is computed by a **pluggable, configurable, HSN-rate-based tax
  engine**, displaying tax-inclusive pricing per `specs/07-catalog-merchandising.md`.
  Legal correctness of the exact GST rate/registration logic depends on
  `specs/32-india-tax-invoicing.md`'s compliance verification and does
  not block building the engine itself.
- Checkout logic MUST depend only on the payment provider abstraction
  (`specs/13-payment.md`, ADR-0011) — never a specific provider's API
  directly.

## Remaining open items

Final GST computation correctness (`TAX-001`–`003`) remains
`UNDER_REVIEW` in `specs/32-india-tax-invoicing.md` — a production
go-live gate, not a development blocker (the engine is built
configurable specifically so this doesn't block building).

## Acceptance criteria

See `acceptance/m13-checkout.md`.

## Dependencies

Depends on: `specs/11-wishlist-cart.md`, `specs/06-inventory.md`.
Feeds: `specs/13-payment.md`, `specs/14-order-management.md`.
