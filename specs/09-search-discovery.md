# 09. Search / Discovery

**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23 — see `blueprint/DECISION_REGISTER.md` `SRCH-001`, `SRCH-002`, and `acceptance/m10-search-discovery.md`)

## Purpose

Define search-as-you-type, full search results, and Product Listing
Page (PLP) browsing/filtering/faceting behavior.

## Scope

- Search query handling and relevance
- Faceted filtering
- PLP sorting, pagination
- Catalog-to-Meilisearch indexing pipeline

## Approved requirements (2026-09-22)

- Meilisearch is the search engine (ADR-0006); PostgreSQL remains the
  source of truth, Meilisearch is a derived index.
- Relevance ranking combines: text relevance, stock availability
  (in-stock prioritized), recency, and manual merchandiser pinning at
  launch. Sales-velocity weighting is added once sufficient analytics
  data exists (post-launch refinement).
- Personalized search/recommendation is **FUTURE_CONSIDERATION**, not
  launch scope — analytics event foundations must not preclude adding
  it later.
- Facetable attributes are drawn from the unified taxonomy in
  `specs/02-product-master.md`/`specs/07-catalog-merchandising.md`.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m10-search-discovery.md`.

## Dependencies

Depends on: `specs/07-catalog-merchandising.md`, `specs/08-storefront.md`.
Feeds: `specs/10-pdp.md`, `specs/26-seo.md`.
