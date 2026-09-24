# Non-Functional Requirements (NFR)

**Status update (2026-09-22):** `NFR-001` through `NFR-006` are now
`DECIDED` as initial engineering-default targets (informed by the
Product Owner's given operating scale: 10,000–50,000 SKUs,
1,000–10,000 orders/day) — see `blueprint/DECISION_REGISTER.md`. Every
target below marked **DECIDED** is now real and testable (see
`acceptance/m09-storefront-foundation.md` and others); every target
still marked `TARGET_REQUIRED` remains genuinely unset — it was not
covered by `NFR-001`–`006` and is not yet a blocking gap (per
`CLAUDE.md` §4, do not invent these; they're revisable after M32 load
testing regardless of whether initially decided or left open).

This document expands `NFR-001`–`NFR-006` in `DECISION_REGISTER.md`
into the full structured checklist referenced by `TESTING.md` and
`acceptance/README.md`.

## Performance — `NFR-001` DECIDED (initial targets, revisable at M32)

- Storefront page-load: PDP LCP < 2.5s on a representative 4G mobile
  profile. **DECIDED (target), PRODUCTION_VERIFICATION_REQUIRED
  (measurement).** See the honesty-correction note below - this has
  never actually been measured, despite M09/M10/M11's acceptance docs
  each deferring it to "the Phase 2 end-to-end certification round,"
  which then did not measure it either.
- Checkout/payment API p95 latency: < 500ms. **DECIDED (target),
  PRODUCTION_VERIFICATION_REQUIRED (measurement).** No load-testing
  tool has been run against this codebase at any point; the
  integration-test suite proves correctness under a handful of
  genuinely concurrent requests (M06/M13/M14/M15's own concurrency
  tests), which is a correctness guarantee, not a latency/throughput
  measurement.
- Search query response time: < 300ms. **DECIDED (target),
  PRODUCTION_VERIFICATION_REQUIRED (measurement).** Same gap as above.
- Admin screen load time: `TARGET_REQUIRED` (not covered by the initial
  decision; not launch-blocking).
- INP/CLS Core Web Vitals thresholds beyond LCP: `TARGET_REQUIRED`.

**Honesty-correction note (2026-09-24, Phase 2 independent-certification
repair pass, finding #7):** `acceptance/m09-storefront-foundation.md`
and `acceptance/m11-pdp.md` each state PDP/Home LCP is "Not yet
measured... deferred to the Phase 2 end-to-end certification round."
That round (`BUILD_PLAN.md`'s "Phase 2 end-to-end proof + certification
round" entry, 2026-09-23) came and went without performing this
measurement, and none of the three documents were updated to say so -
the promise was silently re-deferred rather than honestly corrected.
No LCP, API-latency, or search-latency measurement tool (Lighthouse,
k6, autocannon, or otherwise) exists anywhere in this repository or its
CI workflow as of this pass. This repair pass does not build one either
(that is explicitly M32's own scope, and building new performance-
testing infrastructure is out of scope for a defect-repair pass) - it
only corrects the record: **all three targets above remain
PRODUCTION_VERIFICATION_REQUIRED, full stop, with no partial or
sandbox-approximated measurement to report for LCP or API/search
latency specifically.**

The one concrete, reproducible, ENGINEERING_VERIFIED data point this
pass *does* have, taken directly from a real `npm run build --workspace=
apps/storefront` production build output (2026-09-24, this sandbox) -
offered as a proxy signal for mobile parse/execute cost, explicitly
**not** an LCP or Core Web Vitals measurement and **not**
production-representative (single-container sandbox build, no CDN, no
real network):

| Route | First Load JS |
|---|---|
| `/` (Home) | 111 kB |
| `/product/[styleId]` (PDP) | 117 kB |
| `/bag` | 114 kB |
| `/checkout` | 106 kB |
| `/wishlist` | 114 kB |

These are within the range commonly considered reasonable for a
mobile-first storefront, but bundle size is not a substitute for a real
LCP measurement (network/server/image-loading time dominates LCP, not
JS payload alone) - do not cite this table as NFR-001 compliance
evidence. M32 remains the milestone responsible for an actual
Lighthouse/WebPageTest-class LCP measurement and a real load test
against representative catalog scale and concurrency, and M32 is
sequence-blocked and **not authorized** (`BUILD_PLAN.md`).

## Availability — `NFR-002` DECIDED (initial targets)

- Storefront uptime SLO: 99.9%. **DECIDED.**
- Admin/internal tooling uptime SLO: 99.5% (deliberately more
  maintenance-window-tolerant than storefront). **DECIDED.**
- Planned maintenance window policy: `TARGET_REQUIRED` (operational
  detail, not launch-blocking).

## Scalability

- Catalog size the architecture must comfortably support: **10,000–50,000
  SKUs. DECIDED** (explicit Product Owner operating-scale statement,
  §2 of the 2026-09-22 session).
- Order volume the architecture must comfortably support without
  fundamental redesign: **1,000–10,000 orders/day. DECIDED** (same
  source).
- Expected peak concurrent users, and the growth horizon (6/12 months)
  beyond the scale above: `TARGET_REQUIRED` — not given, not
  launch-blocking; informs M32 load-test design.

## Security

- See `SECURITY.md` for governance-level policy (already approved).
- Penetration testing cadence: `TARGET_REQUIRED`
- Dependency vulnerability scanning cadence (M29 Security Hardening):
  `TARGET_REQUIRED`

## Accessibility — `NFR-004` DECIDED

- Target WCAG conformance level: **2.1 AA. DECIDED**, storefront scope.
- Admin accessibility scope: `TARGET_REQUIRED` (not explicitly covered
  by the decision; recommend the same AA target when M29 Admin is
  built, but not yet formally decided).

## SEO

- See `specs/26-seo.md` for functional SEO requirements. NFR-level
  target: time-to-index for new/updated products: `TARGET_REQUIRED`

## Observability

- Logging/metrics/tracing stack: not yet decided (no ADR).
- Alerting thresholds for critical flows (payment failures, inventory
  ledger write failures, order-placement errors): `TARGET_REQUIRED`
- Log retention period: `TARGET_REQUIRED` (also see `AUD-001`)

## Auditability

- See `ARCHITECTURE.md` §§5–6 (ledger principles) and
  `specs/30-audit-compliance.md`. NFR-level target: maximum acceptable
  latency between an event occurring and it being queryable in the
  audit trail: `TARGET_REQUIRED`

## Backup / Restore / Disaster Recovery — `NFR-003` DECIDED (initial targets)

- Backup frequency: daily. **DECIDED.**
- Recovery Point Objective (RPO): ≤ 24 hours. **DECIDED.**
- Recovery Time Objective (RTO): ≤ 4 hours. **DECIDED.**
- Disaster recovery test cadence: `TARGET_REQUIRED` (operational
  detail, not launch-blocking).

## Data retention & privacy

- `AUD-001` (audit logging mechanism and access control) is
  **DECIDED** — see `specs/30-audit-compliance.md`.
- `CUST-001` (customer data retention/deletion policy) and `AUD-002`
  (applicable regulatory requirements) remain **UNDER_REVIEW** —
  genuine compliance/legal verification items, not yet resolved and
  not to be treated as settled. See `blueprint/DECISION_REGISTER.md`.

## Rate limiting / API reliability — `NFR-006` DECIDED (framework only)

- **DECIDED:** standard per-IP/per-session rate limits apply to public
  storefront APIs, particularly OTP request/verify and checkout/
  payment endpoints (see `specs/01-auth-rbac.md`, `specs/13-payment.md`).
- Exact numeric limits and error-budget figures: `TARGET_REQUIRED` —
  tuned during M32 load testing, not invented here.

## Background jobs

- Maximum acceptable job queue lag (e.g., search indexing after a
  catalog change, notification dispatch after an order event):
  `TARGET_REQUIRED`
- Retry/dead-letter policy: not yet decided.

## Search indexing

- Maximum acceptable delay between a catalog change (price, stock,
  publish status) and it being reflected in Meilisearch:
  `TARGET_REQUIRED`. Engineering note (M10, 2026-09-23): the built
  pipeline indexes synchronously, within the same request that makes
  the change (`services/commerce-api/src/modules/search/index-
  service.ts`) — effectively zero lag in this build, since there is no
  job queue to make it asynchronous with (ADR-0005). This is the best
  available engineering answer, not a decided SLA number; a formal
  target is still needed if/when indexing moves to an async queue at
  higher catalog-change volume.

## Image optimization

- Supported image formats, responsive image size variants, and
  maximum acceptable image payload per PDP: `TARGET_REQUIRED`

## Mobile performance

- Given the mobile-first requirement (`ARCHITECTURE.md` §2), mobile
  performance targets should be defined explicitly rather than
  inherited generically from desktop targets: `TARGET_REQUIRED`

## Browser support — `NFR-005` DECIDED

- Supported browser/OS matrix: **last 2 versions of Chrome, Safari,
  Firefox, Edge; current iOS Safari and Android Chrome. DECIDED.**

---

## How this document is used

Every `TARGET_REQUIRED` marker above corresponds to a gap that must be
filled with an explicit, approved number before the relevant milestone
can be considered to have a complete Definition of Done
(`acceptance/README.md`). Do not let an engineering agent invent a
plausible-sounding number to fill these in — that is exactly the kind
of silent assumption `CLAUDE.md` §4 prohibits.
