# Inventory Integrity Blueprint

**Purpose:** Document the conceptual inventory integrity model in
enough detail that the Product Owner can see exactly what decisions
are needed to make the inventory ledger reliable, without this
document itself finalizing any accounting or state-transition rule
that hasn't been approved. This expands ADR-0012 and
`specs/06-inventory.md` into an operational picture.

**This document does not itself decide anything — it records and
explains decisions made elsewhere.** Every rule below is either
already architecturally fixed (ADR-0012 — ledger, not mutable counter)
or resolved via `blueprint/DECISION_REGISTER.md`, referenced by its
decision ID (see §4 for the full resolution status, updated
2026-09-22).

## 1. The derived states (minimum set, per `ARCHITECTURE.md` §5)

| State | Meaning | Derived from |
|---|---|---|
| ON HAND | Physical stock present at a location, regardless of reservation status | Sum of receipts minus sum of outbound movements |
| RESERVED | Stock held against an in-progress cart/checkout, not yet committed to a confirmed order | Active `reservation` transactions not yet released or converted to `allocation` |
| AVAILABLE | Sellable stock = ON HAND − RESERVED − DAMAGED − RETURN PENDING (exact formula subject to `INV-001`) | Derived, not stored directly, per ADR-0012 |
| IN TRANSIT | Stock dispatched from one location toward another (supplier→warehouse, or warehouse→warehouse if multi-location) but not yet received | Open `transfer_out` without matching `transfer_in`, or open PO shipment before GRN |
| DAMAGED | Stock identified as unsellable via QC (at GRN or at return) | `damaged` transactions |
| RETURN PENDING | Stock a customer has initiated a return for but which has not yet been physically received/QC'd | `return_pending` transactions |

**This set is a minimum, not necessarily exhaustive** — `INV-001` asks
the Product Owner to confirm or extend it.

## 2. Candidate ledger events (input to `INV-001`)

| Event | Produces | Consumes/reduces | Notes |
|---|---|---|---|
| GRN receipt (QC passed) | ON HAND ↑ | — (or IN TRANSIT ↓ if tracked) | See flow 2 in `END_TO_END_FLOWS.md` |
| QC pass | Confirms sellable status | — | May be folded into GRN receipt rather than a distinct transaction — **open**, `INV-001` |
| QC fail | DAMAGED ↑ | — | See `GRN-002` for resolution path |
| Reservation | RESERVED ↑ | AVAILABLE ↓ (derived) | Trigger point **open**, `INV-002` |
| Reservation release | RESERVED ↓ | AVAILABLE ↑ (derived) | Triggered by cart abandonment, checkout failure, or timeout |
| Allocation | RESERVED → committed | — | Converts a reservation into a firm, order-linked commitment; timing **open**, `ORD-005` |
| Sale/fulfilment | ON HAND ↓ | ALLOCATED cleared | Trigger point (pack vs. ship) **open**, part of `INV-001` |
| Cancellation | Reverses reservation/allocation | ON HAND unaffected if pre-fulfilment; reversed if post-fulfilment (rare, needs its own path) | See `CAN-001` |
| Return received | RETURN PENDING ↑ | — | On customer-initiated pickup/drop-off |
| Return QC pass | ON HAND ↑ (restock) | RETURN PENDING ↓ | Disposition rule **open**, `INV-006` |
| Return QC fail | DAMAGED ↑ | RETURN PENDING ↓ | |
| Exchange | Release original SKU + reserve replacement SKU | — | Must be two explicit transactions, not a net adjustment — see `EXC-001`, `FASHION_DOMAIN_GAPS.md` (replacement SKU reservation timing) |
| RTO | ON HAND ↑ (on physical return to warehouse) | — | Subject to the same QC disposition question as Return | 
| Adjustment | ON HAND ↑ or ↓ | — | Manual correction; requires authorization workflow, `ADM-003` |
| Transfer out | ON HAND ↓ at source, IN TRANSIT ↑ | — | Only relevant if multi-location (`INV-004`) |
| Transfer in | IN TRANSIT ↓, ON HAND ↑ at destination | — | Only relevant if multi-location (`INV-004`) |

**This table is the working draft for `INV-001`.** The Product Owner's
job is to confirm, remove, or add rows — not to invent the final
schema (that's an engineering task, once the business events are
confirmed).

## 3. What "reliable" means for this ledger

For the inventory ledger to be trustworthy, the following properties
must hold once implemented (these are testable, and belong in
`TESTING.md` §2 / `acceptance/README.md` once build starts):

1. **Every derived state is reconstructable from the transaction log
   alone.** If the "available" figure shown to a customer and the sum
   of transactions disagree, that's a defect by definition (ADR-0012).
2. **No transaction is ever mutated after the fact.** Corrections are
   new transactions (e.g., a reversing adjustment), never edits to a
   past record — this is what makes the ledger auditable.
3. **Reservation and release must be safe under concurrency.** Two
   customers racing for the last unit of a SKU must not both succeed —
   this needs an explicit concurrency-safe implementation (e.g.,
   row-level locking or an atomic decrement-with-check), a detail for
   the engineering design once `INV-002` fixes the reservation model.
4. **Every SKU-affecting event elsewhere in the system (GRN, order,
   cancellation, return, exchange, transfer, admin adjustment) must
   write a ledger transaction — there is no code path that changes
   "how much stock exists" without going through the ledger.**

## 4. Decisions that made this ledger reliable — RESOLVED (2026-09-22)

Every decision in the table below was `OPEN` when this document was
first written and is now `DECIDED` — see
`blueprint/DECISION_REGISTER.md` for each one's full resolution text.

| Decision | What it resolved | Status |
|---|---|---|
| `INV-001` | The transaction type list itself | **DECIDED** — starting set adopted (§2 above) |
| `INV-002` | Whether "available" has a stable meaning before checkout | **DECIDED** — reservation only at checkout/payment-initiation, never add-to-cart |
| `INV-003` | Whether oversell/pre-order needs a distinct state | **DECIDED** — overselling MUST be prevented; no general oversell/pre-order in V1 |
| `INV-004` / `ORG-002` | Whether every transaction needs a location dimension | **DECIDED** — yes, location-aware from day one (`specs/31-organization-locations.md`) |
| `INV-005` | Whether AVAILABLE excludes a safety-stock buffer | **DECIDED** — configurable buffer supported |
| `INV-006` | Return/RTO/QC-fail disposition | **DECIDED** — never auto-re-enters ON_HAND without QC |
| `GRN-001` | QC pass/fail criteria | **DECIDED** — QC required; checklist content configurable |
| `ADM-003` | Manual `adjustment` authorization | **DECIDED** — Warehouse Manager+, justification required, Finance co-approval above threshold |
| `EXC-001` | Exchange transaction model | **DECIDED** — first-class Exchange entity, two explicit ledger transactions |

`specs/06-inventory.md` is now `APPROVED`, and **M06 Inventory** is
`READY_FOR_IMPLEMENTATION` in `BUILD_PLAN.md` — see
`blueprint/READINESS.md` for the current, authoritative per-milestone
readiness classification (implementation itself still requires
separate, explicit human authorization).
