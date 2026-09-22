# 33. Store Credit & Gift Cards

**Status:** DRAFT (store credit ledger model APPROVED direction per
`REF-002`; gift cards scoped but scheduled later — see milestone
ownership below)

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
  checkout as a distinct payment method) are scoped to a later,
  dedicated **M30 Gift Cards** milestone, reusing the ledger mechanics
  established at M20 but adding purchase/issuance flows. This avoids
  blocking M20 on gift-card-specific design work that isn't needed
  yet.

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
