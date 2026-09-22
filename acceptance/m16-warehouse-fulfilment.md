# M16 — Warehouse / Fulfilment Acceptance Criteria

**Spec(s):** `specs/15-warehouse-fulfilment.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Pick lists can be generated per order/location, and pack
      confirmation triggers the ship handoff.
- [ ] Split-shipment packing works — a subset of an order's lines can
      be packed/shipped independently.

## Functional acceptance

- [ ] Pick exception (item missing/damaged at pick) posts an
      authorized inventory adjustment and triggers the order-exception
      path with notification to Warehouse Manager and CS.

## Data integrity

- [ ] Every pick/pack action that consumes inventory posts the
      corresponding ledger transaction.

## Authorization

- [ ] Only Warehouse Operator/Manager roles can record pick/pack
      actions.

## Positive scenarios

1. Standard pick → pack → ship handoff for a single-location order.
2. Pick exception on one line of a multi-line order → that line routes
   to exception handling, other lines proceed.

## Negative scenarios / edge cases

1. Attempt to pack more than the allocated quantity for a line →
   blocked.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 8.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
