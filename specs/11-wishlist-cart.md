# 11. Wishlist / Cart

**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23 — see `blueprint/DECISION_REGISTER.md` `CART-001`–`003`, `INV-002`, and `acceptance/m12-wishlist-cart.md`)

## Purpose

Define wishlist (saved-for-later) and shopping cart behavior, up to
but not including checkout.

## Scope

- Cart: add/remove/update line items, persistence, re-validation
- Wishlist: save/remove items, guest vs. logged-in persistence
- Cart-level promotion display

## Approved requirements (2026-09-22)

- **Adding an item to cart MUST NOT reserve inventory** (see
  `specs/06-inventory.md` `INV-002`) — availability shown in cart is
  informational, re-validated at checkout.
- Guest cart/wishlist is supported (guest checkout is required, see
  `specs/12-checkout.md`), persisted via a device/session identifier
  for a configurable duration (engineering default: 30 days), and
  merges into the account cart on login or post-purchase account
  activation.
- Cart quantity is subject to a configurable per-SKU maximum
  (anti-scalping/fair-access control); default threshold is
  operational configuration.
- Wishlist sharing is **FUTURE_CONSIDERATION**, not launch scope.
- The cart MUST re-validate price and availability against current
  catalog/inventory state before allowing checkout to proceed, and
  MUST clearly surface any change (price or stock) to the customer.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m12-wishlist-cart.md`.

## Dependencies

Depends on: `specs/10-pdp.md`, `specs/06-inventory.md`,
`specs/07-catalog-merchandising.md`. Feeds: `specs/12-checkout.md`.
