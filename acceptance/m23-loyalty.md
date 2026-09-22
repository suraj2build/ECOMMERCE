# M23 — Loyalty Acceptance Criteria

**Spec(s):** `specs/22-loyalty.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Points are earned based on qualifying purchase value at a
      configurable rate.
- [ ] Points are redeemable on future purchases per configurable
      conversion/minimum/maximum rules.
- [ ] Points expire per a configurable period.
- [ ] Loyalty, store credit, tier/status, and promotions/coupons are
      **structurally separate** — verified by confirming they live in
      distinct ledger tables/entities, not a shared generic "balance"
      table.

## Functional acceptance

- [ ] Earn/redeem/reverse/expire/manual-adjustment ledger transactions
      are all implemented and auditable.
- [ ] Loyalty redemption can combine with store credit and compatible
      promotions on the same order, per configurable stacking rules.

## Financial integrity

- [ ] Points earned on a cancelled/returned order are reversed via a
      ledger entry, not a direct balance edit.
- [ ] A duplicated earn-triggering event does not double-earn points
      (idempotent per order/triggering-event ID).

## Negative scenarios / edge cases

1. Attempt to redeem more points than the configured per-order maximum
   → blocked.
2. Points expire correctly at the configured boundary — verified with
   a time-manipulated or scheduled-job test, not just code inspection.
3. Order cancelled after points were earned → points reversed exactly
   once (not double-reversed if cancellation is retried).

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 17 (earn/redeem/
      reverse/expire) and FLOW 18 (coupon + promotion + store credit
      stacking).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
