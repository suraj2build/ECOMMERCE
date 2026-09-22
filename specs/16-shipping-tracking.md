# 16. Shipping / Tracking

**Status:** DRAFT

## Purpose

Define shipment creation, carrier integration, and delivery tracking
visible to both operations and the customer.

## Scope

- Shipment creation from a packed order
- Carrier integration (courier/logistics provider abstraction — should
  likely mirror the payment provider abstraction principle, ADR-0011,
  for the same replaceability reason)
- Tracking status updates (carrier webhook/polling) and customer-facing
  tracking display
- Delivery confirmation and its effect on order status
  (`14-order-management.md`)

## Key architectural constraints (approved)

None beyond the general platform baseline. **Recommendation (not yet
an ADR):** carrier integrations should go through a provider
abstraction analogous to payments (ADR-0011), so carriers are
replaceable without rewriting order/fulfilment logic — this should be
proposed as a new ADR when this spec is designed in detail.

## Open questions — DECISION_REQUIRED

- Which carrier(s) are supported initially? Not yet decided.
- Real-time tracking (webhook-driven) vs. polling — not yet decided.
- Failed delivery / redelivery attempt policy — business-owned, not
  yet defined (feeds RTO handling in `14-order-management.md`).

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `15-warehouse-fulfilment.md`. Feeds:
`14-order-management.md` (delivery status), `21-customer-profile.md`
(order tracking visibility), `29-notifications.md` (shipment updates).
