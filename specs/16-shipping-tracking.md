# 16. Shipping / Tracking

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `SHIP-001`–`004`)

## Purpose

Define shipment creation, carrier integration, and delivery tracking.

## Scope

- Shipment creation from a packed order
- Carrier integration (provider abstraction)
- Tracking status updates and customer-facing display
- Delivery confirmation

## Approved requirements (2026-09-22)

- Carrier integration **MUST** go through a **provider-abstraction
  layer**, mirroring the payment abstraction pattern (`specs/13-payment.md`
  `PAY-001`) — carriers MUST be replaceable without rewriting
  fulfilment logic. Record this alongside ADR-0011 as a new ADR at
  implementation time.
- The specific carrier(s) used at launch are selected via
  configuration and confirmed operationally before go-live — this does
  not block building the abstraction layer itself.
- Tracking updates are webhook-driven where the carrier adapter
  supports it, with polling as a configurable fallback.
- Failed delivery triggers a configurable redelivery-attempt count
  (engineering default: 2) before the shipment is marked RTO
  (`specs/14-order-management.md` `ORD-003`).
- Customer shipment tracking is **required**, degrading gracefully
  (showing last-known platform status) if carrier tracking data is
  temporarily unavailable.
- Shipment records MUST support split shipments — multiple shipments
  per order, each independently tracked.

## Remaining open items

None (carrier *selection* is an operational task, not a blocking
decision).

## Acceptance criteria

See `acceptance/m17-shipping-tracking.md`.

## Dependencies

Depends on: `specs/15-warehouse-fulfilment.md`. Feeds:
`specs/14-order-management.md`, `specs/21-customer-profile.md`,
`specs/29-notifications.md`.
