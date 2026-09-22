# 06. Inventory

**Status:** DRAFT

## Purpose

Define the inventory ledger: the auditable system of record for all
stock movements and derived stock states across the platform.

## Scope

- Ledger transaction types: receipts (from GRN), sales (from orders),
  cancellations, returns, transfers, adjustments, reservations,
  releases, damage
- Derived states: stock on hand, reserved, available, in transit,
  damaged, return pending
- Reservation semantics (how/when stock is reserved during checkout,
  and released on timeout/cancellation)
- Multi-location/warehouse support (if applicable)
- Reconciliation and audit reporting

## Key architectural constraints (approved — binding, see ADR-0012)

- Inventory **must** be modeled as an auditable transaction/ledger.
  `product.quantity = N` as the sole source of truth is explicitly
  disallowed.
- Every inventory-affecting operation elsewhere in the system must
  write a ledger entry.
- Derived "current stock" figures may be cached/materialized for
  performance but must always be reconstructable from the ledger.

## Open questions — DECISION_REQUIRED

- Exact list of ledger transaction types and their required fields —
  the set in `ARCHITECTURE.md` §5 is a minimum, not necessarily
  exhaustive.
- Reservation timeout duration and what triggers release (cart
  abandonment, checkout failure, payment timeout)?
- Oversell policy — is oversell ever permitted (e.g., pre-order), and
  if so how is it modeled in the ledger?
- Multi-warehouse/multi-location support — in scope for initial build,
  or single-location initially?
- Safety stock / buffer stock rules — business-owned, not yet defined.
- How damaged/return-pending stock re-enters sellable inventory (if
  ever) — depends on `05-grn.md` and `18-returns.md` resolution.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. Given the
financial/integrity sensitivity of this domain, acceptance criteria
must include explicit concurrency and integrity test scenarios (see
`TESTING.md` §2) before this spec can be considered ready for
`APPROVED` status.

## Dependencies

Depends on: `05-grn.md` (receipts), `02-product-master.md` (SKU
identity). Feeds: `07-catalog-merchandising.md` (availability),
`12-checkout.md` (reservation), `14-order-management.md`,
`17-cancellation.md`, `18-returns.md`, `15-warehouse-fulfilment.md`.
