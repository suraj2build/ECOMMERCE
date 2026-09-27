# 23. Promotions

**Status:** IMPLEMENTED (built 2026-09-27; independent-review certification-repair applied 2026-09-27 — cross-domain promotion↔loyalty/store-credit compatibility, see `PROMO-002`'s Blocker 2 repair note; not yet independently re-reviewed — see `acceptance/m24-promotions.md`; decided 2026-09-22, see `blueprint/DECISION_REGISTER.md` `PROMO-001`, `PROMO-002`, `TAX-006`)

## Purpose

Define discount/promotion mechanics: coupon codes, automatic
discounts, and their stacking/precedence rules.

## Scope

- Promotion types
- Coupon code vs. automatic promotion
- Stacking/precedence rules
- Invoice discount presentation

## Approved requirements (2026-09-22)

- **Support BOTH coupon-code promotions AND automatic promotions.**
- Required promotion types include: promotional coupons, campaign
  coupons, onboarding coupons, cashback-related benefits, and other
  **configurable** coupon types — the type system MUST be extensible,
  not a fixed enum.
- **One coupon may coexist with explicitly compatible automatic
  promotions.** Compatibility/stacking **MUST be rule-driven/
  configurable** — every combination MUST NOT be hard-coded
  individually.
- Loyalty redemption and store credit MAY also combine with
  promotions, subject to the same configurable stacking-rule engine
  (`specs/22-loyalty.md` `LOY-005`, `specs/33-store-credit-gift-cards.md`).
  Implemented (2026-09-27, independent-review certification-repair,
  Blocker 2) as two plain per-promotion booleans —
  `Promotion.loyaltyCompatible`/`storeCreditCompatible`, both
  defaulting `true` — never a general rules DSL, never a hard-coded
  promotion ID/type check; enforced server-side at checkout. See
  `PROMO-002`'s Blocker 2 repair note in `blueprint/DECISION_REGISTER.md`.
- Discounts are applied **pre-tax** on the invoice by default
  (engineering default per `TAX-006`), implemented as a configurable
  flag switchable if `specs/32-india-tax-invoicing.md`'s legal
  verification indicates otherwise.

## Remaining open items

## DECISION_REQUIRED

Question: When an order that redeemed a usage-capped coupon/promotion
is later cancelled or returned, should that redemption's usage-cap
"slot" be restored (freeing it for reuse by the same or another
customer), or does a cancelled order permanently consume its slot?

Why it matters: guessing wrong either lets a customer effectively
bypass a usage cap via cancel-and-reorder abuse (if restoration is
wrongly assumed), or unfairly and permanently burns a limited coupon's
supply on an order that never actually completed (if non-restoration
is wrongly assumed) - a real financial/marketing-budget impact either
way, not a cosmetic detail.

Options considered: (a) never restore - conservative default, the one
implemented pending this decision; (b) restore on cancellation only if
QC/return-eligibility conditions mirror `RET-005`'s existing
refund-eligibility gating; (c) restore always, unconditionally.

Current build status (2026-09-27, M24): NOT implemented either way -
`PromotionService` has no cancellation/return hook at all. A
CONVERTED `PromotionRedemption` row is permanent once an order
confirms; this is option (a)'s behavior by omission, not a considered
choice, and must not be read as this spec settling the question.

## Acceptance criteria

See `acceptance/m24-promotions.md`. See
`acceptance/e2e-commerce-flows.md` FLOW 18 (coupon + compatible
promotion + loyalty + store credit).

## Dependencies

Depends on: `specs/07-catalog-merchandising.md`. Feeds:
`specs/11-wishlist-cart.md`, `specs/12-checkout.md`, `specs/24-marketing.md`.
