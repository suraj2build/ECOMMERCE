# M24 — Promotions Acceptance Criteria

**Spec(s):** `specs/23-promotions.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Both coupon-code and automatic promotions work.
- [ ] Promotion type system is extensible (a new coupon type can be
      configured without a code change) — covers at minimum
      promotional, campaign, onboarding coupon types.
- [ ] Stacking compatibility (one coupon + compatible automatic
      promotions) is rule-driven/configurable, not hard-coded per
      combination.

## Functional acceptance

- [ ] Invalid/expired coupon codes show a clear inline error at
      cart/checkout.
- [ ] Discount computation applies pre-tax by default (configurable
      flag).

## Negative scenarios / edge cases

1. Attempt to apply two mutually-incompatible promotions → the second
   is rejected with a clear reason, the first remains applied.
2. Coupon usage cap reached → further redemption attempts blocked with
   a clear message.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 18.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
