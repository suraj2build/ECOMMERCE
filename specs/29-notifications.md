# 29. Notifications

**Status:** DRAFT

**Cross-cutting domain** — feeds and is fed by multiple milestones
(order updates, shipment updates, return/refund status, etc.)

## Purpose

Define transactional notifications sent to customers (and
where relevant, staff) as a result of system events — order
confirmation, shipment updates, delivery, cancellation, return/refund
status, etc. Distinct from marketing communications
(`24-marketing.md`).

## Scope

- Notification channels (email, SMS, push — exact set not yet decided)
- Event-to-notification mapping (which system events trigger which
  notification)
- Templating and localization (if applicable)
- Delivery reliability (retry, dead-lettering) and idempotency
  (avoiding duplicate notifications for the same event)

## Key architectural constraints (approved)

None domain-specific yet. Notifications should be triggered from
authoritative state changes (order status transitions, ledger-backed
events) rather than being a second, inconsistent source of truth about
what happened.

## Open questions — DECISION_REQUIRED

- Which channels are in scope for launch (email only, or email + SMS +
  push)?
- Build vs. integrate (transactional email/SMS provider) — not yet
  decided.
- Exact event -> notification mapping per domain (order, shipment,
  return, refund, exchange, loyalty) — not yet defined; depends on
  each domain's own spec reaching `APPROVED` first.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `14-order-management.md`, `16-shipping-tracking.md`,
`17-cancellation.md` through `20-exchanges.md`, `22-loyalty.md`.
