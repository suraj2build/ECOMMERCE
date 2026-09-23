# M12 — Wishlist / Cart Acceptance Criteria

**Spec(s):** `specs/11-wishlist-cart.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23,
`services/commerce-api/src/modules/cart/`, `apps/storefront/src/app/
{bag,wishlist}/`, 12 passing backend integration tests + 4 passing
browser E2E tests against a real Chromium instance).

## Business acceptance

- [x] Adding an item to cart **never** creates an inventory reservation
      — `CartService` has no dependency on `InventoryService`'s
      mutating methods at all, only read-only `InventoryBalance`
      queries for informational display (mirroring `PdpService`'s own
      M11 live-availability read). Verified by an integration test
      that adds an item then asserts zero `InventoryReservation` rows
      and zero `RESERVATION` ledger transactions, and by a browser E2E
      test that does the same through the real UI.
- [x] A guest cart persists across the configured duration
      (`CART_GUEST_TTL_DAYS`, default 30) and merges correctly into
      the account cart on login - verified end-to-end in a real
      browser: add to bag as a guest, log in via the existing OTP flow
      (M11), confirm the guest item is now in the account cart with
      quantities summed (capped at `CART_MAX_QUANTITY_PER_SKU`) and
      the guest cart is gone, not duplicated.

## Functional acceptance

- [x] Cart supports add/remove/update-quantity; the configurable
      per-SKU quantity limit (`CART_MAX_QUANTITY_PER_SKU`, default 10)
      is enforced with a clear rejection message on both add and
      update.
- [x] Wishlist supports save/remove/move-to-cart - move-to-cart adds
      the item to the cart (through the same `CartService.addItem`
      path, so it's subject to the same quantity-limit/availability
      rules) and removes it from the wishlist only on success.
- [x] Cart re-validates price and availability on every read
      (`GET /storefront/cart` recomputes `currentPrice` and
      `availableQuantity` live against Price/InventoryBalance, never
      trusting the stored `priceAtAdd` snapshot) and surfaces
      `priceChanged` / `inStock` / `isPurchasable` flags plus an
      overall `hasBlockingChanges` flag the storefront uses to block
      the (not-yet-built, M13) checkout button and show a clear inline
      warning.

## Negative scenarios / edge cases

1. [x] An item in cart goes out of stock before checkout → the cart
   page shows "Only N left" (or "no longer available" if fully
   unpublished) inline on that line item and sets
   `hasBlockingChanges`, never silently allowed through - covered by
   both an integration test and manual verification.
2. [x] An item's price changes while in cart → the cart page shows
   both the original `priceAtAdd` and the new `currentPrice` with a
   "Price changed since you added this item" message, never silently
   charging the new price (there's no charging yet at all - M13's
   scope - but the display discipline is real and tested).
3. [x] Attempt to add beyond the per-SKU quantity limit → blocked with
   `400` and a clear message naming the limit and the current quantity
   already in the cart - integration test covers this exactly.

## Mobile / Desktop behavior

- [x] Cart line-item controls (quantity `<select>`, Remove button) and
      wishlist controls (Move to Bag, Remove) all meet the 44px
      minimum touch target - verified with a real browser bounding-box
      measurement in the mobile E2E test, not just class-name
      inspection (a min-height utility class silently losing to
      another className on the same CSS property, the same
      button-variant pitfall documented in `components/ui/Button.tsx`,
      was caught and fixed this way during this milestone).
- [x] Both pages render at a 390px mobile viewport with no horizontal
      overflow.

## API / Database behavior

- [x] Guest cart/wishlist is identified by a client-generated
      device/session identifier (`x-guest-session-id` header, a UUID
      persisted in `localStorage`), never requiring account creation.
      Server-side, `Cart`/`Wishlist` each carry a hand-written CHECK
      constraint enforcing exactly one of `customerId`/`guestSessionId`
      is set (never both, never neither) - defense in depth beyond the
      identity-resolution code, mirroring the M08/M11 CHECK-constraint
      pattern.

## Test requirements

- [x] Integration tests (12, `test/integration/cart-wishlist.test.ts`):
      never-reserves-on-add (INV-002), full add/read/update/remove
      cycle, missing-identity rejection (400), per-SKU quantity limit,
      price-change flagging, out-of-stock flagging, guest-vs-guest and
      guest-vs-customer isolation, guest→account merge for both cart
      (quantity summing + cap) and wishlist (dedup, not duplication),
      404 on an unknown SKU.
- [x] E2E (4, `test/e2e-storefront/cart-wishlist.spec.ts`, real
      Chromium, project "storefront"): add-to-bag from the PDP with a
      real-browser proof of zero reservations created, cart quantity
      update and removal on `/bag`; save-to-wishlist from the PDP and
      move-to-bag from `/wishlist`; mobile no-overflow + 44px
      touch-target verification for both pages; zero critical/serious
      automated accessibility violations (axe-core, same
      `wcag2a`+`wcag2aa` tags as every earlier milestone's scan). Also
      updated the existing M11 `pdp.spec.ts` desktop test, since
      Add-to-Bag is genuinely wired to the cart now instead of showing
      the M11-era "coming soon" placeholder text.

## Infrastructure fix (found via real-browser verification, not a
## pre-existing bug report)

- [x] Both new E2E specs originally used an external
      `https://placehold.co/...` URL for test product imagery (the
      same convention M11's `pdp.spec.ts` had already established).
      A broken/blocked external image element was observed to
      intercept pointer events and cause click timeouts on unrelated
      buttons elsewhere on the page in one full local verification
      pass - a real E2E-robustness issue (an external network
      dependency inside a test fixture) independent of any specific
      environment's network policy. Fixed by adding a tiny same-origin
      static fixture image (`apps/storefront/public/e2e-fixture.png`)
      and switching both `pdp.spec.ts` and `cart-wishlist.spec.ts` to
      reference it via `STOREFRONT_BASE_URL` instead of a third-party
      host - removes an external network dependency from the suite
      entirely, which is a correctness improvement for CI too, not
      just a local workaround.

## Definition of Done

All boxes above checked. Checkout itself (re-validating the cart one
last time and actually reserving inventory) is honestly M13's own
milestone and not built here - the cart's `hasBlockingChanges` flag
and the disabled "Checkout" button on `/bag` are the seam M13 will
build on, matching the same PDP/Cart-dependency honesty discipline
M09 and M11 used for their own not-yet-built dependencies.
