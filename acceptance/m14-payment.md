# M14 — Payment Acceptance Criteria

**Spec(s):** `specs/13-payment.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] UPI, cards, net banking, and COD are all available and
      functional payment methods.
- [ ] Order/checkout code never imports or calls the Razorpay SDK
      directly — only the internal provider-abstraction interface.
- [ ] Payment state and order state are implemented as **separate**
      data structures/fields — verified by code review AND by a test
      asserting an order can exist in a state combination that would
      be invalid if the two were merged (e.g., order `cancelled` while
      payment `captured`, pending refund).

## Functional acceptance

- [ ] Payment states: `initiated -> authorized -> captured ->
      (refunded | partially_refunded)`, plus `failed`/`expired`. COD:
      `initiated -> confirmed`.
- [ ] The platform never handles or stores raw card data — verified by
      confirming the checkout flow redirects to/embeds Razorpay's
      hosted/tokenized UI.

## Financial integrity (binding — highest priority in this milestone)

- [ ] Idempotency keys are present and enforced on every payment-
      affecting operation.
- [ ] Webhook signature verification rejects unsigned/incorrectly-
      signed payloads.
- [ ] **A webhook delivered twice for the same event does not capture
      or refund twice** — verified with an automated test that replays
      the same webhook payload and asserts only one state change
      occurred (`acceptance/e2e-commerce-flows.md` FLOW 3–5 variants).
- [ ] A payment stuck in `pending` beyond its configured timeout is
      handled distinctly from `failed` (different customer messaging,
      different retry eligibility).

## Negative scenarios / edge cases

1. Payment fails on first attempt, customer retries successfully from
   the same cart → exactly one order created, reservation preserved
   through the retry window.
2. Duplicate webhook for a `captured` event → second delivery is a
   safe no-op.
3. Webhook with an invalid signature → rejected and logged, no state
   change.
4. Payment authorized but never captured within a configured window →
   handled explicitly (released/expired), not left indefinitely
   ambiguous.

## Authorization

- [ ] Refund-initiation endpoints require appropriate role
      (`acceptance/m20-refunds-store-credit.md`).

## Auditability

- [ ] Every payment state transition is logged with the provider's
      reference ID for reconciliation.

## Security

- [ ] PCI scope is minimized — confirmed via architecture review that
      no raw card data path touches platform servers.

## Test requirements

- [ ] Idempotency and duplicate-webhook tests are mandatory, automated,
      and run in CI — not manually verified once.
- [ ] Integration tests: full authorize→capture flow, COD confirm flow,
      failure/retry flow.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This milestone is
not done without the financial-integrity tests passing under automated,
repeatable test conditions.
