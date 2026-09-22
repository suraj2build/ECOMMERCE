# 13. Payment

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `PAY-001`–`006`, `IND-001`, `IND-004`)

## Purpose

Define the payment provider abstraction interface and the concrete
Razorpay and COD integrations.

## Scope

- Payment provider abstraction interface
- Razorpay integration
- COD as a non-gateway payment method
- Payment status lifecycle
- Webhook/callback handling and idempotency

## Approved requirements (2026-09-22)

### Provider abstraction (binding — ADR-0011)

- **Razorpay-first, provider-abstracted.** Interface: `initiate` /
  `authorize` / `capture` / `refund` / `handleWebhook`, with a
  provider-agnostic result/error type. Order/checkout logic MUST
  depend only on this interface, never Razorpay's SDK directly.
- Required rails: **UPI, cards, net banking, and other appropriate
  Razorpay-supported rails where configured**, plus **COD**.
- The integration **MUST** use Razorpay's hosted/tokenized flow — the
  platform **MUST NOT** handle or store raw card data at any point.

### State machine (binding)

- **Payment state and order state MUST remain separate state
  machines** — see `blueprint/ORDER_PAYMENT_INTEGRITY.md`.
- Payment states: `initiated -> authorized -> captured -> (refunded |
  partially_refunded)`, plus `failed`/`expired`. COD: `initiated ->
  confirmed` (payment collected at delivery, no capture step).

### Financial integrity (binding)

- Idempotency keys **MUST** be present on every payment-affecting
  operation.
- Webhook signature verification and deduplication by provider event
  ID **MUST** occur before any state change.
- Safe retries, reconciliation, duplicate-payment handling, payment-
  pending handling (distinct from failure), and failure recovery are
  all **required**, not best-effort.
- COD **MUST NOT** pretend to be prepaid anywhere in the payment or
  order logic — its distinct state shape (no capture step) must be
  handled explicitly, not papered over.
- Reservation from `specs/06-inventory.md` `INV-002` persists through
  configurable retry attempts and releases on final failure/timeout/
  abandonment.

### COD-specific

- COD availability rules (value cap, excluded PIN codes) are
  configurable business parameters.
- COD reconciliation (cash collected by delivery partner vs. platform
  records) is a required operational process, built on the platform's
  standard audit ledger discipline.
- Per `INV-002`, **COD orders commit/reserve inventory at successful
  order acceptance.**

## Remaining open items

None within this spec's own scope.

## Acceptance criteria

See `acceptance/m14-payment.md`. Given financial sensitivity,
acceptance criteria include idempotency, double-charge-prevention, and
duplicate-webhook test scenarios — see `acceptance/e2e-commerce-flows.md`
FLOWS 3–5.

## Dependencies

Depends on: `specs/12-checkout.md`. Feeds: `specs/14-order-management.md`,
`specs/19-refunds.md`.
