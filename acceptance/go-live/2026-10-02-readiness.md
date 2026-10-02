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

### Admission and steady read measurement

The corrected production build passed 63 unit, 800 integration and 59 browser tests. The read run had no invalid/non-2xx responses: search medians were 22/42ms and PDP HTML 88/156ms at 100/200 connections. Eleven HTML timeouts remained at 200 connections. Isolated diagnostics reproduced first-request failures before any response headers; no settled-response failure was accepted as green.

The read harness now uses native HTTP, performs one real validated request on every client before allowing any client to start repeated traffic, then runs all 100/200 persistent shopper loops together for the full 30/15-second measurement. Both admission and steady-read errors, timeouts, non-2xx responses and invalid bodies remain in the failure gate, with the same 10-second full-request deadline. Admission latency/counters are reported separately instead of combining connection establishment with warmed response percentiles. Four real-HTTP harness regressions cover successful persistent requests, throttled responses, invalid bodies and incomplete-response timeouts. A targeted clean-database PDP/browser/load CI job provides faster transport evidence alongside the full 800-test release suite. This does not certify an instantaneous connection storm, real browser concurrency, staging mixed load or production topology; those remain launch requirements.

The targeted HTTP load job provisions its own published, priced, stocked product through the real staff API (category/size reference upserts use Prisma, matching the existing PDP fixture). It has no browser download dependency. The full browser suite still runs in the main release job: it uses the runner's installed Chrome when present, otherwise performs a six-minute-bounded Chromium installation. No browser test or load failure gate is skipped.

### Supported deployment runtime

The earlier Node 20 build/test baseline is not a supported production runtime in October 2026: Node's official release table marks v20 EOL and v24 LTS (https://nodejs.org/en/about/previous-releases). Production API build/runtime images, full/targeted CI and the root engine requirement now use Node 24 LTS, with the same major selected for developer tooling. No dependency graph or business behavior is changed by this platform maintenance update. Earlier local unit tests and all-workspace production builds already passed on Node 24.19.0; full real-service, browser, image and load verification is required on the new runtime before merging.

The supported-runtime image check now starts an isolated PostgreSQL service and executes a real SELECT 1 through Prisma inside the built, non-root Alpine API image. This verifies native engine loading, OpenSSL/runtime compatibility and connectivity in the actual container, in addition to entrypoint/import checks. It is a test-database probe, not production configuration or deployment.

### Published-product 404 and page-cache repair (from a767cab)

Reproduced on the production builds (CI-equivalent environment, real Postgres/Redis/Meilisearch):

1. **Build mode.** With `NODE_ENV=test` during `next build`, the product route is written with `fallback: false`; every product not known at build time (all of them) answers 404 through `NoFallbackError`. With `NODE_ENV=production` it is `fallback: null`. Cause: Next 15.5 `build/static-paths/app.js` enables runtime generation for an empty `generateStaticParams` list only when `NODE_ENV === 'production'`. a767cab fixed the CI build step only; any other build path (another CI system, a container, a host's build) would ship a storefront where every product is a 404. The storefront's own `build` script (`apps/storefront/scripts/build.mjs`) now forces production mode for `next build` and fails the build if the product route cannot render unseen products. Verified: a build run under `NODE_ENV=test` now produces `fallback: null`.
2. **Cached 404 after publish.** A product page requested before publication was cached as a 404 and kept answering 404 for ~32 s after publish (measured: HIT ... STALE ... 200). An unpublished product stayed visible for ~30 s. Before the 30-second page cache (304e009) a 404 was never cached, so the first symptom is a regression. The API now asks the storefront to drop the product page after publish, unpublish, archive, media and price changes (`StorefrontCacheService` → `POST /api/revalidate/product`, shared secret, 2 s timeout, never fails the staff request). The 30-second revalidation remains the upper bound when a call is lost.

Evidence: `test/e2e-storefront/pdp-publish-cache.spec.ts` (fails without the repair: still 404 five seconds after publish), `p1-console.spec.ts` P1-01 (admin console publish and price reach the shop page at once; fails without the repair), `storefront-cache-invalidation.test.ts` (calls, refusal, timeout, not configured), config guard unit tests.

### Load and stock-integrity evidence (local, production builds, 4 vCPU)

- **100 concurrent shoppers, one product, 25 units** (`scripts/load-checkout-contention.mjs`, now in CI): each shopper opened the rendered product page, refreshed live stock, filled a bag and checked out at the same moment. 25 orders accepted, 75 clean `409 INSUFFICIENT_STOCK`, 0 server errors; accepted retries returned the same order; balance onHand 25 / reserved 25; 25 order lines; 25 converted, 0 active reservations; ledger reconciliation MATCH; storefront then offers 0 units. Latency (all 100 at once): product page p95 359 ms, live product p95 122 ms, add to bag p95 482 ms, checkout p95 1.84 s.
- **Read load gate is unchanged.** Every scenario, including the rendered product page at 200 connections, still fails on any error, timeout, non-2xx or invalid body (the admission/steady harness above). An earlier draft of this repair made that one phase measurement-only; it was withdrawn before push, because removing a failing gate is not evidence of capacity. What the earlier autocannon runs showed, kept as diagnosis rather than a pass: CI run 163 (a767cab) had 11 timeouts in 16,461 product-page requests at 200 connections (p99 191 ms); locally one of four full runs reproduced it (28 timeouts). A probe opening a new connection every 100 ms during that phase measured p50 360 ms / p99 2.1 s at 100 connections and p50 4.1 s / p99 7.8 s at 200, i.e. one storefront process saturates at ~1,100 rendered pages/s and newly arriving shoppers queue. Whether the new admission/steady harness passes at 200 is decided by the final-head CI run, not asserted here. Production capacity still needs several storefront instances and/or a CDN sized to expected traffic (below).

### Pagination and export audit (silent 1,000-row truncation)

No export (CSV/XLSX/download) feature exists in the API or admin console, so there is nothing to truncate. Every list endpoint caps a page at 60–200 rows and pages with take/skip (totals shown, Next/Previous in the console; storefront search and category pages show "Page X of Y"). Search widens Meilisearch's default 1,000-hit window to the index size. Background sweeps (payment expiry, reservation expiry, invoice recovery) walk keyset batches of 100 until exhausted. Bulk reads in marketing segments, loyalty sweeps and channel resync have no row cap. Remaining fixed limits are labelled summaries (Customer 360's 10 most recent orders beside the full count; PDP shows 10 reviews with a paged reviews endpoint) or unreachable (`NotificationService.listForCustomer`, 50, has no route). Boundary tests re-run green: search beyond 1,000 hits, analytics across 1,005 orders, collections beyond 200/500, loyalty beyond 200 entries.

One truncation path was found and fixed: the API cached Meilisearch's result window, so a window reset outside the API (for example Meilisearch restored with its default 1,000) capped listing results at 1,000 until a write or a deep page refreshed it. The full integration run exposed it through the search boundary test. Every search is now checked: Meilisearch caps `totalHits` at its live `maxTotalHits`, and the API keeps that window above the document count, so a result is complete exactly when `totalHits` is below the window in force. The live window is read before and after each search; a result at or above the lower reading forces a resync and a rerun, and after three attempts the search reports itself unavailable instead of returning a capped list. There is no time window in which a truncated result is returned. Cost: two small Meilisearch settings reads per search (identical concurrent searches share one). Evidence: integration test "never caps the first search after the result window is reset outside the API" (real Meilisearch; returns 1,000 instead of 1,005 without the check) and four unit tests (outside reset, a window grown during the search, persistent reset, normal path).

### Unresolved production configuration (blocks go-live)

| Area | State in code | Needed before launch |
|---|---|---|
| Hosting | Only the API has a container (`infra/commerce-api.Dockerfile`). No storefront or admin container, no target platform, domains, TLS, or production runtime credentials in this repository or session. | Choose the target; build the storefront with its `build` script; set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS` for the real proxy chain. |
| Product-page cache | Pages are cached per storefront instance; responses carry `s-maxage=30, stale-while-revalidate=31535970`. | Set `STOREFRONT_REVALIDATE_URL` (API) and the same `STOREFRONT_REVALIDATE_SECRET` on API and storefront. With more than one storefront instance, a shared Next cache handler or one revalidation call per instance. Any CDN in front must either not cache `/product/*` or be purged on the same events; otherwise it can hold a pre-publish 404 or a withdrawn product beyond 30 s. |
| Capacity | One storefront process ~1,100 product pages/s on a CI-class host before new shoppers queue for seconds. | Instance count/CDN sized from expected traffic; sustained mixed load on staging. |
| Payment | `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET` default empty: prepaid is unavailable (fail-safe), only COD works. | Razorpay live (or sandbox for staging) keys, webhook URL registered with the provider, webhook secret; sandbox capture/refund/timeout reconciliation run. |
| SMS (OTP) | `AuthService` wires `ConsoleOtpProvider`, which refuses to send in production. Customer sign-in by OTP cannot work in production. | Select an SMS/DLT-registered provider, implement `OtpProvider`, configure credentials and sender/template IDs, verify delivery. |
| Shipping | `SHIPPING_PROVIDER` registry holds only `MOCK`/`MOCK_SECONDARY`; production refuses MOCK. | Select a carrier (SHIP-001), implement the adapter, credentials, webhook URL/secret. |
| Object storage | Return evidence uses local disk (`RETURN_EVIDENCE_STORAGE_DIR`); S3 settings default to local MinIO. | Durable shared storage or a verified S3 adapter. |
| Marketing/notifications | `MARKETING_PROVIDER=MOCK` only. | Provider choice if campaigns/notifications are enabled at launch. |

**Go-live is not declared.** No production deployment or production smoke test has been performed; both remain required before any launch statement.
