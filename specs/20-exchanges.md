# 20. Exchanges

**Status:** IMPLEMENTED (M21 build complete 2026-09-25, engineering
scope, repaired 2026-09-26 per independent review — see
`blueprint/DECISION_REGISTER.md` `EXC-001`–`004`; `VERIFIED` pending
independent re-review, not self-declared). The replacement's physical
forward-fulfilment integration with M16/M17's certified warehouse/
shipping pipeline was an open `DECISION_REQUIRED` (see `EXC-004`);
the Product Owner selected Option 2 on 2026-09-26 (generalize the
certified `PickTask`/`OrderFulfilment`/`Shipment` pipeline to serve an
Exchange replacement as an alternate fulfilment source), now
implemented — see `EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER"
addendum for the full design record.

## Purpose

Define exchange flows: a customer exchanging a delivered item for a
different size or colour.

## Scope

- Exchange eligibility rules
- Exchange data model
- Inventory effects
- Price difference handling

## Approved requirements (2026-09-22)

- **Support both size exchange AND colour exchange.**
- Exchange is modeled as a **first-class Exchange entity** (`EXC-001`)
  — not a linked return+new-order pair — to cleanly preserve financial
  and inventory auditability across a single coherent operation.
- **Replacement SKU availability MUST be checked and appropriately
  reserved** at exchange-request time, using the same short-lived
  reservation mechanics as `specs/06-inventory.md` `INV-002`. This
  resolves the replacement-SKU-reservation-timing gap identified during
  the Blueprint V2 audit.
- **If the replacement costs MORE, the customer pays the difference
  through an online payment flow/link/checkout** (via
  `specs/13-payment.md`'s abstraction, idempotent per the same
  requirements as any other payment operation).
- **If the replacement costs LESS, the difference becomes STORE
  CREDIT** (`specs/33-store-credit-gift-cards.md`).
- Exchange inventory effects MUST be two explicit ledger transactions
  (release original SKU + reserve/allocate replacement SKU) — never a
  silent net-zero adjustment that loses the audit trail.
- Exchange eligibility window matches the return window
  (`specs/18-returns.md` `RET-001`), configured together.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m21-exchanges.md`. See `acceptance/e2e-commerce-flows.md`
FLOWS 11–14 for size exchange, colour exchange, additional-payment
exchange, and store-credit-producing exchange.

## Dependencies

Depends on: `specs/18-returns.md`, `specs/06-inventory.md`,
`specs/13-payment.md`, `specs/33-store-credit-gift-cards.md`. Feeds:
`specs/22-loyalty.md` (points adjustment if order value changes).
