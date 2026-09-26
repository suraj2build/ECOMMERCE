# 19. Refunds

**Status:** IMPLEMENTED (M20 build complete 2026-09-25, engineering
scope, repaired 2026-09-26 per independent review (refund-concurrency
recheck) — see `blueprint/DECISION_REGISTER.md` `REF-001`–`005`;
`VERIFIED` pending independent re-review, not self-declared)

## Purpose

Define how money is returned to the customer following a cancellation
or accepted return, across both gateway (Razorpay) and COD payment
methods.

## Scope

- Refund trigger points
- Refund method
- Refund status lifecycle
- Store credit issuance

## Approved requirements (2026-09-22)

- **Prepaid orders: refund to the original payment method** where
  supported/appropriate, via `specs/13-payment.md`'s provider
  abstraction.
- **COD orders: refund as STORE CREDIT** — see
  `specs/33-store-credit-gift-cards.md` for the store-credit ledger
  this issues into.
- **Refund calculation MUST use the original transaction values, not
  current catalog prices** (reinforcing `specs/07-catalog-merchandising.md`
  `CAT-001`'s price-snapshot requirement).
- **Partial refunds MUST be supported.**
- **Refund operations MUST be auditable and idempotent** — a duplicated
  triggering event (retried webhook, duplicated cancellation request)
  MUST NOT issue a refund or store credit twice.
- Refund reason is inherited from the triggering return's reason by
  default; captured separately for non-return-triggered refunds (e.g.,
  cancellation, goodwill).
- Every qualifying refund/cancellation generates a GST credit-note
  document (`specs/32-india-tax-invoicing.md` `TAX-005`) linked to the
  original invoice.

## Remaining open items

Credit-note format specifics remain `UNDER_REVIEW` in
`specs/32-india-tax-invoicing.md`.

## Acceptance criteria

See `acceptance/m20-refunds-store-credit.md`. Given financial
sensitivity, acceptance criteria include double-refund-prevention and
reconciliation test scenarios — see `acceptance/e2e-commerce-flows.md`
FLOWS 9–10.

## Dependencies

Depends on: `specs/13-payment.md`, `specs/17-cancellation.md`,
`specs/18-returns.md`, `specs/33-store-credit-gift-cards.md`. Feeds:
`specs/21-customer-profile.md`, `specs/27-analytics-reporting.md`.
