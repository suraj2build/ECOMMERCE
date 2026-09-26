# M21 — Exchanges Acceptance Criteria

**Spec(s):** `specs/20-exchanges.md`
**Status:** M21 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `EXC-004`. Independent review of that
build found the original `status = COMPLETED` at replacement allocation
unacceptable (reaching a firm inventory allocation is not the same
thing as the replacement reaching the customer) and required the
14-day hold default's provenance corrected; repaired 2026-09-26
(Post-Purchase Phase independent-review repair, findings 1 and 3) — see
`EXC-004`'s repair addenda. That repair left **physical forward
fulfilment of the replacement** as an open `DECISION_REQUIRED` with
three options. **The Product Owner selected Option 2 on 2026-09-26**:
generalize M16/M17's certified `PickTask`/`OrderFulfilment`/`Shipment`
pipeline (nullable dual-source FKs — same-row CHECK for `PickTask`,
a cross-table trigger pair for `OrderFulfilment`) to serve an Exchange
replacement as an alternate fulfilment source, reusing the SAME
pick/pack/ready-to-ship/ship/deliver routes a normal order's own
fulfilment uses. `Exchange.status` now reaches `COMPLETED`
AUTOMATICALLY the instant the replacement's own shipment reaches
DELIVERED — a new `EXCHANGE_DISPATCH` inventory-ledger type (never a
second `SALE`) marks the physical dispatch, with its GST/invoice
consequence explicitly flagged **TAX/COMPLIANCE REVIEW REQUIRED**
rather than decided here. `markReplacementFulfilled` remains only as
an exception/recovery mechanism, never the normal path. See
`EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER" addendum for the full
design record. **A final independent review then found the
`OrderFulfilment` source-exclusivity trigger pair admitted a genuine
write-skew race under real concurrency (a plain SELECT with no lock in
each trigger is not itself a serialization point); fixed 2026-09-26 by
giving both directions a shared lock on the same `order_fulfilments`
row, proven with a genuine two-connection concurrent-transaction test
that first reproduced the race against the unfixed trigger, then
confirmed the fix holds** — see `EXC-004`'s concurrency-correction
addendum and `test/integration/exchange-fulfilment-xor-race.test.ts`.
Not self-declared certified; independent re-review pending.

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
      but the Exchange is NOT done. `exchanges.test.ts`'s "replacement
      fulfilment state distinction" describe block proves the rejection
      before `REPLACEMENT_ALLOCATED`.
      **EXC-004 Option 2 repair (2026-09-26, Product Owner decision):**
      `REPLACEMENT_ALLOCATED` now auto-creates a replacement `PickTask`
      (`ExchangeService.tryComplete` → `WarehouseService.createPickTaskForExchange`),
      reusing M16/M17's certified pipeline (generalized to a polymorphic
      fulfilment source) for pick → `assignReplacementToFulfilment` →
      pack → ready-to-ship → ship (posts `EXCHANGE_DISPATCH`, never a
      second `SALE`) → deliver. `Exchange.status` moves to `COMPLETED`
      AUTOMATICALLY the instant that replacement shipment reaches
      DELIVERED (`OrderService.markFulfilmentDelivered`'s own exchange
      branch) — this is now the normal happy path.
      `ExchangeService.markReplacementFulfilled` (gated by the SAME
      `exchange:fulfil` permission) remains ONLY as an exception/
      recovery mechanism for a replacement genuinely fulfilled outside
      this tracked pipeline — never the normal route. See
      `test/integration/exchange-fulfilment.test.ts` (16 tests) for the
      full pick/pack/ship/deliver/COMPLETED proof, including real
      carrier tracking + webhook-driven delivery, duplicate-webhook
      safety, and exactly-once `EXCHANGE_DISPATCH`.
      **`DECISION_REQUIRED — EXCHANGE REPLACEMENT FULFILMENT MODEL` is
      now RESOLVED** (Option 2 selected and implemented) — see
      `EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER" addendum in
      `blueprint/DECISION_REGISTER.md` for the full design record.

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

All boxes above checked, plus `acceptance/README.md`. The
replacement-physical-fulfilment architecture question (`EXC-004`) is
now RESOLVED (Option 2 selected by the Product Owner 2026-09-26 and
implemented — see `EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER"
addendum in `blueprint/DECISION_REGISTER.md`); this repair does not
self-declare the resulting build "certified" — independent re-review
remains pending, per this project's own binding discipline.
