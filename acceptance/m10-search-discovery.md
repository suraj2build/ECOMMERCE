# M10 — Search / Discovery Acceptance Criteria

**Spec(s):** `specs/09-search-discovery.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23,
`services/commerce-api/src/modules/search/`, 13 passing integration
tests against a real Meilisearch instance — never a mock).

## Business acceptance

- [x] A customer can search by keyword and receive relevant, in-stock-
      prioritized results. Ranking rules: manual pin, then text
      relevance (words/typo/proximity/attribute/exactness), then the
      customer's explicit sort choice when one is given, then in-stock
      items ranked above out-of-stock (never hidden outright), then
      most-recently-published as the final tiebreak.
- [x] PLP filtering/faceting works across category, brand, color, size,
      and price range (the unified taxonomy from `specs/02-product-
      master.md`/`specs/07-catalog-merchandising.md`).

## Functional acceptance

- [x] Catalog changes (publish/unpublish/archive, base price, markdown
      price, inventory adjustment, reserve, release, transfer in/out,
      GRN receipt) propagate to the search index synchronously, within
      the same request that made the change - not eventually, not on a
      polling loop. The formal indexing-lag SLA in
      `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` ("Search indexing")
      remains `TARGET_REQUIRED`/undecided; this is the best-available
      engineering answer (effectively zero lag) rather than a guessed
      number, and there is no job queue in this build to make it
      asynchronous with (ADR-0005 - Redis is sessions-only today).
- [x] Out-of-stock items are deprioritized in ranking, never hidden
      outright (`inStock:desc` ranking rule, not a filter).
- [x] Sorting (price asc/desc, newest) works correctly; the default
      ("relevance") leaves the explicit-sort ranking-rule slot a no-op
      so ordinary text relevance and the pin/stock/recency tiebreakers
      apply instead.

## Negative scenarios / edge cases

- [x] Search with no matching results → clean `200` with an empty hit
      array and `totalHits: 0`, not an error.
- [x] Filter combination yielding zero results → same graceful empty
      state.
- [x] A Meilisearch outage degrades search only: the public search
      route catches the failure and returns an empty result set with
      `unavailable: true` rather than a `500` - it is never authoritative
      for anything else, so nothing else in the platform is affected.

## Mobile / Desktop behavior

- [ ] Filter UI uses an appropriate mobile pattern (bottom sheet/full-
      screen) distinct from the desktop sidebar layout. **Not yet
      built** - this is the PLP page itself, which is M11 (PDP)/the
      storefront browsing surface's own scope, not this milestone's
      backend/indexing foundation. The API this milestone ships
      (`GET /storefront/search`) is what that UI will call.

## API behavior

- [x] `GET /api/v1/storefront/search` - public, unauthenticated. Query
      params: `q`, `category`, `brand`, `color`, `size`, `priceMin`,
      `priceMax`, `sort` (`relevance`|`price_asc`|`price_desc`|
      `newest`), `page`, `pageSize`. Never authoritative for price/
      inventory itself - PDP/cart re-resolve those from PostgreSQL, per
      ADR-0006 (Meilisearch is a derived index, PostgreSQL is the
      source of truth).
- [ ] Search API responds within the `NFR-001` 300ms target "even at
      full catalog scale (10,000–50,000 SKUs)". Verified functionally
      correct at test scale; load-testing at full catalog scale is
      deferred to the Phase 2 end-to-end certification round (§29) -
      no seed/synthetic dataset at that scale exists in any environment
      this was built in yet.

## Staff / operational surface (not in the original acceptance draft,
## added because the approved spec requires it - SRCH-001 "manual
## merchandiser pinning")

- [x] `POST /catalog/styles/:id/pin` / `/unpin` (`catalog:search:pin`,
      granted to MERCHANDISING) - always an explicit staff action,
      audited (`search.pin`/`search.unpin`), never rule-based or
      automated.
- [x] `POST /search/reindex` (`search:reindex`, granted to
      MERCHANDISING) - full rebuild from PostgreSQL, an operational
      recovery tool for index drift, never the primary indexing path.

## Test requirements

- [x] Integration tests: catalog-change-to-index propagation (publish,
      unpublish, price, stock via inventory adjustment); keyword
      search; filter by category/brand/color/price; sort by price/
      newest; pagination; empty-result negative cases; pin ranking;
      out-of-stock deprioritization (not hidden); RBAC on pin/unpin and
      reindex; reindex-from-drift recovery. See
      `test/integration/search-discovery.test.ts` (13 tests, run
      against a real `meilisearch` binary, not a mock).
- [ ] E2E: search → filter → sort → result set correctness against the
      storefront UI. **Blocked on the PLP page existing** (M11) - the
      API this depends on is done and integration-tested; the UI test
      belongs with the UI.

## Definition of Done

Backend/indexing-pipeline boxes are checked. The PLP UI itself
(mobile/desktop filter patterns, E2E against a real browser) and full-
catalog-scale load testing are carried forward - tracked here, not
silently dropped - to land alongside M11 (PDP) and the Phase 2
certification round respectively.
