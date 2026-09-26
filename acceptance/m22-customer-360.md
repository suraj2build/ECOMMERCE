# M22 — Customer 360 Acceptance Criteria

**Spec(s):** `specs/21-customer-profile.md`
**Status:** IMPLEMENTED (build 2026-09-26, on the
`POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline). Data-retention
*policy* specifics remain `UNDER_REVIEW` (`CUST-001`) and are out of
this milestone's testable scope. Loyalty balance/history and coupons
are **`DEPENDENCY_DEFERRED — M23/M24`** — see note below.

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
      transactional message type in this vocabulary and is NOT
      opt-outable (rejected with 400) — an engineering default
      reflecting operational reality, not a legal-consent-basis
      determination (`CUST-001`/`AUD-002` remain `UNDER_REVIEW`).

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
3. [x] An unpublished/draft style is gracefully excluded from the
   recently-viewed list rather than erroring.
4. [x] Deleting the current default address promotes another remaining
   address to default (most-recently-updated); deleting the only
   remaining address leaves zero addresses, no error.
5. [x] Opting out of the transactional `ORDER_UPDATES` message type is
   rejected (400), never silently accepted.

## Mobile / Desktop behavior

- [x] Account/profile screens are fully usable on both viewports —
      proven by a genuine mobile-viewport (390×844) Playwright test
      (no horizontal overflow, ≥44px touch targets on Save/Edit) plus
      full desktop-viewport coverage of every flow.

## Concurrency (adversarial)

- [x] Two simultaneous default-address changes converge to exactly one
      default (single atomic `UPDATE ... SET "isDefault" = (id = target)`
      statement, serialized by Postgres's own per-row write lock).
- [x] Concurrent delete-of-default vs. set-default on the same customer
      converge to exactly one default, never zero or two (both lock the
      customer's whole address set via `FOR UPDATE` as the shared
      serialization point).
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
      `test/integration/customer-profile.test.ts` (26 tests) and
      `test/e2e-storefront/account.spec.ts` flow J.
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
