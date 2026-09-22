# M20 — Refunds & Store Credit Acceptance Criteria

**Spec(s):** `specs/19-refunds.md`, `specs/33-store-credit-gift-cards.md` (store-credit ledger foundation)
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Prepaid-order refunds return to the original payment method.
- [ ] **COD-order refunds issue as store credit**, never as a
      bank/UPI transfer.
- [ ] **Refund amount always uses the original transaction price**,
      never the current catalog price — verified by changing the
      product price after the order, then refunding, and confirming
      the refunded amount matches the original order value.
- [ ] Store credit is a separate ledger from loyalty points — verified
      structurally (distinct tables/entities) and behaviorally (a
      store-credit-issuing event never writes to the loyalty ledger).
- [ ] Store credit does not expire — verified by a test asserting a
      store-credit balance remains redeemable indefinitely (no expiry
      job ever touches it).

## Functional acceptance

- [ ] Partial refunds are supported and calculate correctly against
      the original line-item transaction values.
- [ ] A refund/credit-note-qualifying event generates the linked
      credit-note document (`acceptance/m08-tax-invoicing-foundation.md`
      scaffolding).

## Financial integrity (binding)

- [ ] **A duplicated refund-triggering event (retried webhook,
      duplicated cancellation request) does not issue a refund or
      store credit twice** — automated test required.
- [ ] Refund and store-credit issuance operations are idempotent per
      triggering event ID.

## Auditability

- [ ] Every refund and every store-credit ledger entry records
      who/what/when/reference (linking back to the triggering
      cancellation/return/exchange).

## Negative scenarios / edge cases

1. Attempt to process the same refund twice (simulated duplicate
   event) → second attempt is a safe no-op, verified via ledger
   inspection (exactly one entry).
2. Partial refund on a multi-line return → only the returned lines'
   original values are refunded, not the whole order.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 9 (prepaid refund)
      and FLOW 10 (COD return → store credit).
- [ ] Idempotency test for refund/store-credit issuance is mandatory
      and automated.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
