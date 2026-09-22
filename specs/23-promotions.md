# 23. Promotions

**Status:** DRAFT

## Purpose

Define discount/promotion mechanics: coupon codes, automatic
discounts, and their stacking/precedence rules.

## Scope

- Promotion types (percentage off, fixed amount off, BOGO, free
  shipping, etc. — exact set not yet decided)
- Coupon code vs. automatic promotion
- Stacking/precedence rules (can multiple promotions apply to one
  order? interaction with loyalty redemption, `22-loyalty.md`)
- Eligibility rules (customer segment, product/category scope, date
  range)

## Key architectural constraints (approved)

None domain-specific yet beyond the general platform baseline. Pricing
must integrate with `07-catalog-merchandising.md` base pricing and
`06-inventory.md` availability (promotions should not be offerable on
out-of-stock items, pending confirmation).

## Open questions — DECISION_REQUIRED

- Full list of supported promotion types — not yet defined.
- Stacking rules (multiple coupons, promotion + loyalty redemption) —
  not yet defined.
- Promotion approval workflow — who can create/launch a promotion?
- Budget/usage caps per promotion (e.g., max redemptions) — not yet
  defined.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `07-catalog-merchandising.md`. Feeds: `11-wishlist-cart.md`,
`12-checkout.md`, `24-marketing.md`.
