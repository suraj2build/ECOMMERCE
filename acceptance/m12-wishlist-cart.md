# M12 — Wishlist / Cart Acceptance Criteria

**Spec(s):** `specs/11-wishlist-cart.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Adding an item to cart **never** creates an inventory reservation
      — verified by checking the inventory ledger shows no
      `reservation` transaction until checkout begins.
- [ ] A guest cart persists across the configured duration and merges
      correctly into the account cart on login.

## Functional acceptance

- [ ] Cart supports add/remove/update-quantity; per-SKU quantity limit
      enforced when configured.
- [ ] Wishlist supports save/remove/move-to-cart.
- [ ] Cart re-validates price and availability before allowing checkout
      to proceed, surfacing any change to the customer clearly.

## Negative scenarios / edge cases

1. An item in cart goes out of stock before checkout → customer is
   informed at cart review, not silently allowed to proceed and fail
   later.
2. An item's price changes while in cart → the new price is shown
   before checkout, not silently charged.
3. Attempt to add beyond the per-SKU quantity limit → blocked with a
   clear message.

## Mobile / Desktop behavior

- [ ] Cart line-item controls (quantity adjust, remove) are usable at
      touch scale on mobile.

## API / Database behavior

- [ ] Guest cart is identified by a device/session identifier, not
      requiring any account creation.

## Test requirements

- [ ] Integration tests: guest-cart-to-account merge on login.
- [ ] E2E: add-to-cart → verify no reservation created → proceed to
      checkout → reservation created at that point (boundary test).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
