# 15. Warehouse / Fulfilment

**Status:** DRAFT

## Purpose

Define warehouse-side fulfilment operations: pick, pack, and
handoff to shipping, including how orders are allocated to warehouse
staff/processes.

## Scope

- Pick list generation and picking workflow
- Packing workflow (including partial-order packing if applicable)
- Warehouse staff roles (depends on `01-auth-rbac.md`)
- Exception handling during pick/pack (e.g., item not found, damaged
  at pick)
- Multi-warehouse routing (if applicable — depends on
  `06-inventory.md` open question on multi-location support)

## Key architectural constraints (approved)

- Pick/pack actions that consume or adjust inventory must post ledger
  entries (ADR-0012).

## Open questions — DECISION_REQUIRED

- Single-warehouse or multi-warehouse for initial build? (Same open
  question as in `06-inventory.md`.)
- Pick/pack technology — barcode scanning, mobile app, or paper-based
  initially?
- How pick exceptions (item missing/damaged at pick time) feed back
  into inventory (creates a ledger adjustment + triggers order
  exception in `14-order-management.md`)?

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `14-order-management.md`, `06-inventory.md`. Feeds:
`16-shipping-tracking.md`.
