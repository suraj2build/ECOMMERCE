# 14. Order Management

**Status:** DRAFT

## Purpose

Define the order entity, its full lifecycle state machine, and how it
coordinates payment, inventory allocation, fulfilment, and post-order
events (cancellation, return, refund, exchange).

## Scope

- Order state machine: payment, allocation, picking, packing,
  shipment, delivery, cancellation, partial cancellation, returns,
  refunds, exchanges, RTO, exceptions (`PRODUCT.md` §2.D)
- Order line-item-level state (for partial fulfilment/cancellation)
- Order-to-inventory allocation (ties into `06-inventory.md` reserved
  -> allocated -> shipped states)
- Order history / audit trail (ties into `30-audit-compliance.md`)

## Key architectural constraints (approved)

- Order lifecycle must support the full state set listed above
  (`PRODUCT.md` §2.D) — exact transition rules are not frozen and must
  be defined here before implementation.
- Every order state change that affects inventory must produce a
  corresponding ledger entry (ADR-0012), not just an order-table
  status update.

## Open questions — DECISION_REQUIRED

- **Complete order state machine is undefined.** This is one of the
  most consequential open decisions in the whole platform — states,
  valid transitions, and which roles/systems can trigger each
  transition are all `DECISION_REQUIRED`.
- Partial cancellation and partial shipment rules?
- RTO (return-to-origin) handling and its interaction with refunds?
- Order exception handling (e.g., undeliverable address, failed
  delivery attempts) — not yet defined.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`ORD-001` through `ORD-006`, `PAY-002`, `TAX-004`. `ORD-001` (the
complete order state machine) is flagged in `blueprint/READINESS.md`
as the single largest blocker cluster on the platform — see
`blueprint/END_TO_END_FLOWS.md` and `blueprint/ORDER_PAYMENT_INTEGRITY.md`
before attempting to resolve it.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. This spec is a
prerequisite for `17-cancellation.md` through `20-exchanges.md`, all of
which depend on the order state machine defined here.

## Dependencies

Depends on: `12-checkout.md`, `13-payment.md`, `06-inventory.md`.
Feeds: `15-warehouse-fulfilment.md`, `16-shipping-tracking.md`,
`17-cancellation.md`, `18-returns.md`, `19-refunds.md`,
`20-exchanges.md`, `21-customer-profile.md`, `22-loyalty.md`.
