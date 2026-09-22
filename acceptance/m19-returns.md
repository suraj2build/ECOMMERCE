# M19 — Returns Acceptance Criteria

**Spec(s):** `specs/18-returns.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Default 7-day return window is enforced from delivery date,
      overridable per category/product via configuration.
- [ ] Configured non-returnable categories (e.g., innerwear) correctly
      block return initiation.
- [ ] Return reason selection is mandatory — cannot submit a return
      without one.
- [ ] Refund eligibility does not fire until QC passes.

## Functional acceptance

- [ ] Self-service return initiation works from the customer's order
      history.
- [ ] Reverse logistics pickup is scheduled via the carrier abstraction
      (or drop-off, where configured).
- [ ] Return disposition (restock/write-off/return-to-supplier) posts
      the correct inventory ledger transaction — never silent
      restocking without QC.

## Negative scenarios / edge cases

1. Attempt to return an item past the window → blocked with a clear
   reason shown (not just hidden).
2. Attempt to return a configured non-returnable category → blocked
   with a clear reason.
3. Submit a return without selecting a reason → blocked.
4. Return arrives but fails QC → does not restock as sellable; refund
   eligibility per configured policy for a failed-QC return.

## Mobile behavior

- [ ] Photo upload for return condition (if required by config) uses a
      mobile-camera-friendly flow.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 9 (return → QC →
      prepaid refund) and FLOW 16 (partial return/refund).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
