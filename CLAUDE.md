# Instructions for Claude Code in this repository

This file is read automatically by Claude Code. It is binding operating
guidance for any Claude Code session working in this repository,
including future sessions that have no memory of this one.

## 0. Current project stage — READ FIRST

**Status as of 2026-09-26: `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED —
M22 CUSTOMER 360 BUILD COMPLETE — AWAITING INDEPENDENT REVIEW. M23+ NOT
AUTHORIZED.`**

**On 2026-09-26 the independent reviewer recorded the repaired
Post-Purchase Phase build — commit
`13876a5f98cf3fb7a671ad2ca86d3e62edcd1a24` on
`claude/loving-fermat-cyucke` — as `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED`**,
covering M19 (Returns), M20 (Refunds & Store Credit), M21 (Exchanges),
the EXC-004 Option-2 fulfilment-integration repair, and the EXC-004
concurrency (write-skew) repair — engineering-implementation scope
only, not production-readiness (the same open pre-production gates
listed throughout this file — `TAX-001`–`005`, `CUST-001`, `AUD-002`,
`CART-004`, `SEC-001`, production performance verification — remain
open, none resolved by this certification). This commit is the
**protected starting baseline** for all work below; it must not be
regressed. The full history of the Post-Purchase Phase build, its
five-finding independent-review repair, the EXC-004 Option 2 fulfilment
decision/repair, and the EXC-004 concurrency repair is preserved
unchanged in the historical narrative later in this section — this
certification recording does not rewrite any of it.

The human project owner then gave explicit **"START BUILD — M22
CUSTOMER 360"** authorization on 2026-09-26, scoped specifically and
only to milestone **M22** (Customer Profile / account self-service —
`specs/21-customer-profile.md`), building on the
`POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline above, with an
explicit instruction not to continue automatically into M23+. The
authorization explicitly excludes building M23 (Loyalty) or M24
(Promotions/Coupons) functionality inside M22 — those sections of the
customer account must be represented honestly as
`DEPENDENCY_DEFERRED — M23/M24` (an honest "not yet enabled" state,
never fabricated balances or coupon lists) until their own milestones
are separately authorized and built. **M23 and every later milestone
remain unauthorized** regardless of how cleanly M22 lands.

**M22 (Customer 360) is now built.** It genuinely reuses certified
domains rather than duplicating them: order history/detail, shipment
tracking, and wishlist all link directly to the EXISTING M12/M15/M17
storefront routes and pages (`/orders`, `/orders/[id]`, `/wishlist`) —
zero new backend code for those three; store-credit balance/history
reuses the EXISTING M20 `GET /storefront/store-credit` route verbatim.
Net-new work: a `CustomerAddress` model (the IND-003 address shape)
with exactly one default per customer enforced by a partial unique
index — never just an application-level check — proven under genuine
concurrency for both a simultaneous set-default race and a concurrent
delete-of-default-vs-set-default race (both converge to exactly one
default via a shared `FOR UPDATE` lock on the customer's whole address
set, the same row-lock-as-serialization-point idiom this codebase has
used since `StoreCreditService.lockOrCreateAccount`); a bounded,
deduplicated `RecentlyViewedProduct` log (configurable
`RECENTLY_VIEWED_MAX_ITEMS`, explicitly **product-behavior storage
bounding, not the still-`UNDER_REVIEW` `CUST-001` legal retention
policy**); `CustomerSavedSize` ("My Sizes") scoped by top-level
`Category` — the only genuine FK-based scoping signal available, since
neither `Category` nor `Size` carries a gender/department field;
a `CommunicationPreference` matrix granular per channel (SMS/WhatsApp/
Email/Push) × per message type (CUST-002), with the one transactional
message type (`ORDER_UPDATES`) rejected from opt-out — an engineering
default reflecting operational reality, not a legal-consent-basis
determination; a new `listMyReviews` read surface over the EXISTING
M11 `Review` model (no duplicate storage); and `AuditLog.actorCustomerId`,
closing a genuine pre-existing gap this build's own investigation
found (`actorType: CUSTOMER` had no column recording WHICH customer
acted). **Loyalty (M23) and Promotions/Coupons (M24) are explicitly
`DEPENDENCY_DEFERRED — M23/M24`** in both the API and the account UI —
a disabled, honest "Coming soon" navigation item, never a fabricated
balance or coupon list, exactly as this authorization required. Every
new customer-facing route is `requireCustomerAuth`-only (never a guest
fallback, never a customerId read from anywhere but the verified JWT),
with cross-customer IDOR proven negatively for every new resource type.
26 new adversarial integration tests
(`test/integration/customer-profile.test.ts`, including 6 genuine
`Promise.all` concurrency tests — never `await A; await B;`) plus 4 new
browser E2E tests (`test/e2e-storefront/account.spec.ts`) driving a
REAL mobile-OTP sign-in through the browser: since this codebase's OTP
verification only ever stores a plain SHA-256 hash of the 6-digit code
(no plaintext backdoor exists or was invented here), the E2E test
brute-forces the genuine hash space (10^6 SHA-256 hashes, well under a
second) to recover the actual code the server generated, then drives
the SAME production verification path a real customer uses — never a
token-injection shortcut. This proves profile edit + reload
persistence, full address CRUD + default handling, a real-PDP-visit
recently-viewed dedupe/bound check, My Sizes, a real review submission
via the existing M11 flow, the real M20 store-credit ledger, the
communication-preference matrix persisting exactly as set, order-
history/wishlist nav reuse, a genuine mobile-viewport render check, and
cross-customer IDOR. This build's own clean-state validation caught and
fixed two genuine bugs, not worked around: the storefront's CORS plugin
never allowed the `PUT` method (`services/commerce-api/src/plugins/cors.ts`)
— the first storefront routes to need it (My Sizes, communication
preferences) — which surfaced as an opaque browser "Failed to fetch"
with no HTTP-level error; and the E2E OTP-sign-in helper read the
`OtpCode` row before the async `POST /otp/request` had actually
committed, a genuine race that only surfaced under full-suite parallel
load, fixed by waiting for the UI's own OTP-entry step first. Full
clean-state suite (migration-from-zero — 26 migrations, zero schema
drift — lint, typecheck, build, unit, full integration suite against
real Postgres/Redis — 477/490 passing, the only 13 failures being the
pre-existing, environment-only Meilisearch-unavailable-in-sandbox
limitation, unrelated to this build — full Playwright E2E including
mobile) green, zero regressions to the entire M00–M21 baseline. See
`acceptance/m22-customer-360.md` for the complete Definition of Done.
**This agent does not self-declare M22 certified** — per the same
discipline applied at every milestone since Phase 1, that determination
belongs to the independent reviewer. This agent has stopped and is
awaiting independent review before any M23+ work.

M19
(Returns), M20 (Refunds & Store Credit), and M21 (Exchanges) were all
implemented and adversarially tested sequentially, with per-milestone
validation and commit, exactly as authorized (commits `9e7b7f2`,
`e716fd3`, `ba46b39` on `claude/loving-fermat-cyucke`). M19 built a
self-contained `Return`/`ReturnLine`/`ReturnPickup` state machine,
genuinely reusing M17's own reverse-pickup pattern for the logistics
leg and enforcing INV-006's QC-gated disposition rule; this build's own
clean-state validation caught and fixed a genuine pre-existing bug in
`InventoryService.reconcileBalance` (the SALE replay case never
decremented `reserved`, only `onHand`, undetected until M19's own
receipt→QC→disposition lifecycle first exercised a reconciliation
check after a genuine SALE). M20 settles the durable refund handoffs
M18 (`Order.refundRequired`) and M19 (`ReturnLine.refundEligible`)
deliberately left unexecuted — one `Refund` row per `OrderLine` (never
per-order, so partial refunds are correct by construction), PREPAID via
the M14 `RazorpayPaymentProvider.refund()` method (fully implemented in
M14 but never called until this build wired it up), COD via a new
`StoreCreditAccount`/`StoreCreditEntry` ledger kept structurally
separate from loyalty (which does not exist in this codebase); this
build's own adversarial concurrency tests caught and fixed two genuine
races — concurrent refund-processing on the same order line each
independently attempting credit-note issuance before either committed,
and two different order lines refunded concurrently for the same
guest/customer racing on first-ever `StoreCreditAccount` creation (the
first fix attempt tried to catch-and-recover mid-transaction, which is
invalid in Postgres since a failed statement aborts the whole
transaction; properly fixed by retrying the whole transaction once on
that specific race). M21 built a first-class `Exchange` entity —
genuinely reusing M19's own eligibility/reverse-logistics/QC machinery
(a shared `resolveReturnPolicy` extracted into
`modules/returns/policy.ts`) rather than duplicating it, with
settlement direction derived once, at request time, from the
replacement's price difference alone; a `CUSTOMER_PAYS` settlement
collects the difference through a NEW, fully separate dispatch branch
in `PaymentService.handleRazorpayWebhook` that never touches M14's own
independently-reviewed `applyOutcome`/`applyCaptureOutcome` capture-
atomicity guarantees for real checkout payments. This build's own
testing caught a genuine cross-domain gap — nothing previously stopped
an order line from having both an active Return and an active Exchange
simultaneously — fixed with a mutual-exclusion check added to both
`ReturnService` and `ExchangeService` (a cancelled record on either
side does not permanently block the other, since it represents nothing
having actually happened). Two scope boundaries were documented rather
than guessed or silently skipped: M19's mobile photo/evidence capture
for return condition was not built (no photo-upload flow exists
anywhere in this codebase), and M21's physical forward fulfilment
(pick/pack/ship/tracking) of an allocated replacement item is
explicitly out of this pass — `Exchange.replacementAllocatedAt` marks
inventory commitment only, the actual warehouse shipment of that unit
is a manual/follow-on process not tracked by this build. Combined: 70
new adversarial integration tests (31 for M19, 20 for M20, 19 for M21)
plus 3 new browser E2E tests, with zero regressions to the entire
M00–M18 baseline confirmed across every regression run performed
throughout this phase. See `RET-005`, `REF-005`, and `EXC-004` in
`blueprint/DECISION_REGISTER.md` for the complete design record of each
milestone, and `acceptance/m19-returns.md`, `m20-refunds-store-credit.md`,
`m21-exchanges.md` for each milestone's Definition of Done.
**This agent does not self-declare M19/M20/M21 certified** — per the
same discipline applied at every milestone since Phase 1, that
determination belongs to the independent reviewer. This agent has
stopped and is awaiting independent review before any M22+ work.

**An independent review of that Post-Purchase Phase build (starting from
review head `73de2cf17c0e73a205efbddf8250f6f288602913`) returned five
findings — none BLOCKER-labeled outright, but all requiring repair —
fixed 2026-09-26 under a separate, explicitly scoped repair
authorization.** **Finding 1** (M21): the 14-day `EXCHANGE_REPLACEMENT_HOLD_DAYS`
default had been recorded as an engineering default, which the original
build instruction explicitly prohibited — corrected to record it as
what it actually is, an explicit Product Owner decision made during
this repair review; the expiry-to-`REPLACEMENT_UNAVAILABLE` behavior
itself was already correct and unchanged. **Finding 2** (M19): mobile
condition-photo/evidence upload, left honestly unbuilt at the original
build, is now implemented — config-driven (`ReturnPolicy.evidenceRequired`,
never universally mandatory), a new minimal private-object-storage
abstraction (no usable S3/MinIO client existed anywhere in this
codebase before this repair, and none is reachable in CI/this sandbox
to test against, so the shipped, tested provider is local-disk, behind
an interface a real S3 provider can later implement unchanged),
magic-byte MIME sniffing that never trusts the client-declared
Content-Type (closing "reject executable payloads" against the vector
that actually matters), and full ownership/RBAC/IDOR coverage — proven
with a genuine mobile-viewport Playwright test using `setInputFiles`
against a real `capture="environment"` input. **Finding 3** (M21, the
substantive one): independent review correctly rejected the original
build's `status = COMPLETED` the moment a replacement was allocated —
reaching a firm inventory allocation is not the same thing as the
replacement reaching the customer. Repaired with a new intermediate
`REPLACEMENT_ALLOCATED` status and a new, separately-permissioned
(`exchange:fulfil`) explicit staff confirmation
(`markReplacementFulfilled`) as the ONLY path to `COMPLETED`. Whether/
how to integrate the replacement's actual physical fulfilment with
M16/M17's certified `PickTask`/`OrderFulfilment`/`Shipment` pipeline —
which is hard-anchored to a real, invoiced `OrderLine`, something an
Exchange deliberately never creates a second one of — is NOT resolved
by this repair: it is recorded as an open **`DECISION_REQUIRED —
EXCHANGE REPLACEMENT FULFILMENT MODEL`** with three concrete
architecture options in `EXC-004` (`blueprint/DECISION_REGISTER.md`),
for the Product Owner to decide in a future, separately-authorized
pass. **Finding 4** (M20): a deeper refund-concurrency recheck found
that `RefundService.settle()` had no in-flight claim before calling the
external Razorpay/store-credit operation at all — two genuinely
concurrent `settle()` calls both proceeded straight to the external
call, relying entirely on THAT system's own idempotency rather than any
protection this system provided. Fixed with a genuine database-level
`PROCESSING` compare-and-swap claimed before any external call (the
exact idiom a prior schema comment had argued against, for reasons that
turned out to be backwards) plus age-based stale-claim recovery
mirroring `PaymentService.expireStalePayments`; the repair explicitly
documents, rather than papers over, the residual and genuinely
time-bounded limit of Razorpay's own idempotency-key contract, which no
application code can strengthen further. **Finding 5** (M19/M21): the
Return/Exchange cross-domain mutual-exclusion check added at the
original build was only an application-level check-then-insert, not a
real concurrency guard — two genuinely concurrent transactions could
each read "no conflict" before either committed, since `return_lines`/
`exchanges` carry independent unique constraints that don't block each
other. Fixed by row-locking the shared `OrderLine` (`SELECT ... FOR
UPDATE`) as the first statement of both `ReturnService.performInitiate`
and `ExchangeService.performInitiate`, proven with a genuinely
concurrent (`Promise.all`-fired) adversarial test, not a sequential
simulation. Combined repair: 3 new integration tests (M21 real-
concurrency + fulfilment-state-distinction), 12 new integration tests
(M19 evidence upload), 4 new integration tests (M20 concurrency
recheck), and 2 new/updated browser E2E tests — 68 integration tests
across the three files (43 M19, 23 M20, 22 M21) and the full storefront
E2E suite, zero regressions to the entire M00–M18 baseline, confirmed
across repeated runs (concurrency-sensitive suites run twice) and a
full migration-from-zero clean-state proof. See `RET-005`, `REF-005`,
and `EXC-004`'s own 2026-09-26 repair addenda in
`blueprint/DECISION_REGISTER.md` for the complete per-finding design
record. **This agent does not self-declare this repair certified** —
the same discipline as every milestone since Phase 1. This agent has
stopped and is awaiting independent re-review; `EXC-004`'s
`DECISION_REQUIRED` is explicitly flagged for the Product Owner's
attention, not silently left for a future agent to rediscover. M22+
remains unauthorized regardless of how this re-review resolves.

**On 2026-09-26 the Product Owner resolved `EXC-004`'s
`DECISION_REQUIRED` with an explicit architecture decision: "SELECT
OPTION 2."** Exchange replacement physical fulfilment now genuinely
reuses M16/M17's certified `PickTask`/`OrderFulfilment`/`Shipment`
pipeline, generalized to a polymorphic fulfilment source, rather than
creating a second `Order`, fabricating a replacement `OrderLine`, or
building a parallel exchange-only pipeline — implemented the same day
under a separate, explicitly scoped repair authorization bounded to
this one decision. `PickTask.orderLineId` is now nullable alongside a
new nullable `exchangeId` (`@unique`), with a same-row XOR CHECK
constraint (`pick_tasks_source_xor_check`) — a genuine per-row
guarantee. `OrderFulfilment` gained a nullable `exchangeId` (`@unique`)
whose exclusivity against its child `order_lines` is a real CROSS-TABLE
invariant no CHECK constraint can express — enforced instead by a
trigger pair (`check_fulfilment_line_exclusivity` on `order_lines`,
`check_exchange_fulfilment_exclusivity` on `order_fulfilments`), the
"equally strong relational design" the Product Owner's own instruction
explicitly permitted as the alternative to a raw CHECK, and the correct
SQL tool for this exact cross-table case — a deliberate, documented
deviation from this codebase's usual pure-CHECK-constraint convention,
not a shortcut.

**2026-09-26 concurrency correction (final independent review,
migration `20260926130000`):** the trigger pair as originally written
read the OTHER side's row via a plain SELECT, no lock — under READ
COMMITTED that is not itself a serialization point, so two genuinely
concurrent transactions (one setting a fulfilment's `exchangeId`, the
other attaching an `order_lines` row to that SAME fulfilment) could
each read the other's pre-commit state and both pass, a real
write-skew race that could violate the very invariant this trigger
pair exists to enforce — a genuine gap, not a theoretical one. Fixed
by giving both directions a SHARED serialization point: the SAME
`order_fulfilments` row's own lock. An UPDATE/INSERT targeting
`order_fulfilments` already holds that row's lock for the rest of its
own transaction before its BEFORE ROW trigger ever fires, so
`check_exchange_fulfilment_exclusivity` needed no change;
`check_fulfilment_line_exclusivity` now explicitly
`SELECT ... FOR UPDATE`s the target fulfilment row before reading its
`exchangeId`, acquiring that identical lock. Proven with a genuine
two-connection concurrent-transaction test
(`test/integration/exchange-fulfilment-xor-race.test.ts`) that first
reproduced the write-skew against the unfixed trigger (both sides
committed, invariant violated), then proved the fixed trigger converges
to exactly one winner every time, run repeatedly and in both
interleavings. `Shipment` needed zero schema change at all (1:1 with
`OrderFulfilment`, so its source is entirely derived). Inventory-ledger
semantics for the replacement's physical dispatch were defined
explicitly rather than reused from `SALE`: a new
`InventoryTxnType.EXCHANGE_DISPATCH`, posted by a new
`InventoryService.recordExchangeDispatch` (same combined onHand/reserved
decrement as `recordSale`, its own partial-unique-index exactly-once
guard) — deliberately never conflated with a genuine retail `SALE`,
since the replacement's price difference was already settled by
Exchange itself, not a second transaction. Any GST/invoice consequence
of this physical dispatch is explicitly flagged **TAX/COMPLIANCE
REVIEW REQUIRED** — not decided or guessed here.
`WarehouseService.createPickTaskForExchange`, called from
`ExchangeService.tryComplete`'s own reservation-conversion transaction,
auto-creates the replacement's `PickTask` the instant an exchange
reaches `REPLACEMENT_ALLOCATED` — the exact moment-of-parity with a
normal order's own ALLOCATED → PickTask creation; a pick shortfall/
exception on it routes to the already-existing
`ExchangeStatus.REPLACEMENT_UNAVAILABLE` rather than inventing a new
status, since both represent the identical fact. `OrderService`
gained `assignExchangeToFulfilment` (a new `POST /exchanges/:id/fulfilment`
route, gated by the EXISTING `exchange:fulfil` permission — no new
permission needed) and branches in `markFulfilmentShipped` (posts
`EXCHANGE_DISPATCH` instead of iterating child lines) and
`markFulfilmentDelivered` (flips `Exchange.status` to `COMPLETED`
automatically); pack/ready-to-ship/ship/deliver, and pick itself, all
reuse the EXISTING `/orders/fulfilments/:fulfilmentId/*` and
`/warehouse/pick-tasks/:id/pick` routes completely unchanged — no
parallel routes, no new base permissions. `ShippingService` needed
ZERO code changes: every method already operated generically on
`fulfilmentId`, and its one RTO branch already reconciles-for-a-human
exactly the rejection an exchange-anchored shipment's RTO produces, via
the SAME pre-existing multi-shipment fallback. `Exchange.status` now
reaches `COMPLETED` **automatically** the instant the replacement's own
shipment reaches DELIVERED — the normal happy path;
`markReplacementFulfilled` remains, demoted exactly as instructed to an
exception/recovery mechanism only, never the route a correctly-flowing
exchange takes. Every existing M16/M17 certified invariant (exactly-once
SALE, no overselling, row-lock concurrency, idempotent pick/pack/
shipment transitions, provider isolation, webhook dedup, split-shipment
behaviour, inventory-ledger authority, auditability, RBAC, IDOR/BOLA
protection) was preserved and re-proven unchanged — the entire
pre-existing `warehouse.test.ts`/`shipping.test.ts`/`exchanges.test.ts`
suites re-run green, byte-for-byte unmodified, zero regressions — plus
a new 16-point adversarial integration matrix
(`test/integration/exchange-fulfilment.test.ts`) proving the
generalized pipeline itself: normal OrderLine fulfilment unchanged; the
full pick→pack→ship→deliver→COMPLETED happy path (both via manual staff
routes and via real carrier tracking/webhook-driven delivery);
replacement cannot ship before allocation; no duplicate warehouse work;
concurrent pick/pack/shipment-creation; a duplicate `delivered` webhook
as a safe no-op; exactly-once `EXCHANGE_DISPATCH` with the original
order's own `SALE` row untouched; a pick exception correctly routing to
`REPLACEMENT_UNAVAILABLE`; a `QC_FAILED`/`CANCELLED` exchange never
getting a `PickTask` at all; RBAC/IDOR-BOLA (a role without
`exchange:fulfil`, or without the base `warehouse:pick`/`order:fulfil`
permissions, correctly rejected); idempotency-key replay; and two
unrelated exchanges on two different orders progressing independently
under real concurrency. Full clean-state validation: migration from
zero (two new migrations, `20260926120000_exchange_fulfilment_generalization`
and `20260926120100_exchange_dispatch_unique_index` — split across two
files deliberately, since Postgres forbids using a newly-added enum
value in the same transaction that added it), zero schema drift, clean
seed, lint, typecheck, build, unit tests, the complete integration
suite against real Postgres/Redis, and the full Playwright E2E suite
(including mobile) — all green, zero regressions to the entire
M00–M21 baseline. See `EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER"
addendum in `blueprint/DECISION_REGISTER.md` for the complete design
record. **This agent does not self-declare this repair certified** —
the same discipline as every milestone since Phase 1. This agent has
stopped and is awaiting independent review. M22+ remains unauthorized
regardless of how this review resolves.

**A final independent review of that Option 2 build (review head
`56f7fbe722d63b744b82068cfc7a79b6112384bf`) returned one blocker: the
`OrderFulfilment` source-exclusivity trigger pair enforced its
invariant with a PLAIN SELECT of the other side's row, no lock — under
READ COMMITTED that is not itself a serialization point, so two
genuinely concurrent transactions (one setting a fulfilment's
`exchangeId`, the other attaching an `order_lines` row to that SAME
fulfilment) could each read the other's pre-commit state and both
pass, a genuine write-skew race that could leave the committed
database in an illegal state where a fulfilment carried BOTH a
populated `exchangeId` AND a child `order_lines` row.** Fixed
2026-09-26 (migration `20260926130000_exchange_fulfilment_xor_concurrency_fix`)
by giving both directions a SHARED serialization point: the SAME
`order_fulfilments` row's own lock. An UPDATE/INSERT targeting
`order_fulfilments` already holds that row's lock for the rest of its
own transaction before its BEFORE ROW trigger ever fires, so
`check_exchange_fulfilment_exclusivity` needed no change;
`check_fulfilment_line_exclusivity` (which fires on `order_lines`, a
different table with no lock of its own on the fulfilment row) now
explicitly `SELECT ... FOR UPDATE`s the target fulfilment row before
reading its `exchangeId`, acquiring that identical lock — whichever
transaction reaches Postgres first in either direction now forces the
other to block, then correctly observe the winner's committed change
and cleanly reject, rather than both racing to a blind pre-commit
snapshot. Proven with a genuine two-connection concurrent-transaction
test (`test/integration/exchange-fulfilment-xor-race.test.ts`) that
was first run against the UNFIXED trigger to confirm it actually
reproduces the write-skew (both sides committed, invariant violated),
then against the fixed trigger to confirm it converges to exactly one
winner every time — run repeatedly, in both interleavings, with zero
flakiness. No other part of the Option 2 design changed: the Product
Owner's architecture decision stands, `EXCHANGE_DISPATCH` semantics are
unchanged, the normal `OrderLine` `SALE` invariant is unchanged, and
`TAX/COMPLIANCE REVIEW REQUIRED` remains open for exchange-dispatch
tax-document consequences — see `EXC-004`'s own concurrency-correction
addendum in `blueprint/DECISION_REGISTER.md` for the complete record.
**This agent does not self-declare this repair certified.** This agent
has stopped and is awaiting final independent review. M22+ remains
unauthorized regardless of how this review resolves.

M17 (Shipping /
Tracking) was implemented and adversarially tested (carrier-adapter
substitution, shipment-creation idempotency/concurrency/crash-retry,
webhook dedup/resume, illegal-transition rejection, redelivery-
exhaustion → automatic RTO, the exactly-one-SALE invariant, polling-
fallback graceful degradation, split-shipment independent tracking,
IDOR), CI-green at commit
`495dcfcede60e922ec251a17fd3dcbd2ea362047`. An independent review of
that build found **one BLOCKER**: `POST /webhooks/shipping/:provider`
declared a per-provider URL but never actually used `:provider` —
every webhook was authenticated/parsed by whichever provider
`SHIPPING_PROVIDER` happened to be globally configured, regardless of
the URL, breaking provider isolation once more than one provider
identity (or an in-flight shipment from an earlier provider) existed.
Fixed at commit `413f2dc`: `ShippingService.handleCarrierWebhook` now
resolves the SPECIFIC provider named in the URL for signature
verification, event parsing, shipment lookup, and event dedup/
recording — never a silent fallback to the globally configured
default; an unknown/unconfigured provider name fails safely (400). A
second registered test identity, `MOCK_SECONDARY`, was added
specifically to prove genuine per-request provider dispatch/isolation
(6 adversarial tests, `test/integration/shipping.test.ts` "Webhook
provider dispatch (independent-review repair)") — deliberately not a
real carrier. CI then caught a second, genuine (not flaky) concurrency
bug in the pre-existing `createShipment` idempotency path — two
concurrent requests with different idempotency keys could race such
that a late-arriving request read a stale fulfilment snapshot and
falsely rejected instead of converging to the already-created
shipment; fixed at commit `6e28e2b` by checking for an existing
Shipment row before the status validation. Full clean-state suite
green (lint, typecheck, build, unit, integration — zero regressions:
326 passing backend tests across 27 files — migration-from-zero,
seed), confirmed on GitHub Actions run
[36109033095](https://github.com/suraj2build/ECOMMERCE/actions/runs/36109033095).
**On 2026-09-25 the human project owner recorded this repaired
state — commit `6e28e2bd3116c49641016f7a7ed5dd61427a5819` — as
`M17_ENGINEERING_CERTIFIED`** (engineering-implementation scope; not
production-readiness — `TAX-001`–`005`, `CUST-001`, `AUD-002`,
`CART-004`, `SEC-001`, production performance verification, and
qualified privacy/DPDP and tax/GST review all remain open
pre-production gates, none resolved by this certification) and gave
explicit **"START BUILD — M18 CANCELLATION"** authorization, scoped
specifically and only to milestone **M18**, building on the
`M17_ENGINEERING_CERTIFIED` baseline, again with an explicit
instruction not to continue automatically into M19+. M18 was
implemented and adversarially tested (partial/full/all-lines
cancellation, the shipment eligibility boundary, durable idempotency
including two-different-keys-racing-the-same-line convergence,
concurrency against pick/pack/ready-to-ship/shipment-creation/ship,
inventory-ledger exactness, warehouse-work invalidation, prepaid/COD
financial branching, split-fulfilment isolation, customer/guest IDOR,
staff RBAC/audit, and immutable-price credit-note integration),
CI-equivalent clean-state suite green with zero regressions to the
entire M00–M17 baseline. This build's own clean-state validation
caught and fixed a genuine cancel-vs-pick deadlock (an inverted lock
order against `WarehouseService.recordPickOutcome`) — investigated to
its true root cause rather than dismissed as a flake, per this file's
own binding discipline. Two honest scope boundaries were documented
rather than guessed, both in `CAN-004` (`blueprint/DECISION_REGISTER.md`)
and `acceptance/m18-cancellation.md`: partial cancellation is
implemented as cancelling a subset of lines (no sub-quantity
cancellation within one multi-unit line — the schema has no
infrastructure for it), and the loyalty-points-reversal acceptance
criterion is N/A (no loyalty ledger exists anywhere in this codebase;
M23 remains unauthorized and unbuilt). The captured-payment (PREPAID)
credit-note integration reuses the existing M08 `InvoiceService`
engine and is engineering-integration scope only — `TAX-005` remains
`UNDER_REVIEW` and is not resolved or claimed compliant by this build.
**On 2026-09-25 the human project owner recorded this state —
commit `4a616b3cefa8e4e1879dd8c62b293682ea6bc206` — as
`M18_ENGINEERING_CERTIFIED`** (engineering-implementation scope; not
production-readiness — the same open pre-production gates listed above
remain open, none resolved by this certification) and gave explicit
**"START BUILD — POST-PURCHASE PHASE"** authorization, a single bounded
pass covering **M19 (Returns), M20 (Refunds & Store Credit), and M21
(Exchanges) only**, to be worked sequentially with per-milestone
validation, without stopping for approval between those three
milestones — **M22 and everything after M21 remains unauthorized**.
See `acceptance/m18-cancellation.md` for M18's Definition of Done and
`CAN-004` in `blueprint/DECISION_REGISTER.md` for its state-machine/
lock-ordering/data-model design record; both are preserved unchanged by
this certification recording, including the cancel-vs-pick deadlock
history, the sub-quantity-cancellation scope boundary, the loyalty N/A
boundary, and the `TAX-005` limitation.

The full history of M17's original build, its independent-review
blocker, and the two repairs is preserved above and in
`blueprint/DECISION_REGISTER.md`'s `SHIP-005` entry and is not
rewritten by this M17_ENGINEERING_CERTIFIED recording — see that
history for the complete narrative.

Phase 1 (M00–M07) completed an
expanded engineering certification pass and was accepted by the human
project owner as **`PHASE_1_CERTIFIED`** at commit
`240debca8179df0b05db07216cfce64d0b10d0ae`. On 2026-09-23 the human
project owner gave explicit **"START BUILD — PHASE 2"** authorization,
scoped specifically to milestones **M08 through M15** (Tax & Invoicing
Foundation through Order Management), again with an explicit
instruction to **stop after M15 certification** for independent
review rather than self-authorizing M16+. On 2026-09-23 all of
M08–M15 were implemented and confirmed CI-green; an independent
reviewer then examined that build and returned nine numbered findings
(three BLOCKER, two BLOCKER/HIGH, one HIGH, three lower-severity),
fixed on 2026-09-24 under a separate certification-repair
authorization. A further independent re-review of that repaired state
returned two more findings (Blocker 1: same-request credit-note
over-credit; Blocker 2: payment-event dedup could suppress recovery
of a genuinely-failed webhook event), fixed the same day under a
second, explicitly scoped final certification-repair-pass
authorization — see `acceptance/m08-tax-invoicing-foundation.md` and
`acceptance/m14-payment.md` for those two fixes' detail, and the
per-finding commits on `claude/loving-fermat-cyucke` for the full
nine-finding history. **On 2026-09-24 the human project owner
recorded that repaired state — commit
`e1143994cd103e5fdabae9a779fbda56428a2164` — as `PHASE_2_CERTIFIED`**
(engineering-implementation scope for M08–M15; this is **not** the
same as production-readiness — `TAX-001`–`005`, GST/HSN statutory
verification, production performance verification, `CART-004`,
data-retention/privacy decisions, and the full pre-production
security/privacy program tracked at `SEC-001` all remain open
pre-production gates, listed in full in
`blueprint/DECISION_REGISTER.md`). The human project owner then gave
explicit **"START BUILD — M16"** authorization, scoped specifically
and only to milestone **M16** (Warehouse & Fulfilment), again with an
explicit instruction not to continue automatically into M17+. M16 is
now implemented, adversarially tested (concurrency, idempotency,
IDOR/BOLA, transactional rollback — see
`test/integration/warehouse.test.ts` and
`acceptance/m16-warehouse-fulfilment.md`), and the full clean-state
suite (lint, typecheck, build, unit, integration — the complete
pre-existing M00–M15 suite included, zero regressions — migration-
from-zero, seed, Playwright E2E) is green. **This agent does not
self-declare M16 certified** — per the M16 build instruction's own
stop condition, that determination belongs to the independent
reviewer. This agent has stopped and is awaiting independent human
review before any M17+ work.

**M00–M07 remain the certified, protected baseline; M08–M15 are now
`PHASE_2_CERTIFIED` (engineering-implementation scope).** All later
work MUST NOT regress either: the STYLE→COLOUR→SIZE→SKU hierarchy,
the inventory ledger, reservation atomicity/oversell prevention, GRN
atomicity, pricing invariants, RBAC, audit history, idempotency,
database constraints, clean-clone reproducibility, CI, and every
M08–M15 financial-integrity/concurrency invariant (credit-note
over-credit prevention, payment-event durability, capture/expiry
reconciliation, order-invoice recovery). Every Phase 1 and Phase 2
test remains mandatory and must stay green — M16's own build kept all
of them green throughout.

**This authorization does NOT extend beyond M22.**
Decision/spec/milestone readiness (`blueprint/READINESS.md` Layers
1–3) remains a separate thing from implementation authorization
(Layer 4):

- **M23 and every later milestone remain unauthorized.** No
  application code for M23+ (Loyalty, Promotions, Marketing, Channels,
  SEO, Analytics, Admin/CMS, Gift Cards, Security Hardening,
  Performance, Final Certification) should be added until the human
  project owner gives a new, separate, explicit **START BUILD**
  authorization for that phase — neither the Phase 2 authorization,
  nor the M16/M17/M18 authorizations, nor the Post-Purchase Phase
  (M19–M21) authorization, nor the M22 authorization carries forward
  automatically, regardless of how cleanly M08–M22 land.
- Do **not** interpret "M22 shipped cleanly" as authorization for the
  next milestone. Authorization must be explicit and human-given for
  each milestone/phase.
- **M22 (Customer 360) was explicitly authorized on 2026-09-26**,
  scoped only to that milestone, building on the
  `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline at commit
  `13876a5f98cf3fb7a671ad2ca86d3e62edcd1a24`, with an explicit
  instruction that M23 (Loyalty) and M24 (Promotions/Coupons)
  functionality must NOT be built inside M22 — those account sections
  must be represented honestly as `DEPENDENCY_DEFERRED — M23/M24`
  rather than fabricated. See §0 above and
  `acceptance/m22-customer-360.md` for the Definition of Done.
- The Post-Purchase Phase (M19 Returns, M20 Refunds & Store Credit,
  M21 Exchanges) was explicitly authorized on 2026-09-25 as a single
  bounded pass, scoped only to those three milestones, building on the
  `M18_ENGINEERING_CERTIFIED` baseline at commit
  `4a616b3cefa8e4e1879dd8c62b293682ea6bc206`, worked sequentially with
  per-milestone validation and no self-authorized continuation into
  M22+. All three milestones were implemented, adversarially tested,
  and committed as authorized (see §0 above). An independent review of
  that build returned five findings (none BLOCKER, all requiring
  repair); repaired 2026-09-26 under a separate, explicitly scoped
  repair authorization — see §0's repair narrative above. This repair
  authorization likewise does NOT extend to M22+, and its own one
  remaining open item (`EXC-004`'s `DECISION_REQUIRED — EXCHANGE
  REPLACEMENT FULFILMENT MODEL`) requires a separate, explicit Product
  Owner decision before any future pass may resolve it — an engineering
  agent must not guess an answer to it. See
  `acceptance/m19-returns.md`, `acceptance/m20-refunds-store-credit.md`,
  `acceptance/m21-exchanges.md` for the Definitions of Done, and
  `RET-005`/`REF-005`/`EXC-004` in `blueprint/DECISION_REGISTER.md` for
  the full design records, now including each one's 2026-09-26 repair
  addendum.
- M16 (Warehouse & Fulfilment) was explicitly authorized on
  2026-09-24, scoped only to that milestone, building on the
  `PHASE_2_CERTIFIED` baseline at commit
  `e1143994cd103e5fdabae9a779fbda56428a2164`. It was independently
  reviewed and certified `M16_ENGINEERING_CERTIFIED` at commit
  `97c575c9052148c5a48df82feffde8cf496cf97e` (see §0 above). See
  `WH-003` in `blueprint/DECISION_REGISTER.md` for the full state-
  machine/data-model design record and
  `acceptance/m16-warehouse-fulfilment.md` for the Definition of Done.
- M17 (Shipping / Tracking) was explicitly authorized on 2026-09-24,
  scoped only to that milestone, building on the
  `M16_ENGINEERING_CERTIFIED` baseline above. It was independently
  reviewed (one BLOCKER, fixed), CI caught a further genuine
  concurrency bug (fixed), and was then certified
  `M17_ENGINEERING_CERTIFIED` at commit
  `6e28e2bd3116c49641016f7a7ed5dd61427a5819` (see §0 above). See
  `SHIP-005` in `blueprint/DECISION_REGISTER.md` for the state-
  machine/data-model design record and
  `acceptance/m17-shipping-tracking.md` for the Definition of Done.
- M18 (Cancellation) was explicitly authorized on 2026-09-25, scoped
  only to that milestone, building on the `M17_ENGINEERING_CERTIFIED`
  baseline above. It was implemented, adversarially tested (including a
  genuine cancel-vs-pick deadlock caught and fixed by this build's own
  clean-state validation), full clean-state suite green with zero
  regressions to the entire M00–M17 baseline — see §0 above. See
  `CAN-004` in `blueprint/DECISION_REGISTER.md` for the state-machine/
  lock-ordering/data-model design record and
  `acceptance/m18-cancellation.md` for the Definition of Done.
- M08 is explicitly authorized to proceed now as a **configurable
  compliance architecture** — GST registrations, HSN/rate reference
  data, and e-invoice applicability are all engineering-configurable,
  never hard-coded, and the system must fail safely when that
  configuration is absent. This is *not* the same as resolving the
  underlying compliance/legal questions (`TAX-001`–`005` in
  `blueprint/DECISION_REGISTER.md`) — those still require a qualified
  professional's verification before real GSTIN/rate/HSN values are
  entered as production configuration, and must never be guessed by
  an engineering agent. Data-retention policy
  (`specs/21-customer-profile.md`, `specs/30-audit-compliance.md`)
  remains `UNDER_REVIEW` for the same reason.
- M09 must begin with the mandatory Medusa v2 integration spike
  required by `docs/decisions/0017-medusa-custom-domain-ownership-boundary.md`
  before other M09 work proceeds. If the spike shows the ownership
  model is not technically workable, stop and raise
  `DECISION_REQUIRED` rather than quietly changing ownership.
  **Historical note (2026-09-24, Phase 2 independent-certification
  repair, finding #4):** the spike was carried out and found the split
  workable, but M09-M15 were then actually built entirely on the
  custom platform - Medusa was never bootstrapped, and
  Cart/Checkout/Payment/Order are custom `services/commerce-api`
  domains like every other row in the ownership table.
  `docs/decisions/0019-custom-platform-sole-commerce-system-of-record.md`
  supersedes ADR-0003/0016/0017 and is now the live ownership decision;
  treat it, not ADR-0017, as authoritative for any future work touching
  this question.

If you are unsure whether implementation is authorized for a given
milestone, **stop and ask** rather than proceeding.

## 1. Your role

You are the **Principal Engineering Agent** for this project (see
`AGENTS.md` for the full multi-agent model). Concretely:

- You implement **approved** specifications from `/specs`.
- You never silently convert a `DRAFT` or unresolved business question
  into an implemented rule. If something is unresolved, mark it
  `DECISION_REQUIRED` in the relevant spec and stop — do not guess.
- You keep GitHub as the **permanent source of truth**. Anything
  architecturally important that was only discussed in chat must be
  written into a doc/spec/ADR before it's considered real.
- You follow the milestone sequence in `BUILD_PLAN.md`. Do not skip
  ahead to a later milestone because it seems easy or related.

## 2. Reading order for a fresh session

1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `docs/decisions/` (ADRs) — especially any with status `APPROVED`
5. `blueprint/DECISION_REGISTER.md` — authoritative business-decision
   status (105 DECIDED / 7 UNDER_REVIEW / 0 OPEN as of 2026-09-22)
6. `blueprint/READINESS.md` — current per-milestone readiness and the
   decision-readiness-vs-implementation-authorization hierarchy
7. `BUILD_PLAN.md` — milestone sequence and current status
8. The specific `specs/NN-*.md` file relevant to the task at hand
9. `TESTING.md` and `acceptance/README.md` (plus the relevant
   `acceptance/mNN-*.md`) — Definition of Done
10. `SECURITY.md` — safety boundaries on what you may do autonomously

## 3. Document status system

Every spec in `/specs` carries a status:

`DRAFT` -> `UNDER_REVIEW` -> `APPROVED` -> `IMPLEMENTING` -> `IMPLEMENTED` -> `VERIFIED`

Rules:

- You may only **implement** a spec whose status is `APPROVED` or
  later, and only within a milestone that `BUILD_PLAN.md` says is
  unblocked and active.
- When you begin implementing an approved spec, update its status to
  `IMPLEMENTING`. When implementation is complete and passes the
  Definition of Done, update it to `IMPLEMENTED`. `VERIFIED` is set
  after independent/human verification — do not set this yourself.
- You may freely edit `DRAFT` specs to improve clarity, but you may
  not mark your own draft `APPROVED` — that requires human/product
  owner sign-off (see `AGENTS.md`).

## 4. Handling unresolved business decisions

If an important business rule is not yet specified:

1. Do **not** invent it, even if the answer "seems obvious."
2. Add a clearly marked block to the relevant spec:

   ```
   ## DECISION_REQUIRED

   Question: <the specific unresolved question>
   Why it matters: <what breaks or gets built wrong if guessed>
   Options considered (if any): <...>
   ```

3. Stop work on the parts of the task that depend on that decision.
   Continue only on parts that don't depend on it, if any.

## 5. The future autonomous development loop

Once implementation is authorized, the intended loop per milestone is:

```
READ APPROVED SPEC
  -> REVIEW ACCEPTANCE CRITERIA
  -> PLAN
  -> IMPLEMENT
  -> RUN
  -> TEST
  -> DIAGNOSE FAILURES
  -> FIX
  -> RETEST
  -> REVIEW
  -> COMMIT
  -> UPDATE BUILD STATUS
  -> NEXT APPROVED MILESTONE
```

This loop is **documented but not active**. Do not start executing it
until the human project owner explicitly authorizes implementation
start with **START BUILD** — Product Blueprint V2 itself is already
complete (see §0); that alone is not the authorization.

## 6. Safety boundaries

See `SECURITY.md` for the full policy. Summary: editing source,
branching, writing/running tests, non-production migrations, local
dev databases, builds, and local/sandbox E2E are within an
authorized engineering agent's normal autonomy. Production deployment,
destructive production migrations, deleting production data, changing
production credentials/secrets, and other irreversible production
operations always require explicit human approval, regardless of how
confident the agent is.

## 7. Definition of Done

Do not report a milestone complete because code exists. See
`acceptance/README.md` for the full Definition of Done checklist that
must be satisfied first.

## 8. Repository conventions

- Secrets are never committed. Use environment-variable templates
  (e.g. `.env.example`) once those exist — never real credentials.
- Keep specs, ADRs, and build status **up to date as you work** —
  these are not write-once documents.
- Prefer small, reviewable commits with clear messages over large
  unreviewable ones, once implementation begins.
