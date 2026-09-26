# M21 — Exchanges Acceptance Criteria

**Spec(s):** `specs/20-exchanges.md`
**Status:** M21 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `EXC-004`. Independent review of that
build found the original `status = COMPLETED` at replacement allocation
unacceptable (reaching a firm inventory allocation is not the same
thing as the replacement reaching the customer) and required the
14-day hold default's provenance corrected; repaired 2026-09-26
(Post-Purchase Phase independent-review repair, findings 1 and 3) — see
`EXC-004`'s repair addenda. **Physical forward fulfilment of the
replacement remains an open `DECISION_REQUIRED`** (see `EXC-004`); this
build does not claim that question resolved. Not self-declared
`VERIFIED`; independent re-review pending.

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
- [x] **An exchange is reported COMPLETED only once the replacement has
      actually reached the customer, never merely because the
      replacement stock was reserved/allocated** (independent-review
      repair, finding 3). QC pass + payment/credit settlement +
      reservation conversion reaches a NEW intermediate status,
      `REPLACEMENT_ALLOCATED` — the inventory side is fully resolved,
      but the Exchange is NOT done. Only an explicit staff confirmation
      (`ExchangeService.markReplacementFulfilled`, gated by a NEW,
      separately-granted `exchange:fulfil` permission — never bundled
      into `exchange:qc`, which is about the ORIGINAL item's condition)
      moves it to `COMPLETED`, recording `replacementFulfilledAt`/
      `replacementFulfilledByStaffId`. `exchanges.test.ts`'s
      "replacement fulfilment state distinction" describe block proves
      both the rejection before `REPLACEMENT_ALLOCATED` and the
      idempotent, RBAC-gated confirmation after it; every existing
      happy-path test in this file now asserts `REPLACEMENT_ALLOCATED`
      at the QC/payment-settlement point, not `COMPLETED`.
      **`DECISION_REQUIRED — EXCHANGE REPLACEMENT FULFILMENT MODEL`
      remains open** (see `EXC-004`): whether/how to integrate the
      replacement's actual physical pick/pack/ship with M16/M17's
      OrderLine-anchored pipeline is NOT resolved by this repair —
      `markReplacementFulfilled` is an honest manual stand-in, not a
      substitute for that architecture decision.

## Negative scenarios / edge cases

1. [x] Requested replacement SKU is out of stock at request time →
   clearly communicated (409 `InsufficientStockError`), exchange not
   silently accepted then failed later — `exchanges.test.ts` test
   "rejects initiation immediately when the replacement SKU is out of
   stock", and no `Exchange` row is created.
2. [x] Replacement becomes unavailable *after* being reserved for the
   exchange but before the original item is received back → the
   reservation is held for a configurable, bounded window
   (`EXCHANGE_REPLACEMENT_HOLD_DAYS`, default **14 calendar days — an
   explicit Product Owner decision**, per the Post-Purchase Phase
   independent-review repair, 2026-09-26; see `EXC-004` in
   `blueprint/DECISION_REGISTER.md`); if it is lost anyway, the
   `Exchange` durably transitions to `REPLACEMENT_UNAVAILABLE` with an
   audit row — never a silent release that pretends the exchange is
   proceeding normally, and always requiring explicit customer/CS
   resolution — `exchanges.test.ts` test "transitions to
   REPLACEMENT_UNAVAILABLE".
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

## Cross-domain integrity

- [x] **A single physical, delivered `OrderLine` cannot concurrently
      acquire both an active `Return` and an active `Exchange`, proven
      under REAL concurrency, not a sequential test order**
      (independent-review repair, finding 5). The application-level
      cross-check alone was not a genuine guard — two truly concurrent
      transactions could each read "no conflicting record" under
      read-committed isolation before either committed, since
      `return_lines`/`exchanges` carry independent unique constraints
      on `orderLineId` that don't block each other. Both
      `ReturnService.performInitiate` and
      `ExchangeService.performInitiate` now lock the SAME `order_lines`
      row (`SELECT ... FOR UPDATE`) as the first statement of their
      transaction — a genuine, shared database-level serialization
      point — before the cross-domain check, so a concurrent Return-
      initiate and Exchange-initiate on the identical line genuinely
      serialize rather than race. `exchanges.test.ts` test "genuinely
      concurrent Return-initiate and Exchange-initiate on the SAME
      order line converge to exactly one winner, never both" fires both
      requests via `Promise.all` and asserts exactly one `[201, 409]`
      outcome and exactly one child row exists afterward. See `RET-005`/
      `EXC-004`'s matching correction in
      `blueprint/DECISION_REGISTER.md`.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 11 (size exchange)
      combined with FLOW 14 (store credit produced) is driven through
      a real browser end to end (`test/e2e-storefront/exchanges.spec.ts`)
      - a same-style, cheaper-replacement exchange, the one path that
      settles with no external payment redirect, now also driving the
      finding-3 `REPLACEMENT_ALLOCATED` → explicit staff
      `markReplacementFulfilled` confirmation → `COMPLETED` sequence
      through the real page (asserting the "Replacement reserved"
      label before the confirmation, "Exchange completed" only after).
      FLOW 12 (colour exchange) and FLOW 13 (additional payment, which
      needs a real Razorpay Checkout.js redirect) are proven at the
      integration layer instead (`test/integration/exchanges.test.ts`)
      — same precedent as this build's earlier milestones for any path
      needing a real gateway redirect.

## Definition of Done

All boxes above checked, plus `acceptance/README.md` — **except** the
replacement-physical-fulfilment architecture question, which remains
`DECISION_REQUIRED` (see `EXC-004`) and is not claimed resolved by this
build or this repair.
