# 29. Notifications

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `NOTIF-001`)

**Cross-cutting domain.**

## Purpose

Define transactional notifications sent to customers (and staff where
relevant) as a result of system events.

## Scope

- Notification channels
- Event-to-notification mapping
- Delivery reliability and idempotency

## Approved requirements (2026-09-22)

- **Architecture MUST support SMS, WhatsApp, Email, and Push** via a
  **provider abstraction** — order/business logic MUST NOT be coupled
  directly to one messaging provider (explicit, §15).
- Actual providers/configuration are selected later, deferred to
  operational decision — not a build blocker.
- Notifications MUST be triggered from authoritative state changes
  (order status transitions, ledger-backed events), never a second,
  inconsistent source of truth.
- Duplicate-event handling (a retried trigger must not send the same
  notification twice) follows the same idempotency discipline as
  payment/refund operations.

## Remaining open items

None. Provider selection is deferred operational configuration.

## Acceptance criteria

See `acceptance/m29-admin-cms.md` (notifications are validated
alongside admin/cross-cutting milestones — see also each triggering
domain's own acceptance doc for its specific notification events).

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/16-shipping-tracking.md`,
`specs/17-cancellation.md` through `specs/20-exchanges.md`,
`specs/22-loyalty.md`.
