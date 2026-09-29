# 33. Store Credit & Gift Cards

**Status:** IMPLEMENTED — the store-credit ledger foundation section
was IMPLEMENTED at M20 (build complete 2026-09-25, engineering scope —
see `blueprint/DECISION_REGISTER.md` `REF-002`, `REF-005`). The gift
cards section is now also IMPLEMENTED (M30, 2026-09-29 — see `GC-001`
in `blueprint/DECISION_REGISTER.md` and `acceptance/m30-gift-cards.md`
for the complete design record and Definition of Done). Both remain
`VERIFIED` pending independent review — not self-declared.

## Purpose

Own the store-credit ledger (used by COD refunds and exchange
price-differences) and gift cards (purchasable stored-value
instruments), as two related but distinct stored-value concepts —
explicitly separated from the loyalty-points ledger. This spec did not
exist in the original 31-spec index; created now to give both concepts
clear domain ownership, per the Product Owner's instruction that store
credit "is a separate financial/customer-balance concept" (§19) and
that gift cards need "the correct milestone/domain ownership"
determined (§21).

## Approved requirements — Store Credit

- Store credit MUST be modeled as a **separate financial/customer-balance
  concept**, distinct from the loyalty-points ledger (`specs/22-loyalty.md`)
  — the two MUST NOT be collapsed into one data structure.
- Store credit MUST be maintained as its own **auditable ledger**
  (earn/issue, redeem, reverse, manual adjustment), following the same
  ledger discipline as inventory (ADR-0012) and loyalty (ADR-0013).
- Store credit **does NOT expire** under the currently approved
  business rule (`REF-002`).
- Store credit MUST be treated as **customer monetary value/a payment
  balance**, not merely another coupon — it participates in the
  payment/checkout flow as a redeemable balance.
- Store credit is issued in at least two flows: (a) as the refund
  mechanism for a COD order (`specs/19-refunds.md` `REF-001`), and (b)
  as the settlement for a lower-cost exchange replacement
  (`specs/20-exchanges.md` `EXC-002`).
- Store credit MAY be used together with loyalty and coupon/promotions
  on the same order, **subject to configurable promotion/loyalty
  eligibility and stacking rules** (`LOY-005`, `PROMO-002`) — the
  combination is not unconditionally allowed nor unconditionally
  blocked; it is rule-driven.
- Store-credit issuance from a given triggering event (a specific
  refund or exchange) MUST be idempotent — a duplicated event (e.g., a
  retried webhook or duplicated cancellation request) MUST NOT issue
  store credit twice (see `blueprint/ORDER_PAYMENT_INTEGRITY.md`
  idempotency principles, which apply equally here).

## Approved requirements — Gift Cards

- Gift cards / gift vouchers **are required as part of the eventual
  platform scope** (explicit, §21).
- Gift-card balances MUST eventually have **financial/audit integrity
  similar to other stored-value instruments** — i.e., an auditable
  ledger, not a mutable balance field, consistent with the store-credit
  and loyalty ledger patterns above.
- Gift cards are a **distinct instrument from store credit**: a gift
  card is purchasable by a customer (a new value-creation event with
  its own payment/order semantics), whereas store credit is only ever
  issued by the platform as a consequence of a refund/exchange. They
  MAY share the same underlying ledger *mechanics* (an auditable
  balance ledger) but MUST remain distinguishable by origin/type in
  that ledger.
- Gift cards are **not required for initial launch** — building the
  store-credit foundation (needed by Refunds and Exchanges from
  launch) does not require gift cards to exist yet. See milestone
  ownership below.

## Milestone ownership

Per the Product Owner's explicit instruction not to "unnecessarily
block early commerce milestones" (§21):

- The **store-credit ledger foundation** is in scope for **M20
  Refunds** (it is a hard dependency of `REF-001`'s COD refund
  requirement and `EXC-002`'s exchange settlement requirement) — see
  `BUILD_PLAN.md`.
- **Gift cards** (purchasable stored-value instruments, redemption at
  checkout as a distinct payment method) were scoped to a later,
  dedicated **M30 Gift Cards** milestone, reusing the ledger mechanics
  established at M20 but adding purchase/issuance flows — now built,
  see the implementation note below.

## M30 implementation note (2026-09-29)

Built as `GiftCard`/`GiftCardLedgerEntry`/`GiftCardRedemptionHold`/
`GiftCardPurchase` — the exact `StoreCreditAccount`/`StoreCreditEntry`/
`StoreCreditRedemptionHold` ledger idiom (row-lock-before-mutate,
preview outside a transaction + authoritative reserve inside one,
ACTIVE/CONVERTED/RELEASED holds, a stale-hold sweep) copied for a
structurally SEPARATE table group, so origin/type stays unambiguous by
construction. A gift card's own row IS its account (no separate
account table), addressed by possession of a high-entropy code (~80
bits of entropy, `GC-XXXX-XXXX-XXXX-XXXX` format) whose plaintext is
NEVER persisted — only its SHA-256 hash (the same unsalted-hash
convention this codebase already uses for OTP codes and refresh/
session tokens), returned to the caller exactly once at issuance.
Redemption slots in as the FOURTH and final reduction in
`CheckoutService.startCheckout`'s existing chain (promotion → loyalty
→ store credit → gift card), gated by a new
`Promotion.giftCardCompatible` flag mirroring `loyaltyCompatible`/
`storeCreditCompatible` exactly. At most one gift card per checkout
(`GiftCardRedemptionHold.checkoutSessionId` is `@unique`) — no
multi-gift-card stacking was invented. Purchase is prepaid-only (never
COD — nothing to physically deliver) and reuses the certified
`RazorpayPaymentProvider` directly through the SAME additive-
correlation pattern M21 established for Exchange price-difference
payments (`PaymentEvent.exchangeId`): a new nullable
`PaymentEvent.giftCardPurchaseId` lets `PaymentService.
handleRazorpayWebhook` dispatch a captured/failed outcome to
`GiftCardService.applyPurchaseCaptureOutcome` without touching the
M14-certified `applyOutcome`/`applyCaptureOutcome` logic at all.
Building the purchase flow's "gift card covering the full payable
amount" requirement exposed a genuine pre-existing gap: nothing in
`startCheckout`/`retryPayment` handled `amountPayable <= 0` — fixed by
treating it exactly like COD's own `{status: 'CONFIRMED'}` shape
(order confirms immediately, no provider call, matching the
pre-existing `payments_amount_nonnegative_check` DB constraint that
already permitted a zero-amount `Payment` row). 20 adversarial
integration tests (`test/integration/gift-cards.test.ts`): issuance +
idempotency, signed manual adjustment (mirroring
`LoyaltyLedgerEntry.pointsDelta`'s own signed-delta precedent, the one
ledger entry type that isn't a positive magnitude), refund-to-gift-card
(staff-initiated only — no automatic refund-tender-allocation policy
was invented), disable, checkout-time partial/full redemption, a
generic non-enumerating rejection message (disabled/unknown/
insufficient-balance codes are indistinguishable), genuine `Promise.all`
concurrency proving no overspend, the promotion-compatibility gate,
replay/double-conversion safety, the stale-hold sweep, staff RBAC, an
audit-payload secret-leak check, and the full purchase→webhook→issuance
flow (captured, failed, and a duplicate-webhook-redelivery no-op) with
Razorpay mocked at the fetch boundary.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` `REF-002`, `LOY-001`, `LOY-005`.

## Acceptance criteria

See `acceptance/m20-refunds-store-credit.md` for the store-credit
ledger foundation, and `acceptance/m30-gift-cards.md` for gift-card
purchase/redemption criteria.

## Dependencies

Depends on: `specs/19-refunds.md` (COD refund trigger),
`specs/20-exchanges.md` (price-difference trigger),
`specs/22-loyalty.md` (conceptual separation, shared stacking rules
with `specs/23-promotions.md`).
