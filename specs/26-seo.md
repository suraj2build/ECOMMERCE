# 26. SEO

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `SEO-001`)

## Purpose

Define the SEO implementation for the storefront.

## Scope

- Server-rendered/indexable product content (PDP, PLP)
- Metadata, sitemaps, breadcrumbs
- Structured data: `Product`/`ProductGroup`/`Offer`, image metadata

## Approved requirements (2026-09-22)

- SEO is architectural — designed into `specs/08-storefront.md` and
  `specs/10-pdp.md` from the start, not retrofitted.
- URL structure: `/category/product-slug` pattern, canonical URLs, 301
  redirects for discontinued/unpublished products (engineering
  convention, finalized at implementation time).
- Structured data MUST reflect the product attribute model
  (`specs/02-product-master.md`), including price (tax-inclusive,
  `specs/07-catalog-merchandising.md`), availability
  (`specs/06-inventory.md`), and returns policy reference
  (`specs/18-returns.md`).
- Product media alt text and SEO metadata are captured per asset
  (`specs/02-product-master.md`).

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m27-seo.md`.

## Dependencies

Depends on: `specs/08-storefront.md`, `specs/10-pdp.md`,
`specs/09-search-discovery.md`, `specs/02-product-master.md`,
`specs/07-catalog-merchandising.md`.
