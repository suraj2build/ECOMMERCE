# M22 — Customer 360 Acceptance Criteria

**Spec(s):** `specs/21-customer-profile.md`
**Status:** IMPLEMENTED (build 2026-09-26, on the
`POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline). Data-retention
*policy* specifics remain `UNDER_REVIEW` (`CUST-001`) and are out of
this milestone's testable scope. Loyalty balance/history and coupons
are **`DEPENDENCY_DEFERRED — M23/M24`** — see note below.

**CI-caught concurrency fix (2026-09-26):** the initial push's own CI
run found a genuine deadlock (Postgres error 40P01, surfaced as a raw
500) in the address-book's `SELECT ... FOR UPDATE` row-locking pattern
under real concurrent load — a bare multi-row `SELECT ... FOR UPDATE`
gives Postgres no ordering guarantee, so two genuinely concurrent
transactions locking the SAME customer's address set could acquire
those row locks in different orders and deadlock. Fixed by adding
`ORDER BY "id"` to all four such queries in
`CustomerProfileService` (create/update/delete/set-default), forcing
every transaction to acquire these locks in the same global order —
proven with 5 repeated local runs of the full concurrency suite (zero
flakiness) plus the same green result in the next CI run.

**Independent-review certification-repair (2026-09-26):** an
independent review of the above state (commit `a27dfed`) found four
issues requiring repair before M22 could be considered for
certification. All four are fixed; see `CLAUDE.md` §0 for the full
narrative. Summary:

1. **PII in audit payloads.** `CustomerProfileService` was recording
   raw PII (email; address city/pincode/recipient) in
   `AuditLog.oldValue`/`newValue`. Fixed: every M22 audit event now
   records only non-sensitive change metadata (`changedFields`,
   `isDefault`/`wasDefault` flags, category/size IDs) — never an email,
   mobile, address line, city, or pincode value — while
   `actorCustomerId`/`entityId`/`action` still provide full
   traceability. Proven by dedicated tests in
   `test/integration/customer-profile.test.ts` ("PII-safe audit
   trail") that assert the raw PII strings never appear in a
   persisted `AuditLog` row.
2. **Recently-viewed had no time-based retention.** Only
   `RECENTLY_VIEWED_MAX_ITEMS` (a count bound) was implemented; a
   customer viewing fewer items than that count could keep an
   arbitrarily old view forever. Fixed: a new, separately-configurable
   `RECENTLY_VIEWED_RETENTION_DAYS` (default 90) bounds the log by
   time as well — expired rows are pruned on the next write and
   filtered out on read. Both bounds are product-behavior storage
   bounding, explicitly **not** a resolution of the still-`UNDER_REVIEW`
   `CUST-001`/`AUD-002` data-retention/deletion policy.
3. **`ORDER_UPDATES` non-opt-outable rule was invented.** The original
   build rejected `optedIn=false` for `ORDER_UPDATES` with an HTTP 400,
   framing it as settled policy. No approved decision (`CUST-002` only
   requires per-channel × per-message-type granularity) authorized
   that rule. Fixed: the 400 rejection is removed; `ORDER_UPDATES`
   remains in the vocabulary and still defaults to opted-in, but the
   customer can now set any value for it like every other message
   type. Downstream notification-delivery enforcement for legally-
   required transactional messages remains an open, undecided policy
   question outside this milestone's scope.
4. **Zero-address concurrency race.** The address-book's row-set lock
   had no row to lock for a brand-new customer with zero addresses —
   reproduced with a genuine `Promise.all` race
   (two concurrent first-address creates both observed
   `existingCount === 0` and both attempted `isDefault = true`,
   surfacing as a raw 500 from the partial unique index). Fixed by
   locking the customer's own row (always exists) as the single shared
   serialization point across create/update/set-default/delete,
   replacing the address-row-set lock entirely. This repair's own
   adversarial testing also found and fixed a second, related bug:
   `atomicSetDefault`'s single-statement form
   (`SET "isDefault" = (id = target)`) could self-conflict against the
   same partial unique index depending on PostgreSQL's internal
   (unspecified) row-processing order within one UPDATE statement —
   fixed by splitting it into an order-independent "clear old, then
   set new" pair, both covered by the same customer-row lock.

New adversarial tests: 3 zero/first-address concurrency races
(create-vs-create, create-vs-set-default, delete-vs-create), a
recently-viewed retention-window test (inside/outside), and PII-absence
assertions on every M22 audit call site —
`test/integration/customer-profile.test.ts`, now 38 tests total. Full
clean-state suite green (lint, typecheck, build, unit, full integration
suite — 483/496, the only 13 failures being the pre-existing
Meilisearch-unavailable-in-sandbox limitation — migration-from-zero,
zero schema drift, full Playwright E2E including mobile), zero
regressions to the entire M00–M21 baseline. This repair does not
self-declare M22 certified — that determination belongs to the
independent reviewer.

## `DEPENDENCY_DEFERRED — M23/M24`

The spec's originally-listed required features include "loyalty
balance/history" and "coupons." **M23 (Loyalty) and M24 (Promotions/
Coupons) are not built and remain unauthorized** — this build does not
fabricate a points ledger, tiers, or a coupon list to satisfy those two
acceptance lines. The customer account UI represents Loyalty and
Coupons honestly as a disabled, "Coming soon" navigation item — no
route, no data, no fake balance. This is recorded as an explicit,
intentional scope boundary of the M22 authorization itself (see
`CLAUDE.md` §0), not a silent gap. All other listed features below are
fully implemented and tested.

## Business acceptance

- [x] Customer profile — `CustomerProfileService.getProfile`/
      `updateProfile` (`services/commerce-api/src/modules/customer-profile/`),
      storefront `/account` page.
- [x] Address book — `CustomerAddress` model, full CRUD + default
      selection, `/account/addresses` page.
- [x] Order history, shipment tracking — reuses the EXISTING M15/M17
      `/storefront/orders` routes and `/orders`, `/orders/[id]` pages
      directly; the account nav links to them rather than duplicating.
- [x] Wishlist — reuses the EXISTING M12 `/storefront/wishlist` routes
      and `/wishlist` page directly.
- [x] Recently viewed — `RecentlyViewedProduct` model, bounded to
      `RECENTLY_VIEWED_MAX_ITEMS` (default 50, configurable — product-
      behavior storage bounding, not the CUST-001 retention policy),
      deduplicated per style, `/account/recently-viewed` page.
- [x] Saved/preferred sizes ("My Sizes") — `CustomerSavedSize` model,
      scoped by top-level `Category` (the only genuine FK-based scoping
      signal available — `Size`/`Category` carry no gender/department
      field), one saved size per category, `/account/sizes` page.
- [x] Ratings/reviews access — new `CustomerProfileService.listMyReviews`
      read surface over the EXISTING M11 `Review` model (no duplicate
      storage), `/account/reviews` page.
- [x] Loyalty balance/history — `DEPENDENCY_DEFERRED — M23/M24` (see
      above).
- [x] Store-credit balance/history — reuses the EXISTING M20
      `GET /storefront/store-credit` route and
      `StoreCreditService.getBalanceForIdentity` directly (zero new
      backend code needed), `/account/store-credit` page.
- [x] Coupons — `DEPENDENCY_DEFERRED — M23/M24` (see above).
- [x] Communication preferences — `CommunicationPreference` model,
      granular per channel (SMS/WhatsApp/Email/Push) × per message type
      (`ORDER_UPDATES`/`OFFERS_AND_PROMOTIONS`/`PRODUCT_RECOMMENDATIONS`/
      `NEWSLETTER`), `/account/preferences` page.
- [x] Communication preferences are settable per channel and per
      message type — not one global toggle. `ORDER_UPDATES` is the one
      transactional message type in this vocabulary, defaults to
      opted-in, and (per the 2026-09-26 certification repair) is a
      fully ordinary, opt-outable message type like any other — no
      non-opt-outable rule is invented or enforced here. Downstream
      notification-delivery enforcement for legally-required
      transactional messages is a separate, undecided policy question
      (`CUST-001`/`AUD-002` remain `UNDER_REVIEW`).

## Functional acceptance

- [x] Address book supports the Indian address structure (IND-003 field
      shape: line1/line2/landmark/city/state/stateCode/pincode) plus
      recipient name/mobile, with multiple saved addresses and exactly
      one default — enforced by a partial unique index
      (`customer_addresses_one_default_per_customer`), never just an
      application-level check.
- [x] Order history correctly reflects live order/shipment status —
      unchanged, since M22 reuses the M15/M17 routes directly rather
      than deriving a second state machine.

## Authorization

- [x] A customer can access **only their own** profile/orders/data —
      every M22 route uses `requireCustomerAuth`, reading the customer
      id exclusively from `request.customer!.id` (the verified JWT),
      never from a body/query/param. Verified by direct-ID-manipulation
      IDOR tests for every new resource type (addresses, recently-
      viewed, saved sizes, communication preferences, store credit) —
      `test/integration/customer-profile.test.ts` and
      `test/e2e-storefront/account.spec.ts`'s flow J.
- [x] The internal CS-facing Customer 360 admin view remains a distinct,
      separately-authorized screen (`specs/28-admin.md`) — not built or
      touched by this milestone, and no M22 route is reused by it.

## Negative scenarios / edge cases

1. [x] Customer attempts to view/modify another customer's address by
   direct ID → clean 404 (never a distinguishable 403), matching the
   established `loadOwnedOrder` IDOR-safe pattern.
2. [x] Recently-viewed list excludes items once the bounded
   `RECENTLY_VIEWED_MAX_ITEMS` window is exceeded (oldest dropped,
   proven under both sequential and genuinely concurrent repeated
   views) — implementation-defined bound, does not grow unbounded.
   **Also** excludes items older than `RECENTLY_VIEWED_RETENTION_DAYS`,
   independent of the count bound (certification-repair finding 2).
3. [x] An unpublished/draft style is gracefully excluded from the
   recently-viewed list rather than erroring.
4. [x] Deleting the current default address promotes another remaining
   address to default (most-recently-updated); deleting the only
   remaining address leaves zero addresses, no error.
5. [x] Opting out of `ORDER_UPDATES` succeeds like any other message
   type and persists (certification-repair finding 3 — the original
   build's 400 rejection was an invented rule with no approved-decision
   basis and has been removed).
6. [x] Two genuinely concurrent first-address creates for a brand-new
   (zero-address) customer converge to exactly one default, no raw 500
   (certification-repair finding 4).

## Mobile / Desktop behavior

- [x] Account/profile screens are fully usable on both viewports —
      proven by a genuine mobile-viewport (390×844) Playwright test
      (no horizontal overflow, ≥44px touch targets on Save/Edit) plus
      full desktop-viewport coverage of every flow.

## Concurrency (adversarial)

- [x] Two simultaneous default-address changes converge to exactly one
      default (an order-independent "clear old, then set new" pair of
      UPDATE statements, both covered by the same customer-row lock —
      certification-repair finding 4 replaced the original single-
      statement form, which could self-conflict against the partial
      unique index depending on PostgreSQL's internal row-processing
      order).
- [x] Concurrent delete-of-default vs. set-default on the same customer
      converge to exactly one default, never zero or two (both lock the
      customer's own row via `FOR UPDATE` as the shared serialization
      point — stable even when the customer has zero addresses).
- [x] Two genuinely concurrent first-address creates, a create racing
      a set-default, and a delete-of-default racing a create, all for
      a customer starting with zero or one address, converge to exactly
      one default with no raw 500 (certification-repair finding 4).
- [x] Concurrent repeated recently-viewed views of the same product
      never create duplicate rows (`@@unique([customerId, styleId])`
      upsert).
- [x] Concurrent duplicate "My Sizes" saves for the same category
      converge to exactly one saved size (`@@unique([customerId,
      categoryId])` upsert).
- [x] Concurrent communication-preference updates for different
      message types both persist (per-row upsert, no shared lock
      needed since rows don't overlap).
- [x] A concurrent store-credit read during a concurrent ledger post
      never sees a torn/inconsistent balance (reuses M20's own
      transactional guarantee unchanged).

## Test requirements

- [x] Authorization test: cross-customer data access is blocked for
      every new resource type (`acceptance/e2e-commerce-flows.md`
      FLOW 19 pattern applied customer-to-customer) —
      `test/integration/customer-profile.test.ts` (38 tests) and
      `test/e2e-storefront/account.spec.ts` flow J.
- [x] PII-safe audit trail: every M22 audit event's `oldValue`/
      `newValue` is asserted to never contain an email, mobile, address
      line, city, or pincode value (certification-repair finding 1).
- [x] E2E: real mobile-OTP sign-in through the browser (never a
      token-injection shortcut — the test brute-forces the genuine
      SHA-256 OTP hash space, driving the SAME production verification
      path a real customer uses), profile edit + reload persistence,
      full address CRUD + default handling, real-PDP-visit recently-
      viewed dedupe/bound proof, My Sizes, real review submission via
      the existing M11 flow, real M20 store-credit ledger read,
      communication-preference matrix persistence, order-history/
      wishlist nav reuse, and cross-customer IDOR — 4 tests,
      `test/e2e-storefront/account.spec.ts`.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Data-retention-
policy-specific criteria remain deferred pending `CUST-001` resolution
and do not block this milestone's completion for the features above.
Loyalty/coupon visibility is `DEPENDENCY_DEFERRED — M23/M24`, not
implemented, and honestly represented as such in the UI. This build
does not self-declare M22 certified — that determination belongs to
the independent reviewer, per this project's own binding discipline.
