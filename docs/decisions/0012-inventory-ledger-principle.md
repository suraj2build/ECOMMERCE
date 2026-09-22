# ADR-0012: Inventory as an auditable transaction/ledger

## Status
Accepted

## Context
Inventory correctness is financially and operationally critical:
overselling, lost stock, and unexplained discrepancies directly harm
the business. A naive model (`product.quantity = N`, mutated in
place) cannot explain *why* a quantity changed, cannot support
concurrent reservation safely, and cannot be audited or reconciled
against procurement/sales/returns history.

## Decision
Inventory is modeled as an **auditable transaction/ledger**: every
change to stock is recorded as a discrete, immutable transaction
(receipt, sale, cancellation, return, adjustment, transfer, reservation,
release, damage, etc.), and current-state figures (stock on hand,
reserved, available, in transit, damaged, return pending) are derived
from the ledger rather than being the sole source of truth themselves.

## Reasoning
- A ledger makes every quantity change explainable and reconstructible
  — required for operational trust and for reconciling procurement
  (GRN), sales (orders), and returns against each other.
  See `PRODUCT.md` §2.B and `ARCHITECTURE.md` §5.
- Supports correct concurrent reservation semantics (e.g., two
  customers checking out the last unit) far more safely than a bare
  mutable counter.
- Enables future analytics and audit/compliance requirements
  (`specs/30-audit-compliance.md`) without redesigning the core model.

## Reasoning (continued) — what this decision does NOT do
This ADR fixes the *architectural shape* (ledger, not mutable
counter). It does **not** fix the exact set of transaction types,
state names, or business rules for reservation timeouts, oversell
policy, etc. — those are defined in `specs/06-inventory.md`, which
must reach `APPROVED` status before implementation.

## Consequences
- No code may treat a single "quantity" field as the authoritative,
  directly-mutated source of truth for stock.
- Every inventory-affecting operation elsewhere in the system
  (purchase order receipt, order placement, cancellation, return,
  transfer) must write a ledger entry, not just update a derived
  cache/counter.
- Derived "current stock" views/tables are allowed as a performance
  optimization but must always be reconstructable from the ledger.
