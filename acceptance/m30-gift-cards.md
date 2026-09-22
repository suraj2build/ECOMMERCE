# M30 — Gift Cards Acceptance Criteria

**Spec(s):** `specs/33-store-credit-gift-cards.md`
**Status:** READY_FOR_IMPLEMENTATION (scheduled late by design — not a
launch blocker)

## Business acceptance

- [ ] A gift card can be purchased by a customer (a new value-creation
      event, distinct from store credit which is only ever
      platform-issued).
- [ ] Gift-card balances have auditable ledger integrity equivalent to
      store credit and loyalty — no mutable balance field as sole
      source of truth.
- [ ] A gift card is redeemable at checkout as a distinct payment
      method/balance source.

## Functional acceptance

- [ ] Gift-card purchase, issuance, and redemption are each ledger
      transactions.
- [ ] Gift-card and store-credit ledger entries remain distinguishable
      by origin/type even if they share underlying ledger mechanics.

## Financial integrity

- [ ] Gift-card purchase payment follows the same idempotency
      discipline as any other payment operation
      (`acceptance/m14-payment.md`).
- [ ] Gift-card redemption cannot be applied twice for the same
      purchase event (idempotent).

## Negative scenarios / edge cases

1. Attempt to redeem a gift card for more than its remaining balance →
   partial redemption up to balance, remainder via another payment
   method, or blocked — whichever behavior is implemented must be
   explicit and tested, not undefined.
2. Attempt to redeem an already-fully-redeemed gift card → blocked
   with a clear message.

## Test requirements

- [ ] Integration tests: purchase → issuance → redemption → balance
      correctness.
- [ ] Idempotency test for both purchase and redemption.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
