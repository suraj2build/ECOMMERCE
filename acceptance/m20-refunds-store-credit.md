# M20 — Refunds & Store Credit Acceptance Criteria

**Spec(s):** `specs/19-refunds.md`, `specs/33-store-credit-gift-cards.md` (store-credit ledger foundation)
**Status:** M20 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `REF-005`. Not self-declared
`VERIFIED`; independent review pending.

## Business acceptance

- [x] Prepaid-order refunds return to the original payment method
      (`RazorpayPaymentProvider.refund()`, `refunds.test.ts` test #1).
- [x] **COD-order refunds issue as store credit**, never as a
      bank/UPI transfer (`refunds.test.ts` test #2).
- [x] **Refund amount always uses the original transaction price**,
      never the current catalog price — verified by changing the
      product price after the order, then refunding, and confirming
      the refunded amount matches the original order value
      (`refunds.test.ts` test #3).
- [x] Store credit is a separate ledger from loyalty points — verified
      structurally (distinct `StoreCreditAccount`/`StoreCreditEntry`
      tables, no loyalty ledger exists anywhere in this codebase) and
      behaviorally (`refunds.test.ts` test "issuing store credit never
      touches any other ledger table").
- [x] Store credit does not expire — verified by a test asserting a
      store-credit balance remains redeemable indefinitely (no expiry
      job ever touches it) (`refunds.test.ts` test "a store-credit
      balance issued long ago remains fully redeemable").

## Functional acceptance

- [x] Partial refunds are supported and calculate correctly against
      the original line-item transaction values (`refunds.test.ts`
      test "a partial cancellation of one line among two only refunds
      that line" — one `Refund` row per `OrderLine`, never per-order).
- [x] A refund/credit-note-qualifying event generates the linked
      credit-note document — reuses the existing M18 cancellation-time
      credit note, or issues a fresh one via the same M08
      `InvoiceService` engine for a return-triggered refund
      (`refunds.test.ts` tests #1–2).

## Financial integrity (binding)

- [x] **A duplicated refund-triggering event (retried webhook,
      duplicated cancellation request) does not issue a refund or
      store credit twice** — `refunds.test.ts` "a retried refund
      request with the exact same idempotency key", "a different
      idempotency key against the SAME order line", and two genuine
      concurrency tests (same line; two different lines for the same
      guest, which caught and led to fixing a real
      `StoreCreditAccount`-creation race — see `REF-005`).
- [x] Refund and store-credit issuance operations are idempotent per
      triggering event ID (`orderLineId` is the structural anchor;
      `idempotencyKey` defense-in-depth on top).

## Auditability

- [x] Every refund and every store-credit ledger entry records
      who/what/when/reference (linking back to the triggering
      cancellation/return) — `recordAudit` calls in both
      `RefundService`/`StoreCreditService`, `initiatedByStaffId`/
      `actorStaffId` columns.

## Negative scenarios / edge cases

1. [x] Attempt to process the same refund twice (simulated duplicate
   event) → second attempt is a safe no-op, verified via ledger
   inspection (exactly one entry) — `refunds.test.ts` idempotency and
   concurrency tests.
2. [x] Partial refund on a multi-line return → only the returned
   lines' original values are refunded, not the whole order
   (`refunds.test.ts` partial-refund test).

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 10 (COD return →
      store credit) is driven through a real browser end to end
      (`test/e2e-storefront/refunds.spec.ts`). FLOW 9 (prepaid refund)
      is proven at the integration layer instead
      (`test/integration/refunds.test.ts` test #1) — no E2E spec in
      this repo drives a real Razorpay redirect, same precedent as
      this build's earlier milestones.
- [x] Idempotency test for refund/store-credit issuance is mandatory
      and automated — present, including the two genuine concurrency
      races above.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
