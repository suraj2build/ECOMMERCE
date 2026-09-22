# M10 — Search / Discovery Acceptance Criteria

**Spec(s):** `specs/09-search-discovery.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] A customer can search by keyword and receive relevant, in-stock-
      prioritized results.
- [ ] PLP filtering/faceting works across the unified category
      taxonomy and other facetable attributes (size, color, brand,
      price).

## Functional acceptance

- [ ] Catalog changes (publish, price, stock) propagate to the search
      index within the target latency (`NFR-001`/search-indexing
      target in `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`).
- [ ] Out-of-stock items are deprioritized in ranking (not hidden
      outright, unless later configured otherwise).
- [ ] Sorting (price, newest, relevance) works correctly.

## Negative scenarios / edge cases

1. Search with no matching results → clear "no results" state with a
   path to relax filters/browse instead.
2. Filter combination yielding zero results → same graceful empty
   state, not a broken page.

## Mobile / Desktop behavior

- [ ] Filter UI uses an appropriate mobile pattern (e.g., bottom
      sheet/full-screen) distinct from the desktop sidebar layout.

## API behavior

- [ ] Search API responds within the `NFR-001` target even at full
      catalog scale (10,000–50,000 SKUs).

## Test requirements

- [ ] Integration tests: catalog-change-to-index propagation.
- [ ] E2E: search → filter → sort → result set correctness.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
