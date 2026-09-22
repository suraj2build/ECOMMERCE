# 20. Exchanges

**Status:** DRAFT

## Purpose

Define exchange flows (e.g., a customer wants a different size/color of
the same or a different item in place of a return-for-refund).

## Scope

- Exchange eligibility rules
- Exchange flow: is it modeled as return + new order, or a dedicated
  linked transaction type? **Undecided** (see `18-returns.md` open
  questions).
- Inventory effects: release of original SKU (ledger entry) and
  reservation/allocation of replacement SKU
- Price difference handling (exchange for a different-priced item)

## Key architectural constraints (approved)

- Whatever the exchange model, all inventory effects must be ledger
  entries (ADR-0012), and the exchange must not be modeled as a silent
  net-zero adjustment that loses the audit trail of what actually
  happened.

## Open questions — DECISION_REQUIRED

- Exchange data model: linked pair of (return + new order), or a
  single first-class "exchange" entity? Not yet decided — this is the
  primary open design question for this domain.
- Is exchange limited to same-style/different-variant, or any product?
- Price difference handling (customer pays more / gets refund
  difference)?
- Exchange eligibility window — same as return window or different?

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`EXC-001` through `EXC-003`. See also
`blueprint/FASHION_DOMAIN_GAPS.md` for the replacement-SKU-reservation
timing question surfaced during the audit (not yet assigned a
decision ID — recommend adding once `EXC-001` is decided).

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `18-returns.md`, `06-inventory.md`, `13-payment.md`
(price difference settlement). Feeds: `22-loyalty.md` (points
adjustment if order value changes).
