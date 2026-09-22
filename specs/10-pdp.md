# 10. Product Detail Page (PDP)

**Status:** DRAFT

## Purpose

Define the product detail page: how a single product (style, with its
color/size variants) is presented to the customer, including
availability, pricing, and the path to cart/wishlist.

## Scope

- Variant selection (color/size) and its effect on displayed
  price/availability/images
- Availability display sourced from `06-inventory.md` derived state
- Structured data / SEO requirements for this page (`26-seo.md`)
- Cross-sell/related products (if in scope)
- Reviews/ratings (if in scope — not yet decided)

## Key architectural constraints (approved)

- Must be server-rendered/indexable per the SEO architectural
  requirement (`ARCHITECTURE.md` §8) — not a client-only rendered page.
- Must reflect real-time (or near-real-time) availability derived from
  the inventory ledger, not a stale cache that could show in-stock
  items that are actually sold out.

## Open questions — DECISION_REQUIRED

- Are customer reviews/ratings in scope for initial build?
- Cross-sell/upsell/related-products logic — business-owned, not yet
  defined.
- Size-guide / fit-recommendation features — in scope or future?
- Out-of-stock / back-in-stock notification behavior — depends on
  `29-notifications.md` and inventory rules.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `02-product-master.md`, `07-catalog-merchandising.md`,
`06-inventory.md`, `08-storefront.md`. Feeds: `11-wishlist-cart.md`,
`26-seo.md`.
