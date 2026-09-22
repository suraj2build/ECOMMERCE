# M21 — Exchanges Acceptance Criteria

**Spec(s):** `specs/20-exchanges.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Both size exchange and colour exchange are supported.
- [ ] Replacement SKU availability is checked and reserved at exchange-
      request time (using the same reservation mechanics as checkout).
- [ ] Replacement costing more → customer pays the difference via an
      online payment flow. Replacement costing less → difference
      issued as store credit.

## Functional acceptance

- [ ] Exchange is modeled as a first-class entity — a single
      Exchange record links the original order/item, the replacement
      SKU, and any payment/credit settlement, queryable as one
      coherent operation (not reconstructed by joining a return and an
      unrelated new order).
- [ ] Exchange inventory effects post as two explicit ledger
      transactions (release original + reserve/allocate replacement).

## Negative scenarios / edge cases

1. Requested replacement SKU is out of stock at request time → clearly
   communicated, exchange not silently accepted then failed later.
2. Replacement becomes unavailable *after* being reserved for the
   exchange but before the original item is received back → defined
   handling (e.g., hold reservation for a bounded window, or offer
   alternative) — test whatever the implementation defines, but it
   must not silently lose the reservation without customer
   notification.
3. Price-difference payment fails → exchange does not complete
   silently; customer can retry without re-initiating the whole
   exchange.

## Financial integrity

- [ ] Price-difference payment collection is idempotent (same
      idempotency discipline as `acceptance/m14-payment.md`).
- [ ] Price-difference store-credit issuance is idempotent (same
      discipline as `acceptance/m20-refunds-store-credit.md`).

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 11 (size exchange),
      FLOW 12 (colour exchange), FLOW 13 (additional payment), FLOW 14
      (store credit produced).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
