# Hot-Path Load/Latency Benchmarks (M32 Performance/Scale, 6B)

## Method and honest scope boundary

Measured against a **single-container sandbox** (this development
environment) - not a staging environment matching production topology
(no CDN, no load balancer, no separate DB/app/cache tiers, shared CPU
with this session's other work). Per `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`'s
own existing "honesty-correction note" precedent (2026-09-24), these
numbers are reported as real, reproducible measurements taken under
stated conditions - **not** claimed as production-representative or as
final NFR-001 sign-off. `PRODUCTION_VERIFICATION_REQUIRED` remains the
correct status for a real staging-environment measurement; what changes
here is that, for the first time, a concrete measurement now exists at
all, superseding the prior "never measured" state.

**Dataset**: 2,000 styles x 2 colours x 4 sizes = 16,000 SKUs, 16,000
inventory-balance rows (`packages/db/prisma/perf-seed.ts`), the lower
half of the approved 10,000-50,000 SKU range. Search index: the full
2,014-style catalog (perf-seeded + pre-existing fixtures) indexed into a
real, locally-running Meilisearch instance via `POST /search/reindex`.

**Tooling**: `autocannon` (installed as a `services/commerce-api`
devDependency for this pass) for HTTP throughput/latency; a genuine
`fetch()`-based timing script for the rate-limited checkout path (see
below); `lighthouse` (installed standalone, not added to any
`package.json`, purely for this one-off measurement) against a real
`next build && next start` production build of `apps/storefront`, using
Chromium from this sandbox's pre-installed Playwright browser
(`/opt/pw-browsers`), simulated mobile throttling.

## API latency (autocannon, 20 connections, 10s, unauthenticated public routes)

| Route | p50 | p97.5 | p99 | Req/s (avg) | NFR-001 target | Result |
|---|---|---|---|---|---|---|
| `GET /storefront/styles?take=24` (PLP/home) | 70ms | 116ms | 126ms | 272 | (not separately targeted; feeds PDP LCP) | — |
| `GET /storefront/products/:styleId` (PDP) | 227ms | 267ms | 275ms | 87 | (not separately targeted) | — |
| `GET /storefront/search?q=Perf` (search) | 51ms | 64ms | 70ms | 401 | **< 300ms** | **PASS** (well under) |

PDP is measurably the heaviest of the three (variant/inventory
aggregation across every SKU for the style, plus reviews summary) -
227ms median is still comfortably under the 500ms checkout/payment
budget, but it is the one route here worth watching if catalog depth
grows well past this dataset's per-style variant count.

## Checkout/payment API latency

`POST /storefront/checkout/preview` is deliberately rate-limited to 30
requests/minute per guest identity (`security/AUTH_SESSION_SECURITY.md`,
M31 5E - it is the main coupon/gift-card-code probing surface). A raw
autocannon flood against it is not a valid latency measurement for this
route: at any realistic connection count it immediately saturates that
per-identity limit and measures 429 rejection latency, not real request
latency - this is the rate limiter working as designed, not a
benchmarking failure.

Measured instead with a targeted script (25 distinct guest identities,
5-way concurrency, one real cart-seed + checkout-preview cycle per
identity, never exceeding the 30/min cap for any single identity):

| Route | n | min | p50 | p95 | max | NFR-001 target | Result |
|---|---|---|---|---|---|---|---|
| `POST /storefront/checkout/preview` (real cart, real tax/promotion computation) | 25 | 22ms | 28ms | 38ms | 45ms | **< 500ms** | **PASS** (well under) |

## Search reindex throughput (batch operation, not a live user-request path)

`POST /search/reindex` (staff-gated, full catalog rebuild) over the
2,014-style catalog: **5m33.6s** (`{"indexed":2014}`). This is the
`SearchIndexService`'s reindex loop already flagged as a "documented,
not fixed this pass" N+1 finding in `performance/DATABASE_QUERY_REVIEW.md`
(one `getActivePrice` query per style) - this measurement is the
concrete throughput evidence that finding's "lower priority than the
two fixed live-request findings" judgment call was based on: at ~165ms/
style, a full reindex of the approved range's upper bound (50,000 SKUs,
roughly proportional style count) would take on the order of tens of
minutes, acceptable for an occasional staff-triggered full rebuild but
a real target for the batching fix recommended in that document's own
follow-up note, if reindex frequency or catalog size grows materially
past what this pass measured.

## Storefront Core Web Vitals proxy (Lighthouse, mobile, simulated throttling)

Real `next build && next start` production server, Chromium headless,
`--throttling-method=simulate --form-factor=mobile`:

| Page | LCP | FCP | TBT | CLS | Performance score | NFR-001 target (LCP) | Result |
|---|---|---|---|---|---|---|---|
| `/` (Home) | 2.2s | 0.8s | 330ms | 0 | 0.91 | **< 2.5s** | **PASS** |
| `/product/[styleId]` (PDP) | 2.1s | 0.8s | 150ms | 0 | 0.98 | **< 2.5s** | **PASS** |

This is the first actual Lighthouse LCP measurement taken anywhere in
this codebase's history (superseding the bundle-size-only proxy
recorded in `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` on 2026-09-24,
which explicitly declined to claim this measurement). It remains a
single-container-sandbox, simulated-throttling number, not a real 4G
field measurement (no real network, no real CDN, no real device) - the
correct next step for a genuine production LCP claim is a field
measurement (CrUX/RUM) once actually deployed, which this pass
correctly does not claim to substitute for.

## Interpretation

Every measured NFR-001 target (checkout/payment API p95 < 500ms, search
< 300ms, PDP/Home LCP < 2.5s) is met by a wide margin at this dataset
scale and in this single-container environment - genuinely encouraging
data, but explicitly not the same claim as "verified under production
load/topology." No NFR-001 target is revised by this pass; each is
**CONFIRMED at measured scale**, with `PRODUCTION_VERIFICATION_REQUIRED`
correctly remaining the status for a real staging/production
measurement, per `CLAUDE.md`'s explicit instruction never to invent an
SLO decision this pass isn't authorized to make.
