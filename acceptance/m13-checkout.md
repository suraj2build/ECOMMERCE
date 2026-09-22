# M13 — Checkout Acceptance Criteria

**Spec(s):** `specs/12-checkout.md`
**Status:** READY_FOR_IMPLEMENTATION*

\* Engineering build only — final GST computation correctness is a
separate production go-live gate pending `specs/32-india-tax-invoicing.md`.

## Business acceptance

- [ ] A customer can complete checkout **without creating an
      account** — no step in the guest path requires authentication.
- [ ] PIN-code serviceability is re-validated at checkout before order
      placement.
- [ ] Reservation begins at checkout start (per `acceptance/m06-inventory.md`).

## Functional acceptance

- [ ] Checkout steps: address, shipping method, review, payment
      handoff.
- [ ] Address form uses the Indian address structure with PIN-based
      auto-complete where available.
- [ ] Shipping cost computes correctly per the configured rule (flat/
      weight-based/free-shipping-threshold).
- [ ] Tax computes via the configurable engine (`acceptance/m08-tax-invoicing-foundation.md`),
      displayed tax-inclusive.

## Negative scenarios / edge cases

1. Non-serviceable PIN code at checkout (even if it was serviceable
   earlier at PDP) → blocked with clear messaging before payment.
2. Cart contents change (price/stock) between cart review and checkout
   submission → re-validated, customer informed.
3. Double-submission of the checkout form (e.g., double-click on a slow
   connection) → does not create two orders or two payment attempts.

## Mobile / Desktop behavior

- [ ] Full checkout flow completes correctly on both mobile and
      desktop viewports, including address entry and payment handoff.

## API behavior

- [ ] Checkout submission is idempotent per client-generated request
      ID.

## Security

- [ ] All checkout data in transit is over TLS; no sensitive payment
      data touches the platform's own servers directly (hosted flow,
      `acceptance/m14-payment.md`).

## Performance expectations

- [ ] Checkout API responses meet the `NFR-001` p95 target.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 3 (prepaid) and
      FLOW 4 (COD).
- [ ] Idempotency test: duplicate checkout submission produces exactly
      one order.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
