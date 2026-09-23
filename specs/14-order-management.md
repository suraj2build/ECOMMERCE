# 14. Order Management

**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23 — see `blueprint/DECISION_REGISTER.md` `ORD-001`–`006`, and `acceptance/m15-order-management.md`)

## Purpose

Define the order entity, its full lifecycle state machine, and how it
coordinates payment, inventory allocation, fulfilment, and post-order
events.

## Scope

- Order state machine
- Order line-item-level state (for partial fulfilment/cancellation)
- Order-to-inventory allocation
- Order history / audit trail

## Approved requirements (2026-09-22)

- The order lifecycle **MUST** support: creation, confirmation,
  inventory allocation, fulfilment (including **split shipments — one
  order MAY have multiple fulfilments/packages**), shipment, delivery,
  cancellation (**allowed before shipment**, subject to configurable
  state/policy rules — see `specs/17-cancellation.md`), **partial
  cancellation** (required), returns, refunds, exchanges, RTO, and
  exception handling.
- The exact state enum implementing this shape is an engineering
  design decision at build time; the business shape above is fixed.
- **Payment state and order state MUST remain separate** (see
  `specs/13-payment.md` `PAY-002`).
- **Post-order-placement customer self-service modification of address
  or items is NOT required.** The V1 pattern is cancel/reorder, or
  controlled customer-service intervention where operationally
  possible.
- RTO on a prepaid order triggers the standard refund flow (using
  original transaction value); RTO on a COD order triggers closure
  without a refund (no payment was ever collected).
- Reservation converts to committed allocation upon successful payment
  capture (prepaid) or successful COD order acceptance.
- Every order MUST generate an invoice-equivalent document at
  confirmation, using a versioned/configurable template (see
  `specs/32-india-tax-invoicing.md`).
- Full order history MUST be retained and queryable for the customer's
  account indefinitely by default; compliance-driven retention/deletion
  periods depend on `specs/30-audit-compliance.md`'s legal verification.
- Order exceptions (undeliverable address, pick shortfall, etc.) route
  to a defined exception state requiring CS/warehouse intervention, and
  are tracked and audited.

## Remaining open items

Final invoice format (`TAX-004`) remains `UNDER_REVIEW` in
`specs/32-india-tax-invoicing.md` — engineering-ready template
mechanism exists regardless.

Implementation scope boundary (see the schema comment above the
Order/OrderLine/OrderFulfilment models in `packages/db/prisma/schema.prisma`
for the full rationale): this milestone owns the Order entity, its
state machine, order-to-inventory allocation, partial cancellation, and
the split-shipment data model. It deliberately does not include a real
carrier adapter/tracking webhook (`specs/16-shipping-tracking.md`), a
real warehouse pick-list UI (`specs/15-warehouse-fulfilment.md`),
actual refund execution via Razorpay (`specs/19-refunds.md` -
`PaymentProvider.refund()` exists and is correct, the same "built but
not yet wired to a route" honesty as `specs/13-payment.md`'s own
scope note), or return/QC processing (`specs/18-returns.md`) - all
explicitly later milestones per this spec's own "Feeds:" list below.
Where an acceptance flow (e.g. RTO) needs one of those to be fully
automatic, this milestone provides the correct state transition and
business-rule branching (e.g. COD vs. prepaid RTO closure) via an
explicit staff-triggered action instead of a simulated external event.

## Acceptance criteria

See `acceptance/m15-order-management.md`.

## Dependencies

Depends on: `specs/12-checkout.md`, `specs/13-payment.md`,
`specs/06-inventory.md`. Feeds: `specs/15-warehouse-fulfilment.md`,
`specs/16-shipping-tracking.md`, `specs/17-cancellation.md`,
`specs/18-returns.md`, `specs/19-refunds.md`, `specs/20-exchanges.md`,
`specs/21-customer-profile.md`, `specs/22-loyalty.md`.
