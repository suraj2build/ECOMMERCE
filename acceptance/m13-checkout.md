# M13 — Checkout Acceptance Criteria

**Spec(s):** `specs/12-checkout.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23,
`services/commerce-api/src/modules/checkout/`, `apps/storefront/src/app/
checkout/`, 15 passing backend integration tests + 1 passing browser E2E
test against a real Chromium instance).

\* Engineering build only — final GST computation correctness is a
separate production go-live gate pending `specs/32-india-tax-invoicing.md`.

## Scope note (read before the checkboxes below)

Checkout produces a `CheckoutSession` - the "order creation trigger"
artifact - not the formal `Order`/order-management model, which is
**M15's own milestone** to create (see the schema comment on
`CheckoutSession` and `InvoiceService`'s pre-existing docblock, both
written during M08/M12). Depends only on the `PaymentProvider`
interface (ADR-0011), never a specific provider directly:
- **COD genuinely completes within this milestone** - no external
  gateway is needed, so `CheckoutSession.status` reaches `CONFIRMED`
  and `Payment.status` reaches `CONFIRMED` for real.
- **Prepaid honestly does not** - `PaymentProvider.initiate()` for
  Razorpay returns `UNAVAILABLE` with a clear "coming soon" message;
  the session is created and inventory is genuinely reserved
  (`RESERVED`/`INITIATED`), but completing online payment is M14's own
  scope, matching the same PDP/Cart-dependency honesty M09/M11/M12 used
  for their own not-yet-built dependencies.
- Invoice generation is likewise **not** triggered here, for the same
  reason `InvoiceService`'s own docblock gives: it's called at "order
  confirmation... once the Order model exists" (M15).

## Business acceptance

- [x] A customer can complete checkout **without creating an
      account** — verified end-to-end (integration + browser E2E): a
      genuine guest, identified only by the client-generated
      `x-guest-session-id` header, completes a COD order with no login
      step anywhere in the flow.
- [x] PIN-code serviceability is re-validated at checkout before order
      placement — re-checked against the same `ServiceablePincode`
      table PDP (M11) uses, even if a different/stale PIN was checked
      earlier.
- [x] Reservation begins at checkout submission, never at add-to-cart —
      verified by asserting zero `InventoryReservation` rows exist
      after add-to-cart and exactly one exists (status `ACTIVE`) after
      checkout submission, both at the integration-test and real-browser
      level.

## Functional acceptance

- [x] Checkout steps: address, shipping method, review, payment
      handoff — collapsed onto one page with a live review sidebar (an
      engineering-default UX choice, not a spec requirement) rather
      than a multi-step wizard; a separate `POST /checkout/preview`
      endpoint computes shipping/tax for review without reserving
      anything, so browsing the form never has a side effect.
- [x] Address form uses the Indian address structure (house/flat,
      locality, landmark, city, state, PIN code) with a state dropdown;
      full PIN-to-city/state auto-complete is not implemented (no
      third-party PIN lookup service integrated) — city is entered
      manually, consistent with not inventing an external dependency
      beyond this milestone's scope.
- [x] Shipping cost computes via the configurable rule engine
      (`ShippingRule` - flat rate and free-above-threshold, admin-
      configurable via `shipping:manage`, `POST /checkout/shipping-rule`);
      weight/value-based rules are explicitly deferred - no
      product-weight data model exists yet.
- [x] Tax computes via the M08 tax engine (`splitTax`/
      `determinePlaceOfSupply`, reused directly, never reimplemented),
      displayed tax-inclusive per CAT-001.

## Negative scenarios / edge cases

1. [x] Non-serviceable PIN code at checkout (even if serviceable
   earlier at PDP) → blocked with clear messaging before payment/order
   creation, zero reservations made.
2. [x] Cart contents change (price/stock) between cart review and
   checkout submission → re-validated via the same `CartService` used
   by `/bag`; a stale/out-of-stock/no-longer-purchasable cart blocks
   checkout with a clear message rather than silently proceeding.
3. [x] Double-submission of the checkout form (e.g. a slow-connection
   double-click) → does not create two orders. A genuine concurrent-
   request test proves this: two identical submissions with the same
   client-generated idempotency key return the *same* session and
   result in exactly one `CheckoutSession` row and one reservation.
4. [x] (Beyond the spec's own list, found during this milestone)
   Fragmented stock across multiple locations that passes the cart's
   aggregate-availability check but has no single location able to
   fulfil a line → blocked with a clean `409`, and any other line's
   reservation already made in the same attempt is rolled back
   (all-or-nothing, never a partial reservation).

## Mobile / Desktop behavior

- [ ] Full checkout flow on a mobile viewport — not yet covered by an
      automated E2E check (only desktop is E2E-tested); the form itself
      reuses the same touch-scale (44px) input/control conventions as
      every other milestone's pages, but this is not yet independently
      verified end-to-end on mobile. Tracked here, not silently
      dropped.

## API behavior

- [x] Checkout submission is idempotent per client-generated request ID
      (`idempotencyKey`) — covered above (negative scenario #3) and by
      a dedicated integration test.

## Security

- [x] All checkout data in transit is over TLS in any real deployment
      (platform-level, not code in this milestone). No payment data
      (card numbers, etc.) is collected or stored anywhere in this
      codebase — COD needs none, and the prepaid path collects nothing
      beyond an amount before handing off (M14's own scope covers the
      actual hosted/tokenized Razorpay flow).

## Performance expectations

- [ ] Checkout API responses meet the `NFR-001` p95 target — **not yet
      measured**, same reasoning as every earlier milestone's deferred
      performance measurement (no representative production data/scale
      exists in any environment this was built in); deferred to the
      Phase 2 end-to-end certification round.

## Test requirements

- [x] Integration tests (15, `test/integration/checkout.test.ts`):
      preview computation, COD full completion (reservation + CONFIRMED
      status), COD unavailable-for-PIN rejection, COD order-value-cap
      rejection, prepaid honest handoff, PIN re-validation, cart
      re-validation, all-or-nothing rollback (both the cart-level and
      the fragmented-stock/reservation-level paths), idempotent
      double-submission, guest completion with no account, cross-
      identity read isolation, shipping-rule admin configuration +
      RBAC.
- [x] E2E (1, `test/e2e-storefront/checkout.spec.ts`, real Chromium,
      project "storefront"): the full COD path end to end through a
      real browser - PDP → Bag → Checkout form → Place Order →
      Confirmation page - with a real-browser proof that zero
      reservations exist before checkout submission and exactly one
      `ACTIVE` reservation exists after. The prepaid path is not
      separately E2E-tested in a browser (covered at the integration
      level only) since it has no real completion to demonstrate yet.
- [x] Idempotency test: duplicate checkout submission produces exactly
      one session/reservation (see negative scenario #3).

## Infrastructure / correctness fixes (found via this milestone's own
## adversarial testing, not pre-existing bug reports)

- [x] **`InventoryService.reserve()` (M06) had a genuine concurrency
      gap**: two callers submitting the exact same idempotency key at
      the same time could both pass the existence check before either
      committed, and the loser hit a raw, unmapped `P2002` unique-
      constraint error on insert (an opaque `500`, not the idempotent
      "return the existing reservation" behavior the function's own
      comment already promised). Found by this milestone's own genuine-
      concurrency double-submission test — the identical bug class
      `startCheckout()` itself would have had, and was written
      defensively against, for `CheckoutSession.idempotencyKey`.
      Fixed by catching the race in `reserve()` and returning the
      winning reservation, exactly like `startCheckout()`'s own
      idempotency-key race handling. Full M06 concurrency/adversarial
      suite (17 tests) re-verified green after the fix - no regression.

## Definition of Done

All boxes above checked except mobile E2E coverage and NFR-001
performance measurement, both explicitly and consistently deferred
(matching every earlier milestone's own honest deferrals) to the
Phase 2 end-to-end certification round - tracked here, not silently
dropped.
