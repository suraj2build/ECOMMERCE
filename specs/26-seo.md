# 26. SEO

**Status:** DRAFT

## Purpose

Define the SEO implementation for the storefront: what must be
server-rendered/indexable, what structured data is emitted, and how
discoverability is maintained as the catalog changes.

## Scope

- Server-rendered/indexable product content (PDP, PLP) — architectural
  requirement, see `ARCHITECTURE.md` §8
- Metadata (titles, descriptions, canonical URLs)
- Sitemaps (product, category, and general sitemap generation/updates)
- Breadcrumbs
- Structured data: `Product` and `ProductGroup`/variant schema, `Offer`
  data (availability, pricing, shipping, returns policy references),
  image metadata
- Other ecommerce SEO requirements (robots directives, redirect
  handling for discontinued products, etc.)

## Key architectural constraints (approved)

- SEO is architectural, not an afterthought (`ARCHITECTURE.md` §8) —
  must be designed into `08-storefront.md` and `10-pdp.md` from the
  start, not retrofitted after those are built.

## Open questions — DECISION_REQUIRED

- Exact structured data schema mapping from the product attribute
  model (`02-product-master.md`) — not yet designed.
- URL structure/canonicalization strategy — not yet decided.
- Redirect policy for discontinued/out-of-stock-permanently products —
  not yet defined.
- International SEO (hreflang etc.) — depends on the
  internationalization open question in `08-storefront.md`.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `08-storefront.md`, `10-pdp.md`, `09-search-discovery.md`,
`02-product-master.md`, `07-catalog-merchandising.md`.
