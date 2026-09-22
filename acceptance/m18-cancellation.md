# M18 — Cancellation Acceptance Criteria

**Spec(s):** `specs/17-cancellation.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Customer can self-service cancel any order line before shipment.
- [ ] Partial cancellation (subset of lines) works correctly.
- [ ] Cancelling a captured-payment order triggers the refund flow.
- [ ] Loyalty points earned on a cancelled order/line are reversed via
      a ledger entry.

## Functional acceptance

- [ ] Cancellation is blocked once the relevant line has shipped
      (routes to return instead).
- [ ] Inventory reservation/allocation is released via a ledger
      transaction on cancellation.

## Authorization

- [ ] Both customer self-service and CS-assisted cancellation paths
      work and are independently authorized.

## Auditability

- [ ] Cancellation reason (when provided), actor, and timestamp are
      recorded.

## Negative scenarios / edge cases

1. Attempt to cancel a shipped line → blocked with a clear message
   directing to the return flow.
2. Cancel one line of a multi-line order → remaining lines and their
   shipment/payment proceed unaffected; refund calculated only for the
   cancelled line's original transaction value.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 7.
- [ ] Integration test: loyalty-points reversal on cancellation.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
