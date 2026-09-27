# M24 — Promotions Acceptance Criteria

**Spec(s):** `specs/23-promotions.md`
**Status:** IMPLEMENTED (built 2026-09-27; not yet independently reviewed)

## Business acceptance

- [x] Both coupon-code and automatic promotions work — `Promotion.isCoupon`
      distinguishes the two; `PromotionService.resolveApplication` resolves
      automatic promotions first (eligibility: active, within
      start/end window, `minCartValue` met), then validates an optional
      coupon code against the survivors.
- [x] Promotion type system is extensible (a new coupon type can be
      configured without a code change) — covers at minimum
      promotional, campaign, onboarding coupon types.
      `PromotionType` is a genuine reference table (`id`, `key` @unique,
      `name`), never a fixed enum; seeded with `PROMOTIONAL`/`CAMPAIGN`/
      `ONBOARDING`/`CASHBACK`. A new type is a data row via the existing
      `promotion:manage`-gated API, not a schema/enum change.
- [x] Stacking compatibility (one coupon + compatible automatic
      promotions) is rule-driven/configurable, not hard-coded per
      combination. `Promotion.stackGroup` (nullable) + `priority` (int,
      tie-broken by `id`) drive it: two promotions sharing a non-null
      `stackGroup` are mutually exclusive; automatic promotions resolve
      greedily by priority, and a coupon is rejected only if it shares a
      `stackGroup` with an already-chosen automatic promotion — never a
      hard-coded combination table. Proven in
      `test/integration/promotions.test.ts` tests #3/#4/#5/#8.

## Functional acceptance

- [x] Invalid/expired coupon codes show a clear inline error at
      cart/checkout — `findCoupon` returns a specific rejection reason
      (not found, expired, below minCartValue, usage limit reached);
      the checkout page surfaces it inline via `couponError` state, and
      the server independently re-validates at `startCheckout` (never
      trusting a client-held discount). Tests #6/#7/#9/#10.
- [x] Discount computation applies pre-tax by default (configurable
      flag) — `PROMOTIONS_DISCOUNT_PRETAX` (default `true`) gates
      `CheckoutService.priceLines`'s pro-rata per-line taxable-value
      reduction, applied before the pre-existing, unmodified `splitTax`
      function. Test #11 proves exact-sum, no rounding drift.

## Negative scenarios / edge cases

1. Attempt to apply two mutually-incompatible promotions → the second
   is rejected with a clear reason, the first remains applied. Proven
   in test #8: a coupon sharing a `stackGroup` with an already-eligible
   automatic promotion is rejected by name, and the automatic promotion
   remains applied on a retry without the coupon; also proven end-to-end
   in `test/e2e-storefront/promotions.spec.ts` (FLOW 18), where the
   rejection message is visible in the browser while the automatic
   promotion's discount line stays displayed.
2. Coupon usage cap reached → further redemption attempts blocked with
   a clear message. Proven for both `usageLimitTotal` (test #9) and
   `usageLimitPerCustomer` (test #10), plus a genuine `Promise.all`
   concurrency race for a single-use coupon (test #15): two simultaneous
   checkouts against the same one-use coupon converge to exactly one
   success and one clear rejection — never both succeeding.

## Financial integrity

- [x] Each order's components remain independently reconstructible —
      `promotionDiscountTotal` is a field fully independent from
      `loyaltyRedemptionValue`/`storeCreditApplied` (no shared "total
      discount" bucket); `OrderLine.discountAmountSnapshot` records each
      line's own discount share, copied at order creation from the
      `CheckoutSessionLine` so the pre-discount and post-discount
      taxable value can always be reconstructed independently of any
      other domain's ledger.
- [x] Store-credit redemption at checkout (net-new capability; M20 only
      ever built ISSUE) is modeled as `StoreCreditRedemptionHold`
      (ACTIVE/CONVERTED/RELEASED), a structural mirror of
      `LoyaltyRedemptionHold` — available balance = ledger balance minus
      active holds, never mutating the ledger until the real REDEEM
      entry posts at order confirmation. This build's own adversarial
      testing caught and fixed a genuine bug: the REDEEM entry initially
      stored a negative `amount`, violating the pre-existing
      `store_credit_entries_amount_positive_check` constraint — fixed to
      store a positive magnitude, with `type` (not sign) encoding
      direction, matching the constraint's original design intent.
      Tests #12/#13.

## Concurrency (adversarial, real Postgres — genuine `Promise.all`-forced
overlap, not sequential simulation)

- [x] Two genuinely concurrent checkouts, each attempting to spend most
      of the same store-credit balance, converge to exactly one success
      and one safe rejection — never a negative balance (test #14, two
      real `app.inject` HTTP requests fired via `Promise.all` without an
      intervening `await`, serialized by the account row's own
      `FOR UPDATE` lock acquired inside `reserveRedemptionForCheckout`).
- [x] Two genuinely concurrent checkouts racing the same single-use
      coupon converge to exactly one success, the other rejected with a
      clear message — never both succeeding, never a double-redemption
      (test #15, serialized by the promotion row's own `FOR UPDATE` lock
      acquired inside `reserveForCheckout` before the HOLD/CONVERTED
      count check).

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 18 —
      `test/e2e-storefront/promotions.spec.ts`, driving a real
      mobile-OTP sign-in, an automatic 10%-off promotion applying with
      no code, an incompatible coupon rejected while the automatic
      promotion's discount remains visible, a compatible coupon then
      stacking with it, store credit applied on top, and a real COD
      order placed — verified server-side via Prisma that exactly the
      two compatible `PromotionRedemption` rows exist (never the
      incompatible one) and that the confirmation page's
      `amountPayable` matches the UI's own arithmetic, 1/1 passing.

## Security / privacy

- [x] The one staff mutation surface (`POST /promotions`,
      `PATCH /promotions/:id/active`) is gated by a dedicated
      `promotion:manage` permission, separate from the `promotion:read`
      permission gating the list/get routes — a staff caller without
      `promotion:manage` is rejected with 403 (test #16); a promotion
      created via the real staff API is immediately usable at checkout
      (test #17), proving the read path and the checkout-eligibility
      path are not independently drifting implementations.
- [x] Customer-facing coupon/store-credit application at checkout reads
      `customerId`/`guestSessionId` only from the existing verified
      cart-owner identity resolution (the same mechanism every other
      checkout field already uses) — no new IDOR surface is introduced,
      since promotions/store-credit are applied to the caller's own
      checkout session only, never addressable by another party's ID.

## Open items

- `specs/23-promotions.md`'s `## DECISION_REQUIRED` block: whether a
  coupon's usage count should be restored after the order that consumed
  it is later cancelled is explicitly unresolved. Current behavior (a
  `CONVERTED` `PromotionRedemption` is permanent once an order confirms)
  is option (a)'s behavior by omission, not a considered choice — not
  implemented, not guessed.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This agent does
not self-declare M24 certified — that determination belongs to the
independent reviewer, per the discipline this project has followed
since Phase 1.
