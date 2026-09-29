# M30 — Gift Cards Acceptance Criteria

**Spec(s):** `specs/33-store-credit-gift-cards.md`
**Status:** BUILT (2026-09-29). Not self-declared certified — awaiting
independent review.

## Business acceptance

- [x] A gift card can be purchased by a customer (a new value-creation
      event, distinct from store credit which is only ever
      platform-issued) — `POST /storefront/gift-cards/purchase` +
      Razorpay webhook capture (`GiftCardService.initiatePurchase`/
      `applyPurchaseCaptureOutcome`).
- [x] Gift-card balances have auditable ledger integrity equivalent to
      store credit and loyalty — `GiftCardLedgerEntry` is the source of
      truth, `GiftCard.balance` a denormalized cache maintained under a
      row lock, never mutated independently.
- [x] A gift card is redeemable at checkout as a distinct payment
      method/balance source — the fourth reduction in
      `CheckoutService.startCheckout`'s chain.

## Functional acceptance

- [x] Gift-card purchase, issuance, and redemption are each ledger
      transactions (`ISSUE` at purchase-capture/staff-issue, `REDEEM`
      at order confirmation, `REFUND_TO_GIFT_CARD`/`ADJUSTMENT` for
      staff operations).
- [x] Gift-card and store-credit ledger entries remain distinguishable
      by origin/type even though they share the identical underlying
      ledger MECHANICS — structurally separate tables
      (`gift_card_ledger_entries` vs. `store_credit_entries`), never a
      shared model.

## Financial integrity

- [x] Gift-card purchase payment follows the same idempotency
      discipline as any other payment operation
      (`acceptance/m14-payment.md`) — `GiftCardPurchase.idempotencyKey`,
      the same `PaymentEvent` (provider, providerEventId) dedup guard,
      and the same additive-correlation webhook-dispatch pattern M21
      established for Exchange payments.
- [x] Gift-card redemption cannot be applied twice for the same
      purchase event (idempotent) — `convertRedemptionHold`'s
      deterministic `idempotencyKey` (`giftcard-redeem:${checkoutSessionId}`)
      proven safe under a direct double-invocation test.

## Negative scenarios / edge cases

1. Attempt to redeem a gift card for more than its remaining balance →
   **rejected** (a generic, non-enumerating error message — the same
   message a disabled or unknown code produces, closing the balance-
   leakage/enumeration vector explicitly called out in this
   milestone's security requirements). Partial redemption up to
   balance IS supported when the requested amount is within balance;
   combining the remainder with another payment method (COD/PREPAID)
   is supported; a gift card covering the FULL payable amount is also
   supported (see the `amountPayable<=0` repair note in the spec's own
   M30 implementation note).
2. Attempt to redeem an already-fully-redeemed (zero-balance/DEPLETED)
   gift card → blocked with the same generic message.

## Security

- [x] Gift-card codes are high-entropy (~80 bits), never persisted in
      plaintext (SHA-256 hash only), and returned to the caller exactly
      once, at issuance.
- [x] Audit payloads for gift-card events never contain the plaintext
      code or its hash (tested directly).
- [x] Redemption/lookup errors never differentiate "doesn't exist" from
      "disabled" from "insufficient balance" — a single generic message
      for all three.
- [x] Staff mutation (issue/disable/adjust/refund-to-gift-card) is
      gated by the dedicated `giftcard:manage` permission; read access
      by `giftcard:read` — both distinct from every other permission in
      the system.

## Test requirements

- [x] Integration tests (20 total,
      `test/integration/gift-cards.test.ts`): purchase → webhook
      capture → issuance → redemption → balance correctness; staff
      issuance + idempotency; signed manual adjustment (credit/debit,
      cannot go negative); refund-to-gift-card; disable; checkout
      partial redemption; over-request rejection; disabled/unknown-code
      generic-error parity; genuine `Promise.all` concurrency (no
      overspend, exactly one winner); full-amount coverage
      (`amountPayable<=0`); combined with COD; promotion
      `giftCardCompatible` gate; replay/double-conversion safety;
      stale-hold sweep; staff RBAC (both permission and unauthenticated
      negative cases); audit secret-leak check; captured/failed/
      duplicate-redelivery purchase-webhook outcomes; ledger isolation
      from StoreCredit/Loyalty.
- [x] Idempotency test for both purchase (duplicate webhook
      redelivery → no second gift card) and redemption (double
      `convertRedemptionHold` call → no double debit).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This agent does
not self-declare this milestone certified — awaiting independent
review, the same discipline as every milestone since Phase 1.
