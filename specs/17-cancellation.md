# 17. Cancellation

**Status:** DRAFT

## Purpose

Define customer- and system-initiated order cancellation, including
partial cancellation, and its effects on inventory, payment, and
loyalty.

## Scope

- Cancellation eligibility rules (time window, order status
  restrictions)
- Full vs. partial (line-item-level) cancellation
- Effects: inventory release (ledger entry, ADR-0012), payment
  reversal/refund trigger (`19-refunds.md`), loyalty reversal (ledger
  entry, ADR-0013)

## Key architectural constraints (approved)

- Cancellation must release reserved/allocated inventory via a ledger
  entry, never a direct stock-count edit (ADR-0012).
- Any loyalty points earned on a cancelled order/line must be reversed
  via a ledger entry, never a direct balance edit (ADR-0013).

## Open questions — DECISION_REQUIRED

- At what order states is cancellation allowed (e.g., can a shipped
  order be cancelled, or does it become a return instead)? Depends on
  the order state machine in `14-order-management.md`, which is itself
  undefined.
- Who can cancel — customer self-service, customer service agent, or
  both, and under what constraints?
- Cancellation reason capture — required or optional, and does it feed
  analytics/procurement decisions?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `14-order-management.md`, `06-inventory.md`. Feeds:
`19-refunds.md`, `22-loyalty.md`.
