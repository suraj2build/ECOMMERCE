# M15 — Order Management Acceptance Criteria

**Spec(s):** `specs/14-order-management.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] An order progresses through creation, confirmation, allocation,
      fulfilment, shipment, delivery per the approved state shape.
- [ ] Partial cancellation works at the line-item level.
- [ ] Split shipments are supported — one order can produce multiple
      fulfilment/shipment records.
- [ ] No customer-facing address/item-edit-after-placement feature
      exists — the only post-placement paths are cancel/reorder or CS
      intervention.

## Functional acceptance

- [ ] Order state and payment state (`acceptance/m14-payment.md`)
      remain independently trackable and independently queryable.
- [ ] An invoice document is generated at order confirmation (using the
      M08 scaffolding).
- [ ] RTO on a prepaid order triggers the refund flow; RTO on COD
      triggers closure without a refund.

## Data integrity

- [ ] Order-to-inventory allocation is traceable to the exact
      reservation it converted from.

## Auditability

- [ ] Full order history (every state transition) is retained and
      queryable indefinitely by default.

## Positive scenarios

1. Standard single-item prepaid order: full lifecycle to delivery.
2. Multi-item order: one line ships immediately, another is
   back-ordered internally and ships later as a second shipment — both
   linked to the same order, customer sees both.
3. Partial cancellation: cancel one line of a multi-line order before
   shipment; remaining lines proceed unaffected.

## Negative scenarios / edge cases

1. Attempt to cancel a line already shipped → blocked (routes to
   return instead).
2. Order exception (e.g., pick shortfall discovered post-confirmation)
   → routes to a defined exception state with CS/warehouse
   notification, not silently stuck.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 7 (partial
      cancellation), FLOW 8 (pick→pack→ship→deliver), FLOW 15 (RTO).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
