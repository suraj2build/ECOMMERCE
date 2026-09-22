# 17. Cancellation

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `CAN-001`–`003`)

## Purpose

Define customer- and system-initiated order cancellation, including
partial cancellation, and its effects on inventory, payment, and
loyalty.

## Scope

- Cancellation eligibility rules
- Full vs. partial (line-item-level) cancellation
- Effects: inventory release, payment reversal/refund trigger, loyalty
  reversal

## Approved requirements (2026-09-22)

- **Customer cancellation is allowed before shipment**, subject to
  configurable state/policy rules. Post-shipment, the customer path is
  return, not cancellation.
- **Partial cancellation MUST be supported** at the line-item level.
- Cancellation MUST release reserved/allocated inventory via a ledger
  entry (`specs/06-inventory.md`, ADR-0012), never a direct stock-count
  edit.
- Any loyalty points earned on a cancelled order/line MUST be reversed
  via a ledger entry (`specs/22-loyalty.md`, ADR-0013).
- Cancellation eligible at any state prior to shipment is available to
  both the customer (self-service) and Customer Service (assisted).
- Cancellation reason capture is **optional** (recommended, not
  mandatory) — feeds analytics where provided.
- A cancellation on a captured payment triggers the refund flow
  (`specs/19-refunds.md`) and, where applicable, a GST credit note
  (`specs/32-india-tax-invoicing.md` `TAX-005`).

## Remaining open items

Credit-note format specifics remain `UNDER_REVIEW` in
`specs/32-india-tax-invoicing.md`.

## Acceptance criteria

See `acceptance/m18-cancellation.md`.

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/06-inventory.md`.
Feeds: `specs/19-refunds.md`, `specs/22-loyalty.md`.
