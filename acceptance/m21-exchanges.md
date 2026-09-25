# M21 — Exchanges Acceptance Criteria

**Spec(s):** `specs/20-exchanges.md`
**Status:** M21 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `EXC-004`. Not self-declared
`VERIFIED`; independent review pending.

## Business acceptance

- [x] Both size exchange and colour exchange are supported —
      `exchanges.test.ts` tests "completes a same-price size exchange"
      and "supports colour exchange"; the storefront UI offers both
      (every in-stock variant of the style, colour AND size, via the
      existing PDP product-detail endpoint), not just the API.
- [x] Replacement SKU availability is checked and reserved at exchange-
      request time (using the same reservation mechanics as checkout -
      `InventoryService.reserve`, `INV-002`) — `exchanges.test.ts` test
      "completes a same-price size exchange" (reservation created) and
      "rejects initiation immediately when the replacement SKU is out
      of stock".
- [x] Replacement costing more → customer pays the difference via an
      online payment flow (`exchanges.test.ts` CUSTOMER_PAYS tests).
      Replacement costing less → difference issued as store credit
      (`exchanges.test.ts` "issues store credit for the price
      difference").

## Functional acceptance

- [x] Exchange is modeled as a first-class entity — a single
      `Exchange` record links the original order/item, the replacement
      SKU, and any payment/credit settlement, queryable as one
      coherent operation (not reconstructed by joining a return and an
      unrelated new order) — see `EXC-004` in
      `blueprint/DECISION_REGISTER.md`.
- [x] Exchange inventory effects post as two explicit ledger
      transactions (release original + reserve/allocate replacement) —
      `exchanges.test.ts` test "completes a same-price size exchange"
      asserts both `RETURN_RECEIVED`/`RETURN_QC_PASS` (original) and
      `RESERVATION`/`ALLOCATION` (replacement) rows exist.

## Negative scenarios / edge cases

1. [x] Requested replacement SKU is out of stock at request time →
   clearly communicated (409 `InsufficientStockError`), exchange not
   silently accepted then failed later — `exchanges.test.ts` test
   "rejects initiation immediately when the replacement SKU is out of
   stock", and no `Exchange` row is created.
2. [x] Replacement becomes unavailable *after* being reserved for the
   exchange but before the original item is received back → the
   reservation is held for a configurable, bounded window
   (`EXCHANGE_REPLACEMENT_HOLD_DAYS`, default 14 days); if it is lost
   anyway, the `Exchange` durably transitions to
   `REPLACEMENT_UNAVAILABLE` with an audit row, never silently — 
   `exchanges.test.ts` test "transitions to REPLACEMENT_UNAVAILABLE".
3. [x] Price-difference payment fails → exchange does not complete
   silently; customer can retry without re-initiating the whole
   exchange — `exchanges.test.ts` test "a failed price-difference
   payment does not complete the exchange silently".

## Financial integrity

- [x] Price-difference payment collection is idempotent (same
      idempotency discipline as `acceptance/m14-payment.md`) — reuses
      the SAME `PaymentEvent` dedup table/mechanism (a new nullable
      `exchangeId` column alongside `paymentId`), proven by
      `exchanges.test.ts` test "duplicate payment-capture webhook
      events are a safe no-op".
- [x] Price-difference store-credit issuance is idempotent (same
      discipline as `acceptance/m20-refunds-store-credit.md`) — reuses
      `StoreCreditService.issue()` directly, keyed by
      `exchange-store-credit:${exchange.id}`.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 11 (size exchange)
      combined with FLOW 14 (store credit produced) is driven through
      a real browser end to end (`test/e2e-storefront/exchanges.spec.ts`)
      - a same-style, cheaper-replacement exchange, the one path that
      settles with no external payment redirect. FLOW 12 (colour
      exchange) and FLOW 13 (additional payment, which needs a real
      Razorpay Checkout.js redirect) are proven at the integration
      layer instead (`test/integration/exchanges.test.ts`) — same
      precedent as this build's earlier milestones for any path
      needing a real gateway redirect.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
