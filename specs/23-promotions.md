# 23. Promotions

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `PROMO-001`, `PROMO-002`, `TAX-006`)

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
- Discounts are applied **pre-tax** on the invoice by default
  (engineering default per `TAX-006`), implemented as a configurable
  flag switchable if `specs/32-india-tax-invoicing.md`'s legal
  verification indicates otherwise.

## Remaining open items

None within this spec's own scope.

## Acceptance criteria

See `acceptance/m24-promotions.md`. See
`acceptance/e2e-commerce-flows.md` FLOW 18 (coupon + compatible
promotion + store credit).

## Dependencies

Depends on: `specs/07-catalog-merchandising.md`. Feeds:
`specs/11-wishlist-cart.md`, `specs/12-checkout.md`, `specs/24-marketing.md`.
