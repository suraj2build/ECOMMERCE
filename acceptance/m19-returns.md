# M19 — Returns Acceptance Criteria

**Spec(s):** `specs/18-returns.md`
**Status:** M19 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `RET-005`. Not self-declared
`VERIFIED`; independent review pending.

## Business acceptance

- [x] Default 7-day return window is enforced from delivery date,
      overridable per category/product via configuration
      (`RETURN_WINDOW_DEFAULT_DAYS`, `ReturnPolicy` style/category
      override rows — `returns.test.ts` tests #1–5).
- [x] Configured non-returnable categories (e.g., innerwear) correctly
      block return initiation (`returns.test.ts` test #4/5).
- [x] Return reason selection is mandatory — cannot submit a return
      without one (`returns.test.ts` test #6; storefront form requires
      it client-side too, server is authoritative).
- [x] Refund eligibility does not fire until QC passes
      (`ReturnLine.refundEligible` set only on `qcResult = PASS` —
      `returns.test.ts` tests #20–23).

## Functional acceptance

- [x] Self-service return initiation works from the customer's order
      history (`returns.spec.ts` browser E2E, and `returns.test.ts`
      test #11).
- [x] Reverse logistics pickup is scheduled via the carrier abstraction
      (or drop-off, where configured) (`returns.test.ts` tests #15–16,
      reusing `ShippingProvider.initiateReversePickup`).
- [x] Return disposition (restock/write-off/return-to-supplier) posts
      the correct inventory ledger transaction — never silent
      restocking without QC (`returns.test.ts` tests #20–23; INV-006
      gate).

## Negative scenarios / edge cases

1. [x] Attempt to return an item past the window → blocked with a clear
   reason shown (`returns.test.ts` test #3).
2. [x] Attempt to return a configured non-returnable category → blocked
   with a clear reason (`returns.test.ts` test #4).
3. [x] Submit a return without selecting a reason → blocked
   (`returns.test.ts` test #6).
4. [x] Return arrives but fails QC → does not restock as sellable
   (`returns.test.ts` tests #21–23); refund eligibility for a
   failed-QC return is a genuinely undecided business rule the
   approved spec never resolves — engineering default is `false`
   (no automatic financial consequence either way), documented as
   `RET-005` in `blueprint/DECISION_REGISTER.md` rather than guessed.

## Mobile behavior

- [ ] Photo upload for return condition (if required by config) uses a
      mobile-camera-friendly flow. **Not built in this pass** — no
      photo/evidence capture exists anywhere in the M19 implementation
      (`ReturnLine` has no evidence/attachment fields). The approved
      spec/build instruction treats this as configured/optional
      ("only if configured"); it was not configured on, and object-
      storage-backed evidence capture was left out rather than
      half-built. A genuine, documented scope gap, not a silent one —
      flagged here for a follow-up pass rather than claimed done.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 10 (COD return →
      store credit) is driven through a real browser end to end
      (`test/e2e-storefront/refunds.spec.ts`), which exercises the same
      return-initiation → warehouse receipt → QC → disposition pipeline
      FLOW 9 needs. FLOW 9's own PREPAID-refund leg and FLOW 16
      (partial return/refund) are proven at the integration layer
      instead (`test/integration/returns.test.ts`,
      `test/integration/refunds.test.ts`'s partial-refund test) — same
      precedent as this build's other milestones for any path needing
      a real Razorpay redirect, which no E2E spec in this repo drives.
      Return initiation/withdrawal itself is also directly browser-
      tested on desktop and mobile viewports
      (`test/e2e-storefront/returns.spec.ts`).

## Definition of Done

All boxes above checked except the documented mobile photo-upload gap,
plus `acceptance/README.md`.
