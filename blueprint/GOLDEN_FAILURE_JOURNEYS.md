# Golden & Failure Journeys (M33 Full System E2E + Production-Readiness)

## Method

Audited the EXISTING browser E2E (Playwright) and backend integration
suites for genuine, already-proven coverage of every required journey/
scenario before considering whether any new test was needed - this
project has accumulated 13 Playwright spec files and 900+ integration
tests across M00-M30, each one already built against this project's own
"real flow, never mock the module under test" discipline (every E2E
spec drives a real mobile-OTP sign-in, a real hash-recovered OTP code,
real HTTP calls through `app.inject()`/a real browser - documented
repeatedly across this file's own milestone history). This pass adds
NO new mocking anywhere and writes NO duplicate coverage for what
already genuinely exists.

## Golden customer journeys (no internal-module mocking)

| Journey | Coverage | Real, not mocked |
|---|---|---|
| **Guest**: browse home → PDP → add to cart → guest checkout (COD) | `test/e2e-storefront/home.spec.ts`, `pdp.spec.ts`, `cart-wishlist.spec.ts`, `checkout.spec.ts` | Real browser, real `x-guest-session-id` (CART-004 signed token as of M31), real order placed against real Postgres |
| **Customer**: mobile-OTP sign-in → account/orders/loyalty/wishlist/reviews/store-credit/returns/exchanges → real purchase | `test/e2e-storefront/account.spec.ts`, `orders.spec.ts`, `loyalty.spec.ts`, `returns.spec.ts`, `exchanges.spec.ts`, `refunds.spec.ts`, `promotions.spec.ts`, `cancellation.spec.ts` | Every one brute-forces the real 6-digit OTP hash space (10^6 SHA-256, <1s) and drives the SAME production OTP-verification path a real customer uses - never a token-injection shortcut (established M22, reused by every later customer-facing E2E spec) |
| **Staff/Warehouse**: role-gated `apps/admin` login → CMS/inventory-adjustment/Customer 360/channel-publishing screens, with server-side RBAC enforcement independent of what the UI hides | `test/e2e-admin/flow19-20.spec.ts` (FLOW 19: submits the inventory-adjustment form through the real rendered UI as an unauthorized role and asserts the real 403, never merely checking the link is hidden; FLOW 20: authorized action succeeds) | Real `apps/admin` browser session, real RBAC check server-side |

**No new golden-journey E2E test was written this pass** - all three
required journey types already have genuine, non-mocked, multi-
milestone browser coverage; this pass's own contribution is the audit
above, cross-referencing each journey to its concrete spec file rather
than assuming coverage exists.

## Failure journeys

| Scenario | Coverage | Proof mechanism |
|---|---|---|
| **Duplicate submit** | idempotency-key coverage across 22 integration test files (checkout, cancellation, returns, refunds, exchanges, loyalty, promotions, marketing, channels, gift cards) | a retried request with the same idempotency key converges to the same single side effect, proven per-domain |
| **Payment timeout/replay** | `payment.test.ts` webhook dedup/replay tests, `PaymentService.expireStalePayments` | a duplicate Razorpay webhook event is a safe no-op; a stale in-flight payment claim is reclaimed, never double-captured |
| **Oversell races** | `inventory-concurrency.test.ts` 100-way `Promise.all` race (15 stock, 100 concurrent reservations → exactly 15 succeed) | real Postgres row-lock concurrency, re-run clean this pass (`performance/CONCURRENCY_REVIEW.md`) |
| **Provider timeout/ambiguous outcome** | M25 `AMBIGUOUS_RECONCILIATION_REQUIRED` (marketing), M26 same pattern (channels) - a provider call that throws/times out is recorded distinctly from a definite `FAILED`, never silently retried or conflated | `marketing.test.ts`, `channels.test.ts` |
| **Expired/stale checkout or claim (service-restart simulation)** | `payment.test.ts`/`refunds.test.ts`/`marketing.test.ts`/`channels.test.ts` all include a manufactured stale-`PROCESSING`-claim scenario, proving a crashed process's in-flight claim is durably reclaimed rather than lost - 8 files total exercise this exact "crash/reclaim" shape | durable DB-backed claim taken BEFORE any external call, per M25 Blocker 4's own established idiom, reused throughout M26/M30 |
| **Guest identity persistence** | CART-004 (M31): a guest identity is a server-issued signed token, deliberately stateless/non-expiring by design (`modules/cart/identity.ts`'s own doc comment) - there is no server-side TTL to test as a "failure," since expiry was a deliberate non-goal; what IS tested is tamper/forgery rejection (`cart-identity.test.ts`, 11 tests: tampered signature, wrong-secret token, swapped id/signature, malformed token) | unit tests, all passing |
| **Checkout-session expiry** (a distinct, real expiry concept from the guest-identity token above) | `payment.test.ts`/`promotions.test.ts`/`returns.test.ts` each exercise an expired/stale checkout or return window boundary | boundary-condition assertions |

## Interpretation

Every required failure category has genuine, already-existing,
adversarially-tested coverage - re-confirmed green in this pass's own
clean full-suite re-run (`performance/CONCURRENCY_REVIEW.md`). This
pass's own audit is the M33 deliverable here: cross-referencing
"acceptance/m33's own required scenario list" against concrete,
already-proven test files, rather than assuming or re-building
duplicate coverage.
