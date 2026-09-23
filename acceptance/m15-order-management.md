# M15 — Order Management Acceptance Criteria

**Spec(s):** `specs/14-order-management.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23)

## Business acceptance

- [x] An order progresses through creation, confirmation, allocation,
      fulfilment, shipment, delivery per the approved state shape.
      `Order` is created in-process at genuine payment success (COD
      acceptance or Razorpay capture webhook), never via a public
      endpoint; `OrderLine.status` carries ALLOCATED → PACKED → SHIPPED
      → DELIVERED, and `Order.status` is derived from its lines.
- [x] Partial cancellation works at the line-item level
      (`OrderService.cancelOrderLine`, `test/integration/order.test.ts`
      "Partial cancellation (FLOW 7)").
- [x] Split shipments are supported — one order can produce multiple
      fulfilment/shipment records (`OrderFulfilment`, proven by the
      "Split shipment (FLOW 8)" test: two lines packed/shipped/
      delivered as two independently-tracked `OrderFulfilment` rows).
- [x] No customer-facing address/item-edit-after-placement feature
      exists — confirmed by code review: the only storefront order
      mutation is none (read-only `/storefront/orders` routes); the
      only post-placement paths are staff-triggered cancel/exception/RTO
      actions.

## Functional acceptance

- [x] Order state and payment state (`acceptance/m14-payment.md`)
      remain independently trackable and independently queryable -
      `OrderStatus`/`OrderLineStatus` are distinct enums from
      `PaymentStatus`/`CheckoutSessionStatus`, on entirely separate
      tables (`orders`/`order_lines` vs. `payments`).
- [x] An invoice document is generated at order confirmation, using the
      M08 `InvoiceService` scaffolding directly (`issueInvoice()` is
      now called in-process, exactly as that service's own docblock
      anticipated: "M15 ... will call issueInvoice() ... once the Order
      model exists").
- [x] RTO on a prepaid order flags a refund requirement
      (`Order.refundRequired`); RTO on COD closes without a refund flag
      - actual refund execution is `specs/19-refunds.md`'s own scope
      (see the spec's scope-boundary note); this milestone provides the
      correct branching, not the payment-provider call.

## Data integrity

- [x] Order-to-inventory allocation is traceable to the exact
      reservation it converted from - `OrderLine.reservationId`,
      verified by `test/integration/order.test.ts` "Data integrity:
      allocation traceability".

## Auditability

- [x] Full order history (every state transition) is retained and
      queryable indefinitely by default - every transition
      (`order.create`, `order.fulfilment.*`, `order.line.cancel`,
      `order.line.exception.*`, `order.rto`) writes an `AuditLog` row
      via the platform's single audit write path (`recordAudit`), never
      pruned, verified by the "Auditability: full order history
      retained" test.

## Positive scenarios

1. [x] Standard single-item prepaid order: full lifecycle to delivery -
   "Order creation trigger" + "Split shipment" tests together prove
   this (PREPAID capture → CONFIRMED → pack → ship → deliver →
   DELIVERED).
2. [x] Multi-item order: one line ships immediately, another is
   back-ordered internally and ships later as a second shipment — both
   linked to the same order, customer sees both ("Split shipment (FLOW
   8)" test).
3. [x] Partial cancellation: cancel one line of a multi-line order before
   shipment; remaining lines proceed unaffected ("the remaining line
   proceeds unaffected..." test).

## Negative scenarios / edge cases

1. [x] Attempt to cancel a line already shipped → blocked (routes to
   return instead) - "Negative scenario #1" test, 400 response.
2. [x] Order exception (e.g., pick shortfall discovered post-confirmation)
   → routes to a defined exception state with CS/warehouse
   notification, not silently stuck - "Negative scenario #2" test
   (flag → order status EXCEPTION → resolve → reinstated).

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 7 (partial
      cancellation) and FLOW 8 (pick→pack→ship→deliver) are covered at
      the integration-test level with full financial/ledger assertions
      (`test/integration/order.test.ts`); a browser E2E test
      (`test/e2e-storefront/orders.spec.ts`) proves a completed COD
      order is genuinely visible on the storefront's own order-history
      pages. FLOW 15 (RTO) is covered for the state-transition/refund-
      branching logic this milestone owns; the "simulate repeated
      failed delivery attempts" / real carrier-adapter portion of FLOW
      15 depends on `specs/16-shipping-tracking.md` (M17), not yet
      built - see the spec's scope-boundary note.

## Definition of Done

All boxes above checked. 15 new backend integration tests
(`test/integration/order.test.ts`) plus 1 new browser E2E test
(`test/e2e-storefront/orders.spec.ts`) — 245 total backend tests and 17
total browser E2E tests, all genuinely green locally against the
CI-mirroring `fcp_test` database.
