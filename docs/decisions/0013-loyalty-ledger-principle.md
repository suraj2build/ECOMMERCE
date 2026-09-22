# ADR-0013: Loyalty as an auditable transaction/ledger

## Status
Accepted

## Context
Loyalty points/credit are a form of customer-facing financial value.
A mutable "points balance" field alone cannot explain how a balance
was reached, cannot safely support reversal (e.g., points earned on an
order that is later returned), and cannot be audited.

## Decision
Loyalty is modeled as an **auditable transaction/ledger**: earn,
redeem, reverse, expire, and adjust are each recorded as discrete
ledger entries; a customer's current balance is derived from the
ledger.

## Reasoning
- Mirrors the inventory ledger principle (ADR-0012) for the same
  underlying reason: financially meaningful state must be
  reconstructable and auditable, not just a mutable number.
- Supports correct handling of edge cases inherent to a fashion
  commerce lifecycle — e.g., points earned on an order must be
  reversible if that order is later cancelled, returned, or refunded
  (`specs/17-cancellation.md`, `specs/18-returns.md`,
  `specs/19-refunds.md`) — without ad hoc balance patches.
- See `PRODUCT.md` §2.C and `ARCHITECTURE.md` §6.

## Consequences
- Exact loyalty rules (earn rates, redemption rules, expiry policy)
  are **not** fixed by this ADR — they belong in
  `specs/22-loyalty.md`, which must reach `APPROVED` before
  implementation.
- Any code that touches a customer's loyalty standing must do so by
  writing a ledger entry, never by directly mutating a balance field.
