# 11. Wishlist / Cart

**Status:** DRAFT

## Purpose

Define wishlist (saved-for-later) and shopping cart behavior, up to
but not including checkout.

## Scope

- Cart: add/remove/update line items, quantity limits, persistence
  (guest vs. logged-in), price/availability re-validation
- Wishlist: save/remove items, guest vs. logged-in persistence,
  move-to-cart
- Cart-level promotion display (interaction with `23-promotions.md`)
- Inventory reservation timing — does adding to cart reserve stock, or
  only checkout? (see `06-inventory.md` open questions)

## Key architectural constraints (approved)

None beyond the general storefront/inventory baseline. This domain's
interaction with the inventory reservation model (whether cart itself
reserves stock) must be resolved consistently with `06-inventory.md`.

## Open questions — DECISION_REQUIRED

- Does adding an item to cart create an inventory reservation, or does
  reservation only happen at checkout start? This materially affects
  the inventory ledger design and is currently unresolved.
- Guest cart/wishlist persistence duration and merge-on-login behavior?
- Cart quantity limits per SKU — business-owned, not yet defined.
- Wishlist sharing (e.g., shareable wishlist link) — in scope or
  future?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `10-pdp.md`, `06-inventory.md`, `07-catalog-merchandising.md`
(pricing). Feeds: `12-checkout.md`.
