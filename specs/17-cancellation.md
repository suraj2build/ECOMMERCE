# 17. Cancellation

**Status:** IMPLEMENTED (M18 build, 2026-09-25 — see
`acceptance/m18-cancellation.md` and `CAN-004` in
`blueprint/DECISION_REGISTER.md`. Originally APPROVED 2026-09-22 — see
`blueprint/DECISION_REGISTER.md` `CAN-001`–`003`)

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
`specs/32-india-tax-invoicing.md`; the M18 build integrates with the
existing M08 credit-note engine on a captured-payment cancellation but
does **not** resolve `TAX-005` — see `CAN-004`.

**M18 implementation scope boundaries** (see `CAN-004` for full
detail): "partial cancellation at the line-item level" is implemented
as cancelling a SUBSET OF LINES — sub-quantity cancellation of a single
multi-unit line is not supported by the current schema and would need
a re-approved spec change. The loyalty-reversal requirement below is
N/A — no loyalty ledger exists in this codebase (M23 is unauthorized
and unbuilt).

## Acceptance criteria

See `acceptance/m18-cancellation.md`.

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/06-inventory.md`.
Feeds: `specs/19-refunds.md`, `specs/22-loyalty.md`.
