# 15. Warehouse / Fulfilment

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `WH-001`, `WH-002`)

## Purpose

Define warehouse-side fulfilment operations: pick, pack, and handoff to
shipping.

## Scope

- Pick list generation and picking workflow
- Packing workflow (including split-shipment packing)
- Exception handling during pick/pack

## Approved requirements (2026-09-22)

- Manual/UI-based pick-pack is sufficient at launch (matches the given
  operating scale of 1,000–10,000 orders/day); the architecture MUST
  NOT block adding barcode/scanning later without redesign.
- Pick/pack actions that consume or adjust inventory MUST post ledger
  entries (`specs/06-inventory.md`).
- A pick exception (item missing/damaged at pick time) MUST post an
  authorized/audited inventory adjustment and trigger the
  `specs/14-order-management.md` order-exception path; Warehouse
  Manager and Customer Service are notified.
- Fulfilment MUST support split shipments — packing and shipping a
  subset of an order's lines independently.
- Every fulfilment action MUST reference the operating location
  (`specs/31-organization-locations.md`).

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m16-warehouse-fulfilment.md`.

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/06-inventory.md`.
Feeds: `specs/16-shipping-tracking.md`.
