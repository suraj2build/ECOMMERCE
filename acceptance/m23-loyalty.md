# M23 — Loyalty Acceptance Criteria

**Spec(s):** `specs/22-loyalty.md`
**Status:** IMPLEMENTED (built 2026-09-27; independent-review
certification-repair applied 2026-09-27 for Blocker 1 — see below;
`LOY-006` `DECISION_REQUIRED` remains open, blocking full M23
certification)

## Business acceptance

- [x] Points are earned based on qualifying purchase value at a
      configurable rate. `LoyaltyService.earnForOrder` uses
      `Order.subtotal` (the existing, already-frozen "tax-inclusive
      sum of lines" field) as the qualifying value, multiplied by the
      configurable `LOYALTY_EARN_POINTS_PER_100_INR` (default 1, an
      engineering default per LOY-002, never an invented commercial
      rate).
- [x] Points are redeemable on future purchases per configurable
      conversion/minimum/maximum rules —
      `LOYALTY_REDEMPTION_PAISE_PER_POINT` (default 25),
      `LOYALTY_MIN_REDEMPTION_POINTS` (default 100),
      `LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER` (default 2000), all
      enforced in `previewRedemptionValue`/`reserveRedemptionForCheckout`.
- [x] Points expire per a configurable period —
      `LOYALTY_POINTS_EXPIRY_DAYS` (default 365), enforced per-EARN-batch
      via `LoyaltyLedgerEntry.expiresAt` and swept by `expirePoints()`.
- [x] Loyalty, store credit, tier/status, and promotions/coupons are
      **structurally separate** — `LoyaltyAccount`/`LoyaltyLedgerEntry`/
      `LoyaltyTier`/`LoyaltyPointAllocation`/`LoyaltyRedemptionHold` are
      distinct models from `StoreCreditAccount`/`StoreCreditEntry`
      (M20) and from Promotion/Coupon (M24, not yet built) — no shared
      generic "balance" table.

## Functional acceptance

- [x] Earn/redeem/reverse/expire/manual-adjustment ledger transactions
      are all implemented and auditable —
      `LoyaltyLedgerEntryType { EARN REDEEM REVERSE EXPIRE ADJUST }`,
      each entry `recordAudit`-ed (`loyalty.earn`/`.redeem`/`.reverse`/
      `.expire`/`.adjust`).
- [x] Loyalty redemption can combine with store credit on the same
      order, per configurable rules — `CheckoutSession`/`Order` carry
      independent `loyaltyRedemptionValue` and `storeCreditApplied`
      fields, each computed and applied independently; `amountPayable`
      nets both. Promotions/coupons (M24) do not exist yet in this
      codebase, so stacking with them is `DEPENDENCY_DEFERRED — M24`
      until that milestone is built — not fabricated here.

## Financial integrity

- [~] Points earned on a cancelled/returned order are reversed via a
      ledger entry, not a direct balance edit — **partially satisfied,
      see `LOY-006` `DECISION_REQUIRED`.**
      `LoyaltyService.reverseForOrderLine`/`reverseForReturnLine` both
      create a `REVERSE` ledger entry + `LoyaltyPointAllocation` row
      before updating the account's `balance`/`lifetimeEarnedPoints`
      columns; the account row is never mutated directly outside these
      paths. Return-side reversal is gated identically to
      `refundEligible` (QC PASS only) — a FAILED-QC return neither
      refunds cash nor claws back points, the same DECISION_REQUIRED
      reasoning `RET-005` already established for the cash side.
      **However**, when the customer has already redeemed/lost some of
      the specific points a cancelled/returned order earned (on a
      different, unrelated order) before the cancellation/return
      occurs, the balance-affecting reversal (`pointsDelta`) is capped
      at whatever remains unconsumed in that EARN batch — it is NOT the
      full amount the order actually earned. The 2026-09-27
      independent-review certification-repair (Blocker 1) closed the
      *visibility* gap this created (every REVERSE entry now also
      records the full, uncapped `requiredPointsDelta`, and a shortfall
      posts a distinct, clearly-labelled `loyalty.reverse.shortfall`
      audit event — proven in `test/integration/loyalty.test.ts` test
      #22) but does **not** resolve what should happen to the shortfall
      itself — see `specs/22-loyalty.md`'s own `DECISION_REQUIRED —
      LOYALTY CLAWBACK AFTER POINTS ALREADY SPENT` block and `LOY-006`
      in `blueprint/DECISION_REGISTER.md`. This criterion cannot be
      checked off as fully satisfied until the Product Owner decides
      that question.
- [x] A duplicated earn-triggering event does not double-earn points
      (idempotent per order/triggering-event ID) —
      `LoyaltyLedgerEntry.qualifyingOrderId` is `@unique`; `earnForOrder`
      checks for an existing entry first and its `create` is also
      guarded against a genuine race via a caught `P2002`. Proven in
      `test/integration/loyalty.test.ts` test #3 (a direct repeat call
      of `earnForOrder` for the same order posts no second entry).

## Negative scenarios / edge cases

1. Attempt to redeem more points than the configured per-order maximum
   → blocked (`test/integration/loyalty.test.ts` — minimum/maximum
   validation tests #10/#11; `LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER`
   enforced in both `previewRedemptionValue` and the authoritative
   `reserveRedemptionForCheckout`).
2. Points expire correctly at the configured boundary — verified with
   a time-manipulated test, not just code inspection: test #15/#16 set
   a real `LoyaltyLedgerEntry.expiresAt` into the past and call the
   real `expirePoints()` sweep (also exercised as a real staff-gated
   HTTP route, `POST /api/v1/loyalty/sweep/expire`, in the E2E FLOW 17
   test's second scenario) — FIFO ordering (oldest batch expires
   first) is proven with two earn batches, one past its window and one
   not.
3. Order cancelled after points were earned → points reversed exactly
   once (not double-reversed if cancellation is retried) — test #6
   retries the identical cancellation call twice via the same
   idempotency key and asserts exactly one `REVERSE` entry exists.

## Concurrency (adversarial, real Postgres — Promise.all alone is not
sufficient if it does not force real overlap; every test below fires
genuinely concurrent operations against real Postgres, verified to
produce both possible outcomes/orderings across repeated runs where
applicable)

- [x] Two genuinely concurrent checkouts, each attempting to redeem
      more than half the same account's balance, converge to exactly
      one success and one safe rejection — never a double-spend, never
      a negative balance (`test/integration/loyalty.test.ts` test #14,
      two real `app.inject` HTTP requests fired via `Promise.all`
      without an intervening `await`, serialized by the account row's
      own `FOR UPDATE` lock acquired inside
      `reserveRedemptionForCheckout`).
- [x] Two genuinely concurrent expiry sweeps on the same past-window
      batch expire it exactly once, never twice (test #15, two real
      `expirePoints()` calls fired via `Promise.all`, serialized by the
      per-batch account lock plus the `expire:<batchId>` idempotency
      key).

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 17 (earn/redeem/
      reverse/expire) — `test/e2e-storefront/loyalty.spec.ts`, driving a
      real mobile-OTP sign-in, a real COD purchase (EARN), a second
      real checkout redeeming points through the checkout page's own
      redemption input (REDEEM, server-authoritative), a real
      self-service cancellation (REVERSE), and a real staff-gated sweep
      call (EXPIRE) — every stage verified both in the browser and
      against the real ledger via Prisma, 2/2 passing.
- [ ] FLOW 18 (coupon + promotion + loyalty + store-credit stacking)
      belongs to M24 (Promotions), not yet built within this phase's
      own sequencing (M23 → M24 → M25) — tracked there, not fabricated
      here.

## Security / privacy

- [x] Cross-customer IDOR: both customer-facing loyalty routes
      (`GET /storefront/account/loyalty`, `GET
      /storefront/account/loyalty/ledger`) read `customerId` only from
      the verified JWT, never a body/query/param — proven negatively
      in `test/integration/loyalty.test.ts` tests #20-22 (a second
      customer's account is genuinely empty, never customer A's data;
      unauthenticated and guest-session requests are rejected with 401
      — loyalty has no guest concept at all).
- [x] The one staff mutation route (`POST /loyalty/adjust`) is gated by
      a dedicated `loyalty:adjust` permission, separate from any read
      permission (test #19: a staff caller without it is rejected with
      403).

## Definition of Done

All boxes above checked except FLOW 18 (explicitly out of this
milestone's scope, belongs to M24) and the financial-integrity
reversal-completeness box, which is marked `[~]` (partially satisfied)
pending the Product Owner's decision on `LOY-006` in
`blueprint/DECISION_REGISTER.md` — see `specs/22-loyalty.md`'s
`DECISION_REQUIRED — LOYALTY CLAWBACK AFTER POINTS ALREADY SPENT`
block. This agent does not self-declare M23 certified — that
determination belongs to the independent reviewer, per the discipline
this project has followed since Phase 1.
