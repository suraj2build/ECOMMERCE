# M17 — Shipping / Tracking Acceptance Criteria

**Spec(s):** `specs/16-shipping-tracking.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Carrier integration goes through the provider-abstraction layer
      — no carrier-specific logic exists in core fulfilment/order code.
- [ ] Customer can view shipment tracking status from their account.

## Functional acceptance

- [ ] Tracking status updates via webhook where supported, with
      polling fallback.
- [ ] Failed delivery triggers configurable redelivery attempts before
      RTO.
- [ ] Split shipments are independently tracked and both visible to
      the customer against the same order.

## Negative scenarios / edge cases

1. Carrier tracking data temporarily unavailable → storefront shows
   last-known platform status, not an error.
2. Redelivery attempts exhausted → order correctly transitions to RTO
   (`acceptance/m15-order-management.md`).

## Test requirements

- [ ] Integration tests: carrier adapter interface swap (proves
      abstraction works — a mock carrier can be substituted without
      touching fulfilment logic).
- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 15 (RTO).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
