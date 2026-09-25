# M18 — Cancellation Acceptance Criteria

**Spec(s):** `specs/17-cancellation.md`
**Status:** IMPLEMENTED (2026-09-25) — see `CAN-004` in
`blueprint/DECISION_REGISTER.md` for the full design record.

## Business acceptance

- [x] Customer can self-service cancel any order line before shipment.
      `OrderService.cancelOrderLineForCustomer` (ownership-checked via
      `loadOwnedOrder`); `POST /storefront/orders/:id/lines/:lineId/cancel`.
- [x] Partial cancellation (subset of lines) works correctly. Proven by
      `cancellation.test.ts` tests #2, #19, #20 and the FLOW 7 E2E spec.
      **Scope boundary:** implemented as cancelling a subset of LINES,
      not sub-quantity within one multi-unit line — see `CAN-004`.
- [x] Cancelling a captured-payment (PREPAID) order triggers
      `refundRequired = true` and an engineering credit note against the
      correlated invoice line (`cancellation.test.ts` #17, #27). This is
      an engineering integration only — `TAX-005` (GST credit-note legal/
      statutory requirements) remains `UNDER_REVIEW`; M20 refund
      *execution* is out of scope and not implemented.
- [ ] Loyalty points earned on a cancelled order/line are reversed via
      a ledger entry. **N/A** — no loyalty ledger/points system exists
      anywhere in this codebase; M23 Loyalty is unauthorized and unbuilt.
      Documented honestly rather than fabricated — see `CAN-004`.

## Functional acceptance

- [x] Cancellation is blocked once the relevant line has shipped
      (routes to return instead). `cancellation.test.ts` #4.
- [x] Inventory reservation/allocation is released via a ledger
      transaction on cancellation (reuses `InventoryService.cancelAllocation`,
      never a direct balance edit). `cancellation.test.ts` #13-#15.

## Authorization

- [x] Both customer self-service and CS-assisted cancellation paths
      work and are independently authorized (`order:cancel` RBAC
      permission for staff; ownership check for customer/guest).
      `cancellation.test.ts` #21-#26.

## Auditability

- [x] Cancellation reason (when provided), actor, and timestamp are
      recorded via the existing `recordAudit` architecture (no parallel
      audit table); `actorType: 'CUSTOMER'` for self-service,
      `'STAFF'` with `actorStaffId` for assisted. `cancellation.test.ts`
      #25, #26.

## Negative scenarios / edge cases

1. Attempt to cancel a shipped line → blocked with a clear message
   directing to the return flow. `cancellation.test.ts` #4.
2. Cancel one line of a multi-line order → remaining lines and their
   shipment/payment proceed unaffected; refund flagged only for the
   cancelled line's original transaction value (immutable snapshot,
   never a recomputed/current price). `cancellation.test.ts` #19, #20, #27.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 7 —
      `test/e2e-storefront/cancellation.spec.ts` (desktop + mobile).
- [ ] Integration test: loyalty-points reversal on cancellation. **N/A**
      — see "Business acceptance" above; no loyalty system exists to test.

## Concurrency / idempotency (M18 §6-7, not in the original criteria
above but required by the M18 build instruction and verified)

- [x] Concurrent duplicate cancellation (same idempotency key) converges
      to exactly one effect. `cancellation.test.ts` #7.
- [x] Two different idempotency keys racing the same line converge to
      exactly one cancellation. `cancellation.test.ts` #8.
- [x] Cancel-vs-pick, cancel-vs-pack/ready-to-ship, cancel-vs-shipment-
      creation, cancel-vs-ship all converge to exactly one legal final
      state, with the SALE-vs-CANCELLATION ledger invariant proven never
      to double-post or double-release. `cancellation.test.ts` #9-#12.
      A genuine deadlock (cancel-vs-pick lock-order inversion) was
      caught by this build's own clean-state validation and fixed — see
      `CAN-004`.

## Definition of Done

All boxes above checked or explicitly marked N/A with rationale, plus
`acceptance/README.md`.
