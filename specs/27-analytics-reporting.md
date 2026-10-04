# 27. Analytics / Reporting

**Status:** IMPLEMENTED (2026-09-28 — see `blueprint/DECISION_REGISTER.md`
`ANL-001`). Not yet independently reviewed/certified.

## Purpose

Define the business and operational analytics/reporting the platform
must produce.

## Scope

- Event tracking, business reporting, data foundations

## Approved requirements (2026-09-22)

Required analytics categories (explicit, §27):

- **Commerce:** sales, orders, returns, refunds, inventory, customer
  metrics, margin, profitability.
- **Fashion-specific:** style performance, colour performance, size
  performance, stock ageing, sell-through, availability, return
  reasons, size-related returns.
- **Procurement:** supplier fill rate, short receipts, excess receipts,
  damaged receipts, lead time, purchase vs. sales, supplier
  performance.

Build-vs-integrate: build native event/data foundations first (reading
from the ledger models — inventory, loyalty, store credit — rather
than duplicating or bypassing them, consistent with ADR-0012/0013);
evaluate a BI/dashboard presentation layer separately, later. This is
an engineering default, not a business blocker.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m28-analytics-reporting.md`.

## Dependencies

Depends on nearly every other domain as a data source. Feeds:
`specs/28-admin.md`.

## Launch readiness addendum (2026-10-03) — IMPLEMENTED (awaiting independent review; external accounts not configured)

Consent-aware GA4 ecommerce events and Meta Pixel + Conversions API with stable event IDs, a durable server-side outbox, COD vs prepaid purchase semantics, refunds via GA4 Measurement Protocol, server-only credentials and no PII in general analytics payloads (`LR-003`).

### Implementation (2026-10-03)

- **Consent.** `apps/storefront/src/components/consent/ConsentBanner.tsx`:
  shown on the first visit only when a tag ID is configured (with none
  configured nothing is collected, so there is nothing to consent to);
  Accept all / Choose / Reject all; reopened from "Privacy choices" in the
  footer. Choice stored in `localStorage` (`vanya_consent_v1`).
- **Browser tags.** `apps/storefront/src/lib/tracking.ts` loads gtag.js only
  with `analytics` consent and fbevents.js only with `marketing` consent;
  every call re-checks consent, so withdrawal stops events at once, and
  withdrawal also revokes the tags' consent state and deletes `_ga*`,
  `_fbp`, `_fbc`. Events: `view_item_list`, `search`, `view_item`,
  `add_to_cart`, `add_to_wishlist`, `view_cart`, `begin_checkout` (GA4);
  `ViewContent`, `Search`, `AddToCart`, `AddToWishlist`,
  `InitiateCheckout`, `Purchase` (Meta). Item IDs are SKU codes,
  `item_group_id` / Meta `product_group` is the style code, currency INR.
- **Purchase.** The browser never sends a GA4 `purchase` (the server does,
  so it cannot be counted twice). The browser Meta `Purchase` fires on the
  confirmation page only when the checkout status is `CONFIRMED` and an
  order number exists, once per order per browser, with
  `eventID = purchase:<orderNumber>` — the same ID the Conversions API
  sends, which Meta deduplicates. A COD order is not a purchase when
  placed: see LR-009 below. A prepaid
  order is a purchase only after Razorpay capture: no order row exists
  before that, so a payment-button click or a failed/abandoned payment
  can never produce one.
- **Server events.** `services/commerce-api/src/modules/conversions/`:
  the order's consent and identifiers (`analyticsClientId` from `_ga`,
  `metaBrowserId`/`metaClickId` from `_fbp`/`_fbc`, each kept only for a
  consented purpose) are sent with checkout and frozen on the order.
  `ConversionEvent` outbox rows are written in the order-creation
  transaction (GA4 `purchase`, Meta `Purchase`) and in the refund-
  completion transaction (GA4 `refund`), unique on (provider, eventId).
  `dispatchDue` claims rows with `FOR UPDATE SKIP LOCKED`; 2xx → SENT;
  4xx → FAILED (no retry); 429 → retry; timeout/5xx → retry with backoff
  for events the provider deduplicates (Meta event_id, GA4 purchase
  transaction_id), AMBIGUOUS_RECONCILIATION_REQUIRED for GA4 refunds
  (not deduplicated by Google, never resent blindly). A crashed
  dispatcher's claim is reclaimed the same way.
- **Data.** GA4 payloads carry no name, email, phone or address. Meta
  receives SHA-256 hashed email (trimmed, lower-case) and phone (digits,
  `91` prefix for 10-digit numbers) only for orders with `marketing`
  consent. Secrets (`GA4_API_SECRET`, `META_CAPI_ACCESS_TOKEN`) are
  server-only; the access token travels in the request body, never the
  URL; neither appears in stored errors.
- **Staff routes.** `GET /analytics/conversions` (`analytics:read`):
  enabled integrations, counts per provider/status, recent failures.
  `POST /analytics/sweep/conversions` (`campaign:manage`).
- **Tests.** `test/integration/conversions.test.ts` (14: consent refusal
  and partial consent, purchase only after capture, duplicate capture
  webhook, malformed identifiers rejected, disabled integrations, no
  personal data, single send, retry with the same event_id, definite
  rejection, concurrent dispatchers, crashed-claim recovery, refund +
  ambiguous outcome, RBAC); `test/e2e-storefront/consent.spec.ts` (3:
  nothing before consent or after refusal, events after consent and
  withdrawal deleting cookies, a consented COD order carrying consent to
  the server and the Meta purchase once with the order-number event ID).
- **Review follow-up (2026-10-03).**
  - *Withdrawal reaches queued server events.* Each browser consent
    record carries a random `subjectId` (UUID). It is sent with checkout
    and stored as `consentSubjectId` on the checkout session and order.
    Turning a purpose off calls `POST /storefront/consent/withdrawal`
    (guest-accessible; the bearer token, when present, adds the signed-in
    customer's own orders). The call clears that purpose's consent flag
    and identifiers on every matching session and order, and marks the
    purpose's not-yet-sent events (first attempt or waiting for retry)
    `WITHDRAWN`. Withdrawing marketing only rewrites queued GA4 events to
    `ad_user_data`/`ad_personalization: DENIED`. The dispatcher re-checks
    the order's consent after claiming each event, so an in-flight claim
    reclaimed after a withdrawal is not sent. A withdrawal before a
    prepaid capture means the order is created without consent. The
    route always answers 204 and never grants consent. If the request is
    lost, the browser keeps it (`vanya_consent_withdrawal_pending`) and
    resends it on the next page load. Limit: an event already accepted by
    Google/Meta cannot be recalled, and one being sent at the exact
    moment of withdrawal may still go out.
  - *COD vs paid.* Purchase events carry `payment_type` (`cod` |
    `prepaid`) in GA4 params and Meta `custom_data`. Register
    `payment_type` as an event-scoped custom dimension in GA4 to report
    on it. Unpaid COD orders are handled by LR-009 below.
  - *Tests.* `conversions.test.ts` now has 21 tests (+ withdrawal of all
    queued events, during retry backoff, of an in-flight claim,
    marketing-only, before prepaid capture, signed-in customer across
    browsers, never-grants/400; payment_type on COD and prepaid).
    `consent.spec.ts` now withdraws after a real COD order with the first
    request dropped, and proves the retry clears the order's consent.

### LR-009 COD reporting (Product Owner decision 2026-10-04)

- A COD order placed queues GA4 `cod_order_placed` and Meta
  `CODOrderPlaced` (event ID `cod_placed:<orderNumber>`), not a purchase.
  The browser records no Purchase for a COD order.
- Its purchase (`purchase:<orderNumber>`) is queued when Finance records the
  cash collection: `POST /orders/:id/cod-collection` (`payment:cod:collect`),
  or "Record COD collection" on the admin order screen. The order must be
  fully delivered or cancelled with at least one line delivered; the
  amount must be positive and no more than the amount payable on delivery.
  The purchase is dated at collection and covers delivered lines not
  already refunded, plus shipping. Recording is once per order and
  idempotent, serialised on the order row.
- A cancelled, refused or RTO COD order can never be collected, so it never
  becomes a purchase. A refund is reported (GA4 `refund`) only against a
  reported purchase; a COD refund before collection is not reported and its
  line is excluded from the purchase.
- Prepaid orders are unchanged.
- Tests: `conversions.test.ts` (30), including the full COD lifecycle with
  the collection time as the event time, guards and RBAC, a concurrent
  double recording, a cancelled order, refunds before and after the
  purchase, and the unchanged prepaid path.
- GA4 setup: register `cod_order_placed` parameters (value, payment_type) as
  custom definitions to report placed COD orders.

- **Not yet verified:** delivery into GA4 DebugView / Meta Events Manager
  test events. No GA4 property or Meta dataset is configured for this
  project; set the variables in DEPLOYMENT.md §5 and `META_TEST_EVENT_CODE`
  to verify in the providers' test tools.
