# M23 — Loyalty Acceptance Criteria

**Spec(s):** `specs/22-loyalty.md`
**Status:** IMPLEMENTED (built 2026-09-27; independent-review
certification-repair applied 2026-09-27 for Blocker 1; `LOY-006`
resolved by the Product Owner 2026-09-27 and the resulting
PENDING → VESTED → REDEEMED/EXPIRED vesting-lifecycle repair applied
the same day — see below. Not yet independently re-reviewed.)

## 2026-09-27 LOY-006 vesting-lifecycle repair — what changed

The Product Owner resolved `LOY-006` with an explicit business rule:
loyalty points earned on a purchase must not become redeemable
immediately after order confirmation or delivery — they become
redeemable only after the qualifying order LINE has been DELIVERED
*and* its own return/exchange eligibility window has closed. Until
then, earned points are PENDING/non-redeemable and must not contribute
to the customer's available/spendable balance. This is a genuine
lifecycle change from the original build (which posted a single,
immediately-available EARN entry per whole order at confirmation
time), so every acceptance box below reflects the CURRENT, repaired
behavior; see `blueprint/DECISION_REGISTER.md`'s `LOY-006` entry and
`specs/22-loyalty.md`'s own `## LOY-006 RESOLUTION` section for the
full design record.

## Business acceptance

- [x] Points are earned based on qualifying purchase value at a
      configurable rate. `LoyaltyService.earnForOrder` now posts one
      EARN entry PER ORDER LINE (`qualifyingOrderLineId`, replacing the
      original per-order `qualifyingOrderId`), using that line's own
      frozen `lineTotalInclusive` as the qualifying value, multiplied
      by the configurable `LOYALTY_EARN_POINTS_PER_100_INR` (default 1,
      an engineering default per LOY-002, never an invented commercial
      rate). This entitlement is calculated at confirmation time but
      does NOT become spendable until it vests (see below).
- [x] Points become redeemable only after BOTH (1) the line is
      DELIVERED and (2) its return/exchange eligibility window has
      closed — `LoyaltyEntitlementStatus` (PENDING/VESTED/CANCELLED) on
      each EARN entry; `LoyaltyAccount.balance`/`lifetimeEarnedPoints`
      reflect ONLY vested points. The idempotent, concurrency-safe
      `LoyaltyService.vestEligiblePoints()` sweep (`POST
      /loyalty/sweep/vest`, staff-gated identically to every other
      loyalty sweep) performs the PENDING → VESTED transition, reusing
      the SAME `resolveReturnPolicy`/`isWithinWindow` source of truth
      Return/Exchange already use.
- [x] Points are redeemable on future purchases per configurable
      conversion/minimum/maximum rules —
      `LOYALTY_REDEMPTION_PAISE_PER_POINT` (default 25),
      `LOYALTY_MIN_REDEMPTION_POINTS` (default 100),
      `LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER` (default 2000), all
      enforced in `previewRedemptionValue`/`reserveRedemptionForCheckout`
      against the VESTED/available balance only — PENDING points never
      satisfy the minimum, the available-balance check, or hold
      creation.
- [x] Points expire per a configurable period, with the expiry clock
      starting at VESTING (not the original purchase date) —
      `LOYALTY_POINTS_EXPIRY_DAYS` (default 365), `expiresAt` is set
      only when an entry vests, enforced by `expirePoints()` against
      VESTED entries only.
- [x] Loyalty, store credit, tier/status, and promotions/coupons are
      **structurally separate** — `LoyaltyAccount`/`LoyaltyLedgerEntry`/
      `LoyaltyTier`/`LoyaltyPointAllocation`/`LoyaltyRedemptionHold` are
      distinct models from `StoreCreditAccount`/`StoreCreditEntry`
      (M20) and from Promotion/Coupon (M24) — no shared generic
      "balance" table. The vesting-status concept lives entirely
      inside `LoyaltyLedgerEntry`, never a new cross-cutting table.

## Functional acceptance

- [x] Earn/redeem/reverse/expire/manual-adjustment ledger transactions
      are all implemented and auditable —
      `LoyaltyLedgerEntryType { EARN REDEEM REVERSE EXPIRE ADJUST }`,
      each entry `recordAudit`-ed (`loyalty.earn.pending`/`.vest`/
      `.redeem`/`.pending.cancelled`/`.reverse.postvest[.shortfall]`/
      `.expire`/`.adjust`).
- [x] Loyalty redemption can combine with store credit and with
      compatible promotions on the same order (M24,
      `Promotion.loyaltyCompatible`/`storeCreditCompatible`) — see
      `acceptance/m24-promotions.md`'s own cross-domain compatibility
      section and FLOW 18 below.
- [x] Customer-facing loyalty balance clearly distinguishes AVAILABLE
      (spendable) points from PENDING (calculated but not yet
      redeemable) points — `GET /storefront/account/loyalty` returns
      both `balance` and `pendingPoints` as separate fields; the
      `/account/loyalty` storefront page and the checkout redemption
      panel both display the distinction, never summing them.

## Financial integrity

- [x] Points earned on a cancelled/returned order line are reversed/
      cancelled via a ledger entry, not a direct balance edit —
      `LoyaltyService.reverseForOrderLine`/`reverseForReturnLine`/
      `reverseForExchangeLine` all route through the same private
      `reverse()` method, which always creates a `REVERSE` ledger entry
      + `LoyaltyPointAllocation` row before touching the account's
      `balance`/`lifetimeEarnedPoints` columns (when the entry is
      already VESTED) or CANCELS the entitlement outright (when it is
      still PENDING, the normal case under the vesting model). The
      account row is never mutated directly outside this path.
- [x] **LOY-006 resolved**: under the vesting model, a standard
      cancellation/return/exchange can no longer create the
      "points already spent elsewhere before this order's own
      cancellation/return" shortfall scenario the original
      `DECISION_REQUIRED` worried about — cancellation only ever
      applies to a not-yet-shipped line (which can never be DELIVERED),
      and a Return/Exchange can only be INITIATED while the calendar
      window is still open, while vesting only happens once that
      window has closed. A REVERSE against a still-PENDING entry
      therefore has a genuinely-zero balance-affecting amount (nothing
      was ever credited) — but the full required-reversal amount and an
      audit event (`loyalty.pending.cancelled`) are still ALWAYS
      recorded, never silently skipped.
- [x] **Critical repair (2026-09-27):** the prior build's `reverse()`
      contained `if (actualReverse <= 0) return;` BEFORE recording
      anything, meaning a 100%-shortfall case could silently record
      nothing at all — contradicting the earlier repair's own claim
      that the required reversal is "always recorded." Fixed: the
      exceptional/admin-override VESTED-entry branch (structurally
      unreachable via any normal customer-facing flow under the vesting
      model — see the DECISION_REGISTER's `LOY-006` note) now always
      creates the REVERSE entry, `requiredPointsDelta`, and a
      `loyalty.reverse.postvest`/`.postvest.shortfall` audit event, even
      when the balance-affecting amount computes to exactly zero.
      Proven with a direct adversarial test that manufactures this exact
      scenario (`test/integration/loyalty.test.ts`, matrix item #16 —
      the normal customer-facing routes correctly refuse to reach it,
      so the test invokes the service method directly, exactly as an
      out-of-band administrative process would).
      Return-side reversal remains gated identically to `refundEligible`
      (QC PASS only) — a FAILED-QC return neither refunds cash nor
      claws back points, the same reasoning `RET-005` already
      established for the cash side. Exchange reuses the identical
      QC-PASS gate.
- [x] A duplicated earn-triggering event does not double-earn points
      (idempotent per order-LINE/triggering-event ID) —
      `LoyaltyLedgerEntry.qualifyingOrderLineId` is `@unique`;
      `earnForOrder` checks for an existing entry per line first and
      its `create` is also guarded against a genuine race via a caught
      `P2002`. Proven in `test/integration/loyalty.test.ts` matrix item
      #1 (a direct repeat call of `earnForOrder` for the same order
      posts no second entry per line).

## Vesting-lifecycle test matrix (2026-09-27, 16 items, all in
`test/integration/loyalty.test.ts`)

1. [x] Order confirmed → points calculated → PENDING → available
       balance unchanged.
2. [x] Delivered → return/exchange window still open → still PENDING.
3. [x] Delivered → window closes → vest → AVAILABLE exactly once (a
       second sweep run is a safe no-op).
4. [x] Two concurrent vesting sweeps → exactly one vesting transition
       (genuine `Promise.all`, real Postgres row-lock serialization).
5. [x] Sweep retry → no duplicate points (covered together with #3/#4).
6. [x] Cancellation before vesting → pending points cancelled → never
       available, even after a later sweep run.
7. [x] Return/QC before vesting → pending points reversed/cancelled →
       never available; a QC-FAIL return does NOT block vesting.
8. [x] Customer with 100 available + 500(-equivalent) pending →
       checkout can redeem a maximum based only on the available
       amount.
9. [x] Minimum-redemption calculation ignores pending points (a
       customer with only pending points cannot redeem even the
       configured minimum).
10. [x] FIFO redemption never consumes pending points — draw-down
        touches only the VESTED batch, a PENDING batch is untouched.
11. [x] Expiry clock starts from the vesting date, not the original
        purchase date.
12. [x] Partial/multi-line order: one line delivered with its window
        closed vests; another line, still returnable, remains PENDING.
13. [x] Different delivery dates → independent vesting per line.
14. [x] Existing redemption concurrency protection remains green under
        the vesting model (re-verified against genuinely VESTED
        points).
15. [x] M24 cross-domain compatibility (FLOW 18 and
        `test/integration/promotions.test.ts` tests #18/#20/#24) remain
        green using genuinely AVAILABLE points — those tests were
        updated to seed available balances via the staff manual-
        adjustment route (immediate by design, unaffected by vesting)
        rather than relying on the now-PENDING immediate-earn
        assumption.
16. [x] The previous 100%-shortfall accounting hole is fixed: a
        balance-affecting reversal of zero still truthfully records the
        required reversal/shortfall.

## Negative scenarios / edge cases

1. Attempt to redeem more points than the configured per-order maximum
   → blocked. Attempt to redeem more than the AVAILABLE (vested)
   balance, even when available+pending would cover it → blocked
   (matrix items #8/#9).
2. Points expire correctly at the configured boundary, measured from
   vesting — verified with a time-manipulated test (matrix item #11),
   not just code inspection.
3. Order line cancelled after points were calculated (still PENDING) →
   entitlement cancelled exactly once (not double-reversed if
   cancellation is retried) — retrying the identical cancellation call
   twice via the same idempotency key asserts exactly one `REVERSE`
   entry exists.

## Concurrency (adversarial, real Postgres — Promise.all alone is not
sufficient if it does not force real overlap; every test below fires
genuinely concurrent operations against real Postgres, verified to
produce both possible outcomes/orderings across repeated runs where
applicable)

- [x] Two genuinely concurrent vesting sweeps racing the same due
      entry converge to exactly one vesting transition (matrix item
      #4) — serialized by the SAME `LoyaltyAccount` row lock
      `reverse()` also locks first, so a sweep can never race a
      concurrent QC-PASS reversal into an inconsistent state either.
- [x] Two genuinely concurrent checkouts, each attempting to redeem
      more than half the same account's AVAILABLE balance, converge to
      exactly one success and one safe rejection — never a
      double-spend, never a negative balance (matrix item #14, two real
      `app.inject` HTTP requests fired via `Promise.all` without an
      intervening `await`, serialized by the account row's own
      `FOR UPDATE` lock acquired inside `reserveRedemptionForCheckout`).
- [x] Two genuinely concurrent expiry sweeps on the same past-window
      VESTED batch expire it exactly once, never twice (serialized by
      the per-batch account lock plus the `expire:<batchId>`
      idempotency key).

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 17 (earn/redeem/
      reverse/expire) — `test/e2e-storefront/loyalty.spec.ts`, driving a
      real mobile-OTP sign-in, a real COD purchase (EARN, PENDING), a
      real staff-gated delivery + vesting-window closure + vesting
      sweep (VEST), a second real checkout redeeming the now-AVAILABLE
      points through the checkout page's own redemption input (REDEEM,
      server-authoritative), a real self-service cancellation on a
      separate order (REVERSE, still-PENDING path), and a real
      staff-gated expiry sweep call (EXPIRE) — every stage verified
      both in the browser and against the real ledger via Prisma.
- [x] FLOW 18 (coupon + promotion + loyalty + store-credit stacking,
      M24) genuinely exercises AVAILABLE loyalty points, not the
      now-PENDING immediate-earn assumption — see
      `acceptance/m24-promotions.md`.

## Security / privacy

- [x] Cross-customer IDOR: both customer-facing loyalty routes
      (`GET /storefront/account/loyalty`, `GET
      /storefront/account/loyalty/ledger`) read `customerId` only from
      the verified JWT, never a body/query/param — proven negatively
      (a second customer's account is genuinely empty, never customer
      A's data; unauthenticated and guest-session requests are
      rejected with 401 — loyalty has no guest concept at all).
- [x] The one staff manual-mutation route (`POST /loyalty/adjust`) and
      every callable sweep (`POST /loyalty/sweep/expire`,
      `/release-stale-holds`, `/vest`) are gated by the same
      `loyalty:adjust` permission, separate from any read permission —
      a staff caller without it is rejected with 403 on every one of
      them.

## Definition of Done

All boxes above are now checked. `LOY-006` is resolved by the Product
Owner and its resulting vesting-lifecycle repair is implemented and
adversarially tested; the one remaining open item is the narrow,
separately-scoped `POST-VEST ADMIN-EXCEPTION SHORTFALL` question in
`specs/22-loyalty.md` (a hypothetical future admin-override path this
build does not implement or need to resolve for the normal customer
lifecycle). This agent does not self-declare M23 (or this repair)
certified — that determination belongs to the independent reviewer,
per the discipline this project has followed since Phase 1.
