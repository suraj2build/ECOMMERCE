# Go-live verification — 2026-10-02

Status: IN PROGRESS. The owner authorized completing the remaining work and production go-live on 2026-10-02. Deployment still depends on passing verification and having real infrastructure/providers; authorization alone does not make those available.
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
- Final business UAT, migration reconciliation and deployment against the selected production target (owner authorization is already recorded).

No external-provider business rule, legal retention policy or production infrastructure choice is invented by this repair.

## Continuous completion pass

- Latest inherited head 0978aa4: 55 unit, 798 integration and 58 browser/API/admin tests passed. Read load failed: rendered PDP at 200 connections reported 52 timeouts. This is a genuine open failure, not a green run.
- Repair: public PDP requests share only concurrent in-flight work and immediately discard settled results; independent product queries run concurrently. Cross-sell batches price reads and filters active prices before limiting candidates, removing N+1 lookups and unpriced-candidate gaps. Checkout remains authoritative for price/stock acceptance.
- Server startup now schedules payment expiry, inventory reservation expiry and pending invoice recovery immediately and every 60 seconds after the previous sweep completes. Errors are logged per job and retried on the next sweep. Shutdown drains the running job before disconnecting infrastructure. Existing domain row locks and invoice uniqueness protect multiple replicas. Each sweep keyset-pages batches of 100 without a total-record cutoff.
- CI uses the compiled API alongside production Next builds. Added regression coverage for 200 concurrent PDP reads followed by changed price/stock, failed-read recovery, maintenance overlap/shutdown/failure recovery, and two real-service sweeps across 205 expired reservations.
- Additional launch blocker found: AuthService hard-wires ConsoleOtpProvider; there is no real SMS delivery adapter. Console-only delivery now refuses production use instead of reporting a fake successful dispatch. A real provider must be selected, wired and verified.
- Deployment discovery: no production hosting descriptor, production runtime credentials or configured production target is available in this checkout/session. Shipping adapters remain test doubles; return evidence uses local disk, requiring durable shared storage or a verified object-storage adapter. No production deployment has been performed.
- Final-head full CI, load measurement, staging mixed load, real provider delivery/payment/shipping, production backup/restore and business/legal launch requirements remain evidence gates. They must not be marked complete solely to satisfy a launch request.

### Reporting scale repair

Commerce sales/refunds and margin now use PostgreSQL grouped aggregates and relational filters instead of materializing every order/refund/line or building unbounded order-ID lists. Fashion sales aggregate by SKU and return reasons by reason; SKU metadata uses relational eligibility instead of a growing IN list. The canonical available-stock helper traverses bounded 1,000-ID batches without any total-SKU cutoff (33,001-SKU regression). Existing date, cancellation, refund, average-cost and missing-cost-line semantics are preserved. Full real-database regression and performance verification remain required; procurement reports and large per-SKU response payloads still need production-scale memory/latency assessment.

Invoice recovery failure recording is conditional on invoiceId remaining null, so a failed replica cannot overwrite another replica's successfully issued invoice.

### Final read-load repair

The second full run passed 61 unit, 800 integration and 58 browser tests, but load remained red: the shared-IP harness triggered 429s, and dynamic PDP rendering at 200 connections had 23 timeouts (1,255ms median). Same-product API median improved to 21ms at 100 connections and 34ms at 200. This is test-environment evidence, not production capacity certification.

PDP now uses on-demand 30-second public HTML revalidation, with no finite build-time product list. Browser hydration fetches uncached live price/stock; failed refresh prevents add-to-bag and checkout still independently validates current values. Browser coverage verifies cached HTML plus an API price change and real inventory removal. Identical concurrent public search reads share only pending work; settled or failed reads are discarded and differing filters stay separate. Load clients model distinct shopper IPs on the explicit test target; production throttling remains unchanged. HTML load validation requires real Product structured data, preventing a streaming error page from counting as success. Final-head full CI remains required.

### Deployment image verification

The API Dockerfile now installs the exact lockfile with lifecycle scripts deferred until source exists, includes the root TypeScript configuration and all workspace manifests, generates Prisma after copying source, installs OpenSSL for the Alpine Prisma engine, prunes development dependencies and runs as the node user. Build context excludes local secrets, generated builds, private evidence and dependency trees. A separate CI job builds the clean image and checks compiled API, generated native Prisma engine, runtime package imports and non-root execution. This validates packaging, not production provider configuration or live deployment.

The first cached-PDP CI run passed 63 unit and 800 integration tests but failed browser verification with NoFallbackError/404s. Root cause: the inherited global NODE_ENV=test was also used for Next production builds; Next 15's static-path builder enables runtime generation for an empty parameter list only when NODE_ENV=production. CI now builds with production mode, checks the generated PDP manifest has blocking fallback, and starts both Next apps in production mode. The API/test processes retain the explicit test environment and production guards are unchanged. The local production build already produced the correct manifest and generated an unseen product path successfully. Final full CI is required after this correction.
