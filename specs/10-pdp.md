# 10. Product Detail Page (PDP)

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `PDP-001`, `PDP-002`, `PROD-004`, `PROD-005`, `IND-002`)

## Purpose

Define the product detail page: how a single product is presented,
including availability, pricing, ratings/reviews, and the path to
cart/wishlist.

## Scope

- Variant selection (color/size) and its effect on price/availability/
  images
- Availability display sourced from `specs/06-inventory.md`
- PIN-code serviceability check
- Ratings and reviews
- Structured data / SEO requirements

## Approved requirements (2026-09-22)

- **Ratings and reviews are required** customer-facing features.
- **PIN-code serviceability MUST be checkable from the PDP** before the
  customer proceeds to checkout, using the `specs/16-shipping-tracking.md`
  carrier abstraction with a static-list fallback.
- Must reflect real-time (or near-real-time) availability derived from
  the inventory ledger (`specs/06-inventory.md`) — never a stale cache
  that could show a sold-out item as available.
- Must be server-rendered/indexable per the SEO architectural
  requirement (`specs/26-seo.md`).
- Size chart display MUST reflect the versioned chart applicable to
  the product (`specs/02-product-master.md` `PROD-004`).
- Model measurements/model-worn size MAY be shown where captured
  (optional enrichment field).
- Cross-sell is rule-driven (same/complementary category) with manual
  merchandiser override; algorithmic recommendation is a future
  enhancement.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m11-pdp.md`.

## Dependencies

Depends on: `specs/02-product-master.md`, `specs/07-catalog-merchandising.md`,
`specs/06-inventory.md`, `specs/08-storefront.md`. Feeds:
`specs/11-wishlist-cart.md`, `specs/26-seo.md`.
