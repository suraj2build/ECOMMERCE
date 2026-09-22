# 06. Inventory

**Status:** IMPLEMENTED (Phase 1 build, 2026-09-22 — was APPROVED, decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `INV-001`–`007`)

## Purpose

Define the inventory ledger: the auditable system of record for all
stock movements and derived stock states across the platform. This is
the most financially and operationally critical domain in the
platform.

## Scope

- Ledger transaction types
- Derived states: stock on hand, reserved, available, in transit,
  damaged, return pending
- Reservation semantics
- Location-aware, multi-location-ready model
- Reconciliation and audit reporting

## Approved requirements (2026-09-22)

### Ledger (binding — ADR-0012)

- Inventory **MUST** use an auditable ledger. `product.quantity = N`
  as sole source of truth is prohibited.
- Minimum states: `ON_HAND`, `RESERVED`, `AVAILABLE`, `IN_TRANSIT`,
  `DAMAGED`, `RETURN_PENDING`, each backed by auditable transaction
  events.
- Approved starting transaction-type set (extensible without
  redesign): `receipt`, `qc_pass`, `qc_fail`, `reservation`,
  `reservation_release`, `allocation`, `sale/fulfilment`,
  `cancellation`, `return_received`, `return_qc_pass`,
  `return_qc_fail`, `exchange` (release + reserve pair), `RTO`,
  `adjustment` (authorized + audited only), `transfer_out`,
  `transfer_in`.
- Every SKU-affecting event anywhere in the system MUST write a ledger
  transaction — there is no code path that changes "how much stock
  exists" without going through the ledger.

### Reservation (binding)

- The platform MUST NOT reserve inventory when an item is merely added
  to cart.
- The platform MUST use **short-lived reservation during checkout/
  payment initiation only**:
  `AVAILABLE -> TEMPORARY RESERVATION -> SUCCESSFUL ORDER -> COMMITTED ALLOCATION`,
  or on failure: `AVAILABLE -> TEMPORARY RESERVATION -> PAYMENT FAILURE/TIMEOUT/ABANDONMENT -> RESERVATION RELEASED`.
- **For COD orders: inventory MUST be committed/reserved at the point
  the COD order is successfully accepted**, not merely at checkout
  start (there is no gateway step to bound a shorter window).
- Reservation expiry duration **MUST be configurable** — it MUST NOT
  be hard-coded into core logic.
- Concurrency and idempotency **MUST** ensure two customers cannot
  purchase the same final unit — this MUST be verified under
  concurrent-load testing, not assumed correct from code review alone.

### Overselling (binding)

- **Overselling MUST be prevented.** The system MUST NOT intentionally
  sell inventory beyond reliably available sellable stock. Standard
  SKUs never oversell; a distinct pre-order/backorder capability is
  **FUTURE_CONSIDERATION**, not built now.

### Location-awareness (binding)

- Every inventory transaction MUST be capable of referencing a
  **location** (`specs/31-organization-locations.md`), even though V1
  operates warehouse-only, single/few-location.
- Stock transfers between locations MUST be supported by the domain
  model (`transfer_out`/`transfer_in` pair preserving total stock
  integrity).

### Damaged / return-pending stock

- Damaged and return-pending stock **MUST NOT** automatically become
  sellable `ON_HAND` inventory — re-entry requires passing QC first.
  Disposition at QC time (restock sellable, restock as marked-down/
  damaged clearance, write-off, return-to-supplier) is a configurable
  workflow outcome.

### Manual adjustments

- Manual inventory adjustments (including cycle-count corrections)
  **MUST be authorized** (per `specs/28-admin.md` `ADM-003`) **and
  fully audited** (who/what/when/old value/new value/reference, per
  `specs/30-audit-compliance.md`).
- Safety/buffer stock is supported as a configurable per-SKU/category
  buffer subtracted from `AVAILABLE`.

## Remaining open items

None. This is the most consequential domain fully resolved by the
2026-09-22 decision session.

## Acceptance criteria

See `acceptance/m06-inventory.md`. Given the financial/integrity
sensitivity of this domain, acceptance criteria include explicit
concurrency, idempotency, and integrity test scenarios — see
`TESTING.md` §2 and `acceptance/e2e-commerce-flows.md` FLOW 6 (last-unit
concurrency).

## Dependencies

Depends on: `specs/05-grn.md`, `specs/02-product-master.md`,
`specs/31-organization-locations.md`. Feeds: `specs/07-catalog-merchandising.md`,
`specs/12-checkout.md`, `specs/14-order-management.md`,
`specs/17-cancellation.md`, `specs/18-returns.md`,
`specs/15-warehouse-fulfilment.md`, `specs/20-exchanges.md`.
