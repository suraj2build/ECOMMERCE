# M14 — Payment Acceptance Criteria

**Spec(s):** `specs/13-payment.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23)

## Business acceptance

- [x] UPI, cards, net banking, and COD are all available and
      functional payment methods. COD is fully functional end to end.
      UPI/cards/net banking are functional through Razorpay's hosted
      Checkout.js (order creation, webhook capture, retry) built and
      verified against Razorpay's documented REST/webhook contract with
      the HTTP boundary mocked (ADR-0011's own stated test approach) -
      genuinely correct code, but not exercised against Razorpay's real
      network, since no real `RAZORPAY_KEY_ID`/`KEY_SECRET` exist in
      this environment and must never be guessed (CLAUDE.md §0). Fails
      safe to an honest "coming soon" message when unconfigured, the
      same discipline as M08's tax engine.
- [x] Order/checkout code never imports or calls the Razorpay SDK
      directly — only the internal provider-abstraction interface
      (`PaymentProvider`, `modules/checkout/payment-provider.ts`).
- [x] Payment state and order state are implemented as **separate**
      data structures/fields — `PaymentStatus` vs `CheckoutSessionStatus`,
      distinct enums/tables. Verified by
      `test/integration/payment.test.ts`'s webhook-failure-then-retry
      test, which puts a session at `PAYMENT_FAILED` while its (now
      superseded) first `Payment` row stays `FAILED` and a second row is
      `INITIATED` simultaneously - a state combination impossible if the
      two were one merged structure.

## Functional acceptance

- [x] Payment states: `initiated -> authorized -> captured ->
      (refunded | partially_refunded)`, plus `failed`/`expired`. COD:
      `initiated -> confirmed`. (`authorize` as a distinct pre-capture
      step is modelled in the enum but not separately exercised -
      Razorpay's integration used here auto-captures, per
      `payment-provider.ts`'s own docblock.)
- [x] The platform never handles or stores raw card data — the
      checkout flow opens Razorpay's hosted, tokenized Checkout.js
      widget (`apps/storefront/src/lib/razorpay.ts`); the platform only
      ever receives the order id, an opaque payment id, and a signed
      webhook payload, never card details.

## Financial integrity (binding — highest priority in this milestone)

- [x] Idempotency keys are present and enforced on every payment-
      affecting operation (`Payment.idempotencyKey` unique constraint;
      checkout/retry both key off it).
- [x] Webhook signature verification rejects unsigned/incorrectly-
      signed payloads (`test/integration/payment.test.ts`, negative
      scenario #3).
- [x] **A webhook delivered twice for the same event does not capture
      or refund twice** — verified with an automated test that replays
      the same webhook payload and asserts only one state change
      occurred (`test/integration/payment.test.ts`, negative scenario
      #2).
- [x] A payment stuck in `pending` beyond its configured timeout is
      handled distinctly from `failed` (different customer messaging,
      different retry eligibility) - `PaymentService.expireStalePayments()`,
      negative scenario #4.

## Negative scenarios / edge cases

All four covered by `test/integration/payment.test.ts` (checkout
session stays the same session throughout, one `CheckoutSession`, one
reservation - only the `Payment` row is retried):

1. [x] Payment fails on first attempt, customer retries successfully from
   the same cart → exactly one order created, reservation preserved
   through the retry window.
2. [x] Duplicate webhook for a `captured` event → second delivery is a
   safe no-op.
3. [x] Webhook with an invalid signature → rejected and logged, no state
   change.
4. [x] Payment authorized but never captured within a configured window →
   handled explicitly (released/expired), not left indefinitely
   ambiguous.

## Authorization

- [ ] Refund-initiation endpoints require appropriate role
      (`acceptance/m20-refunds-store-credit.md`). **Deliberately out of
      this milestone's scope** - `PaymentProvider.refund()` exists and
      is a real, correct method, but no HTTP route calls it yet; wiring
      an authorized refund-initiation endpoint is `specs/19-refunds.md`
      / M20's own milestone (see `specs/13-payment.md`'s "Remaining
      open items"). The `payment:refund` permission is already seeded
      (FINANCE role) ready for that milestone to use.

## Auditability

- [x] Every payment state transition is logged with the provider's
      reference ID for reconciliation (`recordAudit` calls in
      `PaymentService.applyOutcome`/`expireStalePayments`, each carrying
      `providerReferenceId`).

## Security

- [x] PCI scope is minimized — confirmed via architecture review that
      no raw card data path touches platform servers: the platform only
      ever calls Razorpay's REST API (order creation, refund) and opens
      Razorpay's own hosted Checkout.js widget client-side; no card
      field is ever rendered, read, or transmitted through
      platform-owned code.

## Test requirements

- [x] Idempotency and duplicate-webhook tests are mandatory, automated,
      and run in CI — not manually verified once
      (`test/integration/payment.test.ts`, part of
      `npm run test:integration`, which CI runs on every push).
- [x] Integration tests: full authorize→capture flow (webhook-driven
      capture, `CAPTURED`/`CONFIRMED`), COD confirm flow
      (`test/integration/checkout.test.ts`, pre-existing from M13,
      unaffected), failure/retry flow.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This milestone is
not done without the financial-integrity tests passing under automated,
repeatable test conditions. **IMPLEMENTED, TESTED, ENGINEERING_VERIFIED**
(2026-09-23 Phase 2 build). **2026-09-24 certification repair pass,
finding #3 (BLOCKER):** an independent reviewer identified that a
genuine Razorpay capture webhook could race the payment-expiry/
reservation-TTL sweep and either silently lose the captured payment or
fabricate an allocation for stock that was already released. Fixed with
an explicit capture/expiry reconciliation state machine (row-locked
Payment/InventoryReservation transitions, a new
`CAPTURE_RECONCILIATION_REQUIRED` CheckoutSession terminal state for
the case where inventory genuinely cannot be re-derived safely) and 5
new adversarial tests proving each race outcome - see
`services/commerce-api/src/modules/payment/service.ts` and
`test/integration/payment.test.ts`.

**2026-09-24 final certification repair pass, Blocker 2:** a further
independent review identified that `PaymentEvent`'s (provider,
providerEventId) unique-constraint dedup was applied BEFORE the
required business transition (`applyOutcome`) necessarily completed -
a transient failure between recording the event and finishing that
transition left an unrecoverable "poison" record: Razorpay's own retry
of the identical event id hit the unique constraint and was treated as
an already-handled duplicate, silently losing the event. Fixed by
adding a durable `PaymentEventStatus` (RECEIVED/PROCESSED/FAILED) to
`PaymentEvent`: only PROCESSED short-circuits a redelivery as a safe
no-op; RECEIVED or FAILED causes processing to resume against the same
row (never a second insert, never data loss, never re-running an
already-PROCESSED event) - see `handleRazorpayWebhook`'s new
`recordOrResumeEvent`/`markEventProcessed` and 10 new adversarial
tests (`test/integration/payment.test.ts`, "Payment event
processing-state durability and recovery") proving normal processing,
duplicate no-ops, injected-failure recovery, exactly-once order/
allocation/invoice outcomes, concurrent-duplicate safety, and
process-restart-equivalent recovery.
