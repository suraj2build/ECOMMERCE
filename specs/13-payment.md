# 13. Payment

**Status:** DRAFT

## Purpose

Define the payment provider abstraction interface and the concrete
Razorpay and COD integrations.

## Scope

- Payment provider abstraction interface (methods every provider must
  implement: authorize, capture, refund, webhook handling)
- Razorpay integration (online gateway)
- COD as a non-gateway payment method
- Payment status lifecycle and its relationship to order status
  (`14-order-management.md`)
- Webhook/callback handling and idempotency

## Key architectural constraints (approved — binding, see ADR-0011)

- All payment integrations go through the abstraction layer; no
  order/checkout/refund code may reference a provider SDK directly.
- COD is a first-class payment method, not a special case.
- Adding a future provider must not require changes to order/checkout
  logic.

## Open questions — DECISION_REQUIRED

- Exact abstraction interface shape (methods, error model) — not yet
  designed.
- Partial payment / split payment support (e.g., partial COD + partial
  prepaid) — in scope or future?
- Retry/failure handling policy for failed payment attempts?
- PCI/compliance posture — assumption is provider-hosted flows avoid
  raw card data (`SECURITY.md` §4), needs explicit confirmation once
  Razorpay integration is designed.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`PAY-001` through `PAY-006`, `IND-001`, `IND-004`. See
`blueprint/ORDER_PAYMENT_INTEGRITY.md` for the critical clarification
that payment state and order state are separate state machines, plus
the idempotency and webhook-handling requirements this spec must
satisfy.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. Given financial
sensitivity, acceptance criteria must include idempotency and
double-charge-prevention test scenarios before this spec can be
considered ready for `APPROVED` status.

## Dependencies

Depends on: `12-checkout.md`. Feeds: `14-order-management.md`,
`19-refunds.md`.
