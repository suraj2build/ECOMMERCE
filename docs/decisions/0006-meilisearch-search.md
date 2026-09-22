# ADR-0006: Meilisearch for search and discovery (initial choice)

## Status
Accepted

## Context
Fashion commerce discovery (PLP, search-as-you-type, faceted filtering
by category/size/color/brand/etc.) needs fast, relevance-tuned,
facet-capable search that a plain PostgreSQL query cannot reasonably
provide at scale.

## Decision
Use **Meilisearch** as the initial search engine for product
discovery (search, PLP filtering/facets), self-hosted alongside the
rest of the stack.

## Reasoning
- Meilisearch is lightweight, fast to set up, easy to run locally in
  Docker Compose (ADR-0009), and good enough for the platform's
  initial scale, avoiding the operational overhead of heavier search
  systems (e.g., Elasticsearch/OpenSearch clusters) before there is a
  demonstrated need.
- Explicitly framed as the **initial** choice: if scale or feature
  requirements (e.g., advanced relevance tuning, analytics-heavy
  search) outgrow it, that is a future ADR, not a silent migration.

## Consequences
- Product/catalog data must be indexed into Meilisearch as part of the
  catalog publishing flow (`specs/07-catalog-merchandising.md`,
  `specs/09-search-discovery.md`) — Meilisearch is a derived index, not
  a source of truth (PostgreSQL remains the source of truth for
  product data).
- Any future replacement of Meilisearch requires a new ADR evaluating
  the specific limitation encountered.
