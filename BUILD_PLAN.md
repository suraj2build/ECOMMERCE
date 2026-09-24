# Build Plan

## STATUS: PHASE 2 BUILD COMPLETE (M08–M15) — AWAITING INDEPENDENT REVIEW — SEE §3

> Phase 1 (M00–M07) is `PHASE_1_CERTIFIED` as of 2026-09-22 at commit
> `240debca8179df0b05db07216cfce64d0b10d0ae`. On **2026-09-23** the
> Product Owner gave explicit **"START BUILD — PHASE 2"** authorization
> for milestones **M08–M15** only, with a mandatory stop for
> independent review after M15 certification. As of **2026-09-23**, all
> of M08–M15 are **IMPLEMENTED, CI-green** (see the table below for each
> milestone's confirmed-green CI run). Per that authorization, this
> agent now **stops and awaits independent human review** — **M16 and
> beyond remain unauthorized** and will not be started without a new,
> separate, explicit START BUILD instruction — see `CLAUDE.md` §0.

## 1. What changed from the original plan

The original 32-milestone sequence (M00–M31) is revised to:

1. **Fold Organization & Location Foundation into M00** — `ORG-001`/
   `ORG-002` are foundational data-model decisions that must exist
   before Product Master and Inventory are built, not a separate
   milestone (see `blueprint/DEPENDENCY_MAP.md` recommendation).
2. **Insert a new milestone: Tax & Invoicing Foundation**, between
   Catalog (pricing) and Storefront — GST/HSN/MRP/invoicing is
   cross-cutting, legally significant, and deserves its own spec
   (`specs/32-india-tax-invoicing.md`) and milestone rather than being
   an implicit side-detail of Checkout.
3. **Fold the Store Credit ledger foundation into Refunds** (it's a
   hard dependency of the COD refund requirement) and **add a
   dedicated, later Gift Cards milestone** (purchasable stored-value
   instruments are required eventually but explicitly must not block
   early commerce milestones, per Product Owner instruction §21).
4. **Fold CMS into Admin** (admin-controlled content) rather than a
   separate spec/milestone.
5. **Fold AI Product Enrichment into Product Master as an optional,
   deferred sub-scope** (`specs/34-ai-product-enrichment.md`) — not a
   separate milestone, per explicit instruction not to build all AI
   capability in early milestones.
6. **Channel Publishing keeps its original position** — it now
   explicitly covers only the adapter/contract architecture; concrete
   marketplace integrations remain unbuilt pending separate
   authorization.

This adds exactly **two** new milestones (Tax & Invoicing, Gift Cards)
to the original 32, for a revised total of **34 milestones (M00–M33)**
— deliberately minimal, per the Product Owner's instruction not to add
"dozens of unnecessary milestones."

## 2. Milestone sequence

| Milestone | Name | Owning spec(s) | Readiness |
|---|---|---|---|
| M00 | Project Foundation (+ Organization & Location Foundation) | `00`, `31` | **IMPLEMENTED** (Phase 1 build, 2026-09-22) |
| M01 | Authentication / RBAC | `01` | **IMPLEMENTED** (Phase 1 build, 2026-09-22) |
| M02 | Product Master (+ optional AI enrichment sub-scope) | `02`, `34` | IMPLEMENTED (Phase 1 build, 2026-09-22; AI enrichment sub-scope not built — deferred, not requested) |
| M03 | Suppliers | `03` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M04 | Procurement / Purchase Orders | `04` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M05 | GRN / QC | `05` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M06 | Inventory | `06` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M07 | Catalog / Merchandising / Pricing | `07` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M08 | **Tax & Invoicing Foundation** (NEW) | `32` | Engineering-configurable architecture **IMPLEMENTED** (Phase 2 build, 2026-09-23: GST registration model, effective-dated HSN/rate reference data, tax computation engine, immutable invoice/credit-note snapshots with concurrency-safe FY numbering, e-invoice adapter boundary — 19 passing tests). Milestone as a whole remains **BLOCKED** for the compliance-dependent portion — `TAX-001`–`005` remain `UNDER_REVIEW` and gate production configuration (real GSTIN/rate/HSN values), not the engineering build. See `acceptance/m08-tax-invoicing-foundation.md`. |
| M09 | Storefront Foundation (+ Watch & Shop) | `08`, `35` | Foundation layer **IMPLEMENTED** (Phase 2 build, 2026-09-23): Medusa v2 spike complete (ADR-0017), Watch & Shop content model/moderation backend (17 tests), Next.js storefront app with token-based multi-brand design system, Home page, error boundaries, public read-model routes, Playwright E2E (mobile/desktop/a11y) — all CI-green. PLP/PDP/Cart pages and the full immersive `/watch-and-shop` route are M10–M12's own scope; LCP measurement deferred to Phase 2 certification. **Architecture note (2026-09-24 certification repair, finding #4):** M10–M15 were subsequently built entirely on the custom platform, not on Medusa — see `docs/decisions/0019-custom-platform-sole-commerce-system-of-record.md`, which supersedes ADR-0017's ownership table. See `acceptance/m09-storefront-foundation.md`, `acceptance/m09-watch-and-shop.md`. |
| M10 | Search / Discovery | `09` | Backend/indexing pipeline **IMPLEMENTED** (Phase 2 build, 2026-09-23): Meilisearch client + synchronous catalog-to-index pipeline (publish/price/stock all propagate within the same request), public `/storefront/search` with category/brand/color/size/price filtering and price/newest sorting, manual merchandiser pin (`catalog:search:pin`) and operational reindex (`search:reindex`), graceful degradation on a Meilisearch outage — 13 passing tests against a real Meilisearch instance. PLP UI (filter patterns, E2E) is M11's scope; full-catalog-scale load testing deferred to Phase 2 certification. See `acceptance/m10-search-discovery.md`. |
| M11 | PDP | `10` | **IMPLEMENTED, CI-green** (Phase 2 build, 2026-09-23): PDP aggregate read API (live inventory availability, size chart, badges, cross-sell), ratings/reviews (auto-published, staff moderation, one-per-customer), PIN-code serviceability static-list fallback (IND-002), rule+manual-override cross-sell (PDP-002), full storefront PDP page (gallery, variant selection, size chart, PIN checker, reviews with a minimal OTP sign-in, structured data/JSON-LD, mobile sticky add-to-bag) — 21 backend integration tests + 4 browser E2E tests (real Chromium, axe-core scan), confirmed green in CI run [35838957656](https://github.com/suraj2build/ECOMMERCE/actions/runs/35838957656). Add-to-bag is honestly not wired to a real cart (M12 doesn't exist yet). Found and fixed three real bugs: two via actual browser verification (a mobile sticky-bar/footer overlap, and commerce-api having no CORS configuration at all — every earlier milestone's storefront fetch was server-side only, M11 is the first with genuine browser-originated requests), and one via CI failure investigation (the E2E super-admin user was seeded *before* the integration-test step, which truncates all tables per test file, wiping the seeded account before the later E2E step needed it — reordered the CI workflow to seed after integration tests). PDP-scale LCP measurement deferred to Phase 2 certification. See `acceptance/m11-pdp.md`. |
| M12 | Wishlist / Cart | `11` | **IMPLEMENTED, CI-green** (Phase 2 build, 2026-09-23, confirmed green in CI run [35873539789](https://github.com/suraj2build/ECOMMERCE/actions/runs/35873539789)): guest + account Cart/Wishlist (`services/commerce-api/src/modules/cart/`), backed by two new tables (`Cart`/`CartItem`, `Wishlist`/`WishlistItem`) with a hand-written CHECK constraint enforcing exactly one of customer/guest identity. Adding to cart never reserves inventory (INV-002) — only informational `InventoryBalance` reads, the same discipline as M11's PDP availability display. Cart re-validates price/availability live on every read and surfaces price-change/out-of-stock/no-longer-purchasable flags rather than silently letting checkout proceed. Guest identity is a client-generated `x-guest-session-id` header; guest cart/wishlist merge into the account's on login (quantity-summed and capped at the configurable `CART_MAX_QUANTITY_PER_SKU`, deduplicated for wishlist), triggered automatically from the existing M11 OTP login flow. Storefront gets `/bag` and `/wishlist` pages plus a live cart-count badge in the header; the PDP's Add-to-Bag button is now genuinely wired to the cart (no longer M11's "coming soon" placeholder) and gained a Save-to-Wishlist button. Checkout itself (re-validate-and-reserve) is honestly not built — M13's own milestone. 12 backend integration tests + 4 browser E2E tests (real Chromium, including a real-browser proof of zero inventory reservations on add-to-cart). Found and fixed two real bugs: a touch-target CSS-class-ordering pitfall (mirroring the documented Button.tsx variant-class pitfall) caught via real bounding-box measurement, and a flaky external-image-dependency in the E2E fixtures (both this milestone's and M11's) that could intercept clicks — fixed by switching to a same-origin static fixture image, a correctness improvement for CI too. See `acceptance/m12-wishlist-cart.md`. |
| M13 | Checkout | `12` | **IMPLEMENTED, CI-green** (Phase 2 build, 2026-09-23, confirmed green in CI run [35877576131](https://github.com/suraj2build/ECOMMERCE/actions/runs/35877576131))*: `CheckoutSession` (the "order creation trigger" artifact — the formal `Order`/order-management model is M15's own milestone, per the pre-existing comment on `Invoice.orderId` and `InvoiceService`'s docblock) backed by `CheckoutSession`/`CheckoutSessionLine`/`Payment`/`ShippingRule` tables. Reservation begins at checkout submission only (INV-002), never at add-to-cart; PIN re-validated against the same M11 data; cart price/availability re-validated via the same `CartService` `/bag` uses. Depends only on the `PaymentProvider` interface (ADR-0011) — COD genuinely completes end-to-end (no gateway needed); prepaid honestly hands off with a "coming soon" message, since real Razorpay integration is M14's own scope. Shipping cost via a configurable rule engine (flat / free-above-threshold; weight-based deferred — no product-weight model exists). Tax computed by reusing the M08 engine directly (`splitTax`/`determinePlaceOfSupply`), never reimplemented. Idempotent per client-generated key — a genuine concurrent double-submission test proves exactly one session/reservation results. All-or-nothing reservation rollback across multi-line orders, including a fragmented-stock-across-locations edge case. 15 backend integration tests + 1 browser E2E test (full COD flow, PDP→Bag→Checkout→Confirmation, with a real-browser proof of zero reservations before submission and exactly one after). Found and fixed a genuine M06 concurrency bug along the way: `InventoryService.reserve()`'s own idempotency-key race could surface a raw unmapped 500 instead of its own promised idempotent behavior — fixed with no regression across the full 17-test M06 concurrency/adversarial suite. See `acceptance/m13-checkout.md`. |
| M14 | Payment | `13` | **IMPLEMENTED, CI-green** (Phase 2 build, 2026-09-23, confirmed green in CI run [35884863550](https://github.com/suraj2build/ECOMMERCE/actions/runs/35884863550); also includes the standalone Fastify v4→v5 CVE migration spike, ADR-0018, done first as an isolated commit before this feature per the spike-then-build discipline): real Razorpay REST integration (`payment-provider.ts` — order creation, HMAC-SHA256 webhook signature verification via `timingSafeEqual`, webhook event parsing, refund) behind the `PaymentProvider` abstraction (ADR-0011), no SDK dependency. `PaymentEvent` table dedupes every inbound webhook by `(provider, providerEventId)` **before** any state change — a duplicate delivery is a safe no-op, proven by an automated replay test, not manually verified once. Webhook correlates to the right `Payment` row via Razorpay's *order* id while an attempt is in flight, then swaps to the actual *payment* id on capture (order id ≠ payment id — a real bug caught and fixed while writing the webhook test, before it ever reached production). A failed payment attempt does **not** release its reservation (PAY-005: reservation survives the retry window) — only a genuine payment *timeout* does (`PaymentService.expireStalePayments()`, mirroring `InventoryService.expireStaleReservations()`'s existing shape). Storefront wires Razorpay's real hosted Checkout.js widget (`lib/razorpay.ts`) with a "Pay now"/"Retry payment" UI, polling the webhook-driven session status rather than trusting the client-side success callback. **Found and fixed a second, unrelated real bug while verifying this milestone's own E2E suite**: Fastify v5's default JSON body parser rejects an *empty* body sent with `Content-Type: application/json` (v4 tolerated it) — broke every storefront DELETE call (remove cart item, remove wishlist item) with a raw framework error; the original Fastify v5 migration ADR had claimed "16 E2E tests pass unmodified" without actually running them locally, so this shipped in the migration commit and only surfaced now, once M14's own local CI-mirroring E2E run caught it (initially mis-triaged as CI resource contention, then reproduced deterministically in isolation and root-caused) — see ADR-0018's correction. Fixed with one global content-type parser in `app.ts`. 8 new backend integration tests covering all 4 `acceptance/m14-payment.md` negative scenarios (fail-then-retry, duplicate webhook, invalid signature, payment timeout) plus signature verification and real order-id correlation, Razorpay's HTTP boundary mocked at the `fetch` boundary per ADR-0011's own stated test approach — 230 total backend tests, all 16 browser E2E tests, both genuinely green locally against the CI-mirroring `fcp_test` database. Refund-initiation HTTP route deliberately out of scope (M20, `specs/19-refunds.md`) — `PaymentProvider.refund()` exists and is correct, just not yet wired to an authorized route. See `acceptance/m14-payment.md`. |
| M15 | Order Management | `14` | **IMPLEMENTED, CI-green** (Phase 2 build, 2026-09-23, confirmed green in CI run [35889983436](https://github.com/suraj2build/ECOMMERCE/actions/runs/35889983436)): `Order`/`OrderLine`/`OrderFulfilment` created in-process (never via a public endpoint) the moment a CheckoutSession's payment genuinely succeeds — COD acceptance (`CheckoutService`) or a Razorpay `payment.captured` webhook (`PaymentService`) — mirroring the exact hand-off the M08 `InvoiceService` docblock anticipated: `issueInvoice()` is now called in-process at order confirmation, using the M08 scaffolding directly, not reimplemented. Reservation converts to a committed `ALLOCATION` ledger transaction on order creation (`InventoryService.convertReservation`, filling in the pre-existing but previously-unused `ReservationStatus.CONVERTED` value) — immune to the M06 reservation-TTL sweep, since a confirmed order's stock must never silently expire back to available. Split shipments: any not-yet-fulfilled lines can be grouped into an `OrderFulfilment` and packed/shipped/delivered independently of the order's other lines — ship posts a `SALE` ledger transaction (onHand + reserved both decrement) at the moment stock actually leaves. Partial cancellation releases the allocation (`CANCELLATION` ledger transaction) and is blocked once a line has shipped (routes to a future return instead); a PREPAID cancellation/RTO flags `Order.refundRequired` honestly rather than executing a refund (`PaymentProvider.refund()` exists and is correct — wiring it to an authorized route is `specs/19-refunds.md`'s own scope, M20). RTO and order-exception handling are explicit staff-triggered actions with the correct COD-vs-prepaid/blocking business-rule branching, not a simulated carrier callback — real carrier tracking is `specs/16-shipping-tracking.md`'s own scope (M17), and a real warehouse pick-list UI is `specs/15-warehouse-fulfilment.md`'s (M16); this milestone deliberately stops at the engineering-level analogue of both, documented as a spec scope-boundary note, not silently cut. Full order history retained via the platform's single `recordAudit` path, never a parallel table. Storefront gets real, working order-history pages (`/orders`, `/orders/[id]`) for the same guest-or-customer identity checkout already uses — not just an API. 15 new backend integration tests (`test/integration/order.test.ts`, covering both order-creation triggers, split shipment, partial cancellation for both payment methods, blocked-cancel-after-ship, exception flag/resolve, RTO branching for both payment methods, allocation traceability, and the full audit trail) plus 1 new browser E2E test (`test/e2e-storefront/orders.spec.ts`) — 245 total backend tests and 17 total browser E2E tests, all genuinely green locally against the CI-mirroring `fcp_test` database (confirmed by an actual `npm run test:e2e` run, not inferred — see ADR-0018's correction on why that distinction matters). See `acceptance/m15-order-management.md`. |
| M16 | Warehouse / Fulfilment | `15` | READY_FOR_IMPLEMENTATION |
| M17 | Shipping / Tracking | `16` | READY_FOR_IMPLEMENTATION |
| M18 | Cancellation | `17` | READY_FOR_IMPLEMENTATION |
| M19 | Returns | `18` | READY_FOR_IMPLEMENTATION |
| M20 | Refunds (+ Store Credit ledger foundation) | `19`, `33` | READY_FOR_IMPLEMENTATION |
| M21 | Exchanges | `20` | READY_FOR_IMPLEMENTATION |
| M22 | Customer 360 | `21` | READY_FOR_IMPLEMENTATION** |
| M23 | Loyalty | `22` | READY_FOR_IMPLEMENTATION |
| M24 | Promotions | `23` | READY_FOR_IMPLEMENTATION |
| M25 | Marketing | `24` | READY_FOR_IMPLEMENTATION |
| M26 | Social / Channel Publishing (adapters only) | `25` | READY_FOR_IMPLEMENTATION*** |
| M27 | SEO | `26` | READY_FOR_IMPLEMENTATION |
| M28 | Analytics / Reporting | `27` | READY_FOR_IMPLEMENTATION |
| M29 | Admin (+ CMS) | `28` | READY_FOR_IMPLEMENTATION |
| M30 | **Gift Cards** (NEW) | `33` | READY_FOR_IMPLEMENTATION (low build priority — scheduled late) |
| M31 | Security Hardening | `SECURITY.md` + cross-cutting | READY_FOR_IMPLEMENTATION (continuous) |
| M32 | Performance / Load | cross-cutting | BLOCKED — sequence-blocked, needs sufficient built functionality first |
| M33 | Full End-to-End Certification | all of the above | BLOCKED — sequence-blocked, needs M00–M32 substantially complete |

\* M13 Checkout is ready for engineering build; final GST computation
*correctness* depends on M08's compliance verification before
production go-live (not before development starts).

\** M22 Customer 360 is ready for engineering build of all required
features; the data-retention/deletion *policy* (`CUST-001`) is
`UNDER_REVIEW` and layers on afterward without blocking the build.

\*** M26 covers the adapter/contract architecture only. Any concrete
marketplace integration (Amazon, Flipkart, Myntra, Ajio, Meta, Google
Merchant) requires separate, explicit milestone authorization before
implementation — building one without that authorization is out of
scope even after M26 itself is "ready."

Notifications (spec `29`) and Audit (spec `30`) remain cross-cutting,
feeding into multiple milestones above (primarily M15–M23 and M29)
rather than being standalone milestones, as in the original plan.

## 3. Readiness gate — what "ready" means and does not mean

`READY_FOR_IMPLEMENTATION` above means: the business decisions this
milestone's spec depends on are `DECIDED` (see
`blueprint/DECISION_REGISTER.md`), and no genuinely open,
non-configurable blocker remains. It does **not** mean implementation
is authorized to start. Two separate gates must both be satisfied:

1. **Decision readiness** (this document, per-milestone, now largely
   satisfied).
2. **Explicit human authorization** ("**START BUILD**") — Phase 1
   (M00–M07) was authorized 2026-09-22, implemented, and independently
   certified `PHASE_1_CERTIFIED` at commit
   `240debca8179df0b05db07216cfce64d0b10d0ae`. Phase 2 (M08–M15) was
   authorized 2026-09-23 via an explicit "START BUILD — PHASE 2"
   instruction scoped to those milestones and requiring a stop for
   independent review after M15 certification. **M16 and beyond remain
   unauthorized.** Continuing past M15 requires a new, separate,
   explicit authorization from the human project owner — this document
   being updated is not that authorization.

**`BLOCKED` milestones (M32, M33)** have a stated, specific reason —
sequence dependency on prior milestones — not vague uncertainty.

**No milestone is classified `FUTURE_SCOPE`** at the milestone level;
instead, specific **features within several milestones** are marked
`FUTURE_CONSIDERATION` in their owning spec and must not be built as
part of that milestone's completion:

- Native mobile applications (`specs/08-storefront.md`)
- Physical stores, click & collect, ship-from-store, multi-location
  *operation* (`specs/31-organization-locations.md` — the *data model*
  is required now, only the operational rollout is future)
- Concrete marketplace integrations (`specs/25-social-channel-publishing.md`)
- Raw-material inventory / BOM / production execution
  (`specs/03-suppliers-procurement.md`)
- Full AI generation capability beyond the optional M02 sub-scope
  (`specs/34-ai-product-enrichment.md`)
- Personalized search/recommendation (`specs/09-search-discovery.md`)
- Wishlist sharing, partial/split payment, pre-order/backorder, and
  the other smaller items listed `FUTURE_CONSIDERATION` throughout
  `/specs`

## 4. Definition of Done per milestone

See `acceptance/` — every milestone listed above has a corresponding
`acceptance/mNN-*.md` document with testable, structured acceptance
criteria. No milestone may be marked complete without satisfying it in
full — see `acceptance/README.md` for the Definition of Done process
that governs all of them.

## 5. Change log

| Date | Change |
|---|---|
| 2026-09-22 | Documentation/specification foundation established. Build plan created and marked BLOCKED pending Product Blueprint V2. |
| 2026-09-22 | Product Blueprint V2 decision framework created in `/blueprint` (112 decisions registered, all `OPEN`). |
| 2026-09-22 | Product Owner Blueprint V2 decision session completed. 105/112 decisions `DECIDED`, 7 `UNDER_REVIEW` (compliance verification). Build plan revised: 2 new milestones inserted (Tax & Invoicing, Gift Cards), 4 new specs added (`31`–`34`), all specs updated with normative requirements, per-milestone acceptance criteria created. Per-milestone readiness classified above. **Implementation remains NOT authorized** pending explicit **START BUILD** from the Product Owner. |
| 2026-09-22 | **START BUILD — PHASE 1** authorized (M00–M07). Implemented and independently certified `PHASE_1_CERTIFIED` at commit `240debca8179df0b05db07216cfce64d0b10d0ae` after an expanded engineering certification pass (database integrity, adversarial inventory/GRN/product/pricing/auth/input/audit testing, migration safety, CI/infrastructure/dependency review, ADR-0017 critical review, performance sanity). |
| 2026-09-23 | **START BUILD — PHASE 2** authorized (M08–M15), with a mandatory stop for independent review after M15 certification. M08–M15 moved from `READY_FOR_IMPLEMENTATION` to `IMPLEMENTING`. **M16 and beyond remain unauthorized.**
