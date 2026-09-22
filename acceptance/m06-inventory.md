# M06 — Inventory Acceptance Criteria

**Spec(s):** `specs/06-inventory.md`
**Status:** READY_FOR_IMPLEMENTATION — the platform's most
financially/operationally critical milestone.

## Business acceptance

- [ ] Inventory is **never** represented by a single mutable
      `quantity` field anywhere in the codebase — every change is a
      ledger transaction.
- [ ] `AVAILABLE` stock shown to a customer is always reconstructable
      from the transaction log alone (no derived cache can silently
      diverge from the ledger's truth).
- [ ] **Overselling never occurs** under any tested concurrent-load
      scenario (see Concurrency below) — this is the single most
      important pass/fail criterion in this milestone.

## Functional acceptance

- [ ] All approved transaction types are implemented: `receipt`,
      `qc_pass`, `qc_fail`, `reservation`, `reservation_release`,
      `allocation`, `sale/fulfilment`, `cancellation`,
      `return_received`, `return_qc_pass`, `return_qc_fail`,
      `exchange`, `RTO`, `adjustment` (authorized+audited only),
      `transfer_out`/`transfer_in`.
- [ ] Every transaction references a Location (`specs/31-organization-locations.md`).
- [ ] Reservation is created **only** at checkout/payment-initiation
      start (never at add-to-cart) and for COD **only** at successful
      order acceptance.
- [ ] Reservation timeout is read from configuration, not a hard-coded
      constant — changing the config value changes behavior without a
      code deployment.

## Data integrity

- [ ] `ON_HAND`, `RESERVED`, `AVAILABLE`, `IN_TRANSIT`, `DAMAGED`,
      `RETURN_PENDING` are all correctly derivable at any point in time
      by replaying the transaction log for a SKU+Location.
- [ ] A `transfer_out`/`transfer_in` pair preserves total stock across
      both locations exactly (no stock created or destroyed in
      transit).
- [ ] Damaged/return-pending stock never appears in `AVAILABLE` without
      first passing a `qc_pass`/`return_qc_pass` transaction.

## Concurrency & idempotency (binding — highest-priority tests in this milestone)

- [ ] **Last-unit test:** two simulated concurrent checkout attempts
      for the same SKU with exactly 1 unit `AVAILABLE` — exactly one
      succeeds, the other receives a clear out-of-stock response, and
      the ledger shows exactly one `reservation` transaction, not two
      (see `acceptance/e2e-commerce-flows.md` FLOW 6).
- [ ] A duplicated/retried reservation request (same idempotency key)
      does not create a second reservation transaction.
- [ ] A duplicated inventory-affecting webhook/event (e.g., a retried
      order-confirmation signal) does not duplicate the `allocation`
      transaction.

## Authorization

- [ ] Manual `adjustment` transactions require Warehouse Manager (or
      above) role and a mandatory justification field; Finance
      co-approval required above a configurable value threshold.

## Auditability

- [ ] Every transaction records who/what/when/reference — including
      system-triggered transactions (reference the triggering
      order/GRN/return ID).

## Positive scenarios

1. Standard purchase: reservation → payment success → allocation →
   sale/fulfilment; `AVAILABLE` decreases correctly at each step and
   never double-counts.
2. Payment failure: reservation → payment fails → reservation released
   within the configured timeout; `AVAILABLE` returns to its prior
   value (FLOW 5).
3. Cancellation before shipment: allocation reversed, `AVAILABLE`
   restored.
4. Transfer between two locations: stock leaves source `ON_HAND`,
   passes through `IN_TRANSIT`, arrives at destination `ON_HAND` — sum
   across both locations is constant throughout.

## Negative scenarios / edge cases

1. Attempt to sell below zero `AVAILABLE` → rejected at the reservation
   step, never allowed to reach payment.
2. A reservation that times out without a payment outcome is
   automatically released — verified with a clock-driven or
   time-manipulated test, not just code inspection.
3. An `adjustment` submitted without a justification field → rejected.
4. Two concurrent manual adjustments to the same SKU do not lose one
   of the two updates (no lost-update race condition).

## Mobile / Desktop behavior

N/A directly (backend domain) — verified indirectly through
`acceptance/m12-wishlist-cart.md` and `acceptance/m13-checkout.md`'s
availability display on both viewports.

## API / Database behavior

- [ ] Reservation and allocation operations are implemented as atomic
      database operations (row-level locking or equivalent) — not
      read-then-write application-level logic vulnerable to a race.

## Security

- [ ] Manual adjustment endpoints are authorization-gated server-side,
      independent of UI.

## Performance expectations

- [ ] Reservation check/create completes within the checkout-API
      latency target (`NFR-001`) even under concurrent load on a
      hot/low-stock SKU.

## Observability

- [ ] Every reservation timeout/release event is logged and
      queryable — operations should be able to see reservation-churn
      patterns.

## Test requirements

- [ ] Unit tests: ledger transaction posting logic, derived-state
      calculation.
- [ ] Integration tests: full reservation lifecycle (all four end
      states: converted to allocation, released on failure, released on
      timeout, released on abandonment).
- [ ] **Concurrency/load tests are mandatory for this milestone** —
      the last-unit scenario (FLOW 6) must be automated and run in CI
      or a dedicated load-test stage, not verified manually once.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Given this
domain's criticality, this milestone is **not** done merely because
the happy path works — the concurrency and negative scenarios above
are equally mandatory.
