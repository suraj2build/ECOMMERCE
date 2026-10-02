# Go-live verification — 2026-10-02

Status: IN PROGRESS. No production readiness, capacity certification or deployment approval.
Baseline: 304e009 (merged VANYA storefront).

## Repair and test scope

- Admin collections now use bounded pages and totals; styles in a collection have ordered pages and a complete count.
- Receiving, return and exchange queues have navigation beyond their former first-page cutoffs.
- Loyalty history supports paging beyond 200 entries. Promotion-type reference reads no longer omit types beyond 100.
- Search expands Meilisearch's result window to cover the live indexed document count; no fixed 1,000-hit cutoff. Live metadata reads and large result-window costs require load measurement.
- Public catalog applies active-price eligibility before pagination with deterministic ordering. Unpriced rows cannot shorten a page or cause overlap.
- Sitemap traverses eligible products without the old 3,000-style cutoff. Backend failures surface rather than returning a successful empty product sitemap. Sitemap splitting for >50,000 URLs remains necessary at that scale.
- Checkout idempotency replay verifies session ownership, including the transaction's unique-key winner path.

Regression tests cross 200 collections, 500 collection styles, 1,000 search hits, 3,000 sitemap products, and 200 loyalty entries. The HTTP checkout test submits 100 distinct guest checkouts for 15 units, verifies exactly 15 accepted orders, typed stock rejections, and idempotent retries.

CI runs same-product, catalog and search read load at 100 connections for 30 seconds and 200 for 15 seconds. Raw latency/request/error measurements are uploaded. The gate rejects transport errors, timeouts and non-2xx results; passing it alone does not sign off latency SLOs. API injection checkout contention is correctness coverage, not a network/browser load test.

## Verified locally

Lint, all-workspace typecheck, 52 unit tests, and production builds passed for the first repair set. Subsequent changes require the final-head CI result. PostgreSQL, Redis and Meilisearch are absent from this workspace, so integration/browser/load tests must run in CI or a provisioned test environment.

## Launch gates still open

- Production-like staging topology and actual provider choices/configuration.
- Sustained mixed shopper/admin workload on production-like staging; latency SLO assessment and recovery.
- Large-volume analytics totals reconciled with SQL, plus memory/time/bind-parameter limits; current analytics queries have no fixed first-1,000 cap but materialize large datasets.
- Real payment sandbox/webhook/timeout/refund reconciliation; real shipping provider adapter (current carrier implementations are mock).
- Real marketing/channel provider integrations where enabled; production mock guards remain authoritative.
- Monitoring/alert destination and failure escalation; logs/request IDs/audit trails already exist.
- Scheduled offsite backups, restoration rehearsal and rollback on the selected topology.
- Legal/privacy content and unresolved data-retention/export/erasure decisions recorded in security/DPDP_READINESS.md.
- Final business UAT, migration reconciliation and explicit production deployment authorization.

No external-provider business rule, legal retention policy or production infrastructure choice is invented by this repair.
