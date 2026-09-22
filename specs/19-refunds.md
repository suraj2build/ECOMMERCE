# 19. Refunds

**Status:** DRAFT

## Purpose

Define how money is returned to the customer following a cancellation
or accepted return, across both gateway (Razorpay) and COD payment
methods.

## Scope

- Refund trigger points (cancellation, return acceptance)
- Refund method: original payment method (gateway reversal) vs.
  alternative (bank transfer/UPI, store credit) — particularly for COD
  orders where there is no original electronic payment to reverse
- Refund status lifecycle and customer visibility
- Interaction with the payment provider abstraction (ADR-0011)

## Key architectural constraints (approved)

- Refunds go through the payment provider abstraction (ADR-0011);
  no refund code may call a provider SDK directly.
- COD refunds must be modeled as a first-class case, not an
  afterthought — COD orders need a refund path that doesn't depend on
  reversing an online payment (`ARCHITECTURE.md` §9, ADR-0011).

## Open questions — DECISION_REQUIRED

- COD refund mechanism — bank transfer, UPI, store credit, or
  customer choice? Not yet decided.
- Store credit / wallet — is this a platform concept at all? Not yet
  decided (would need its own ledger if introduced, per the ledger
  principle in ADR-0012/0013).
- Refund timelines and partial refund rules (e.g., restocking fees, if
  any)?
- Refund reason capture and its relationship to return reason
  (`18-returns.md`)?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. Given financial
sensitivity, acceptance criteria must include double-refund prevention
and reconciliation test scenarios before this spec can be considered
ready for `APPROVED` status.

## Dependencies

Depends on: `13-payment.md`, `17-cancellation.md`, `18-returns.md`.
Feeds: `21-customer-profile.md` (refund visibility),
`27-analytics-reporting.md`.
