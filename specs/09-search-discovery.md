# 09. Search / Discovery

**Status:** DRAFT

## Purpose

Define search-as-you-type, full search results, and Product Listing
Page (PLP) browsing/filtering/faceting behavior.

## Scope

- Search query handling and relevance
- Faceted filtering (category, size, color, brand, price, etc. — facet
  list depends on `02-product-master.md` attribute taxonomy)
- PLP sorting, pagination
- Catalog-to-Meilisearch indexing pipeline (from
  `07-catalog-merchandising.md`)
- Merchandised/curated result sets (e.g., "New Arrivals",
  "Best Sellers") if in scope

## Key architectural constraints (approved)

- Meilisearch is the initial search engine (ADR-0006); PostgreSQL
  remains the source of truth, Meilisearch is a derived index.

## Open questions — DECISION_REQUIRED

- Relevance ranking rules — business-owned, not yet defined.
- Which product attributes are facetable — depends on final
  `02-product-master.md` taxonomy.
- Personalization/recommendation scope — in scope for initial build or
  future milestone?
- Out-of-stock handling in search results/PLP (hide, show with
  "out of stock" label, or deprioritize)?

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`SRCH-001`, `SRCH-002`, `CAT-002`.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `07-catalog-merchandising.md`, `08-storefront.md`. Feeds:
`10-pdp.md` (entry point), `26-seo.md` (indexable PLP content).
