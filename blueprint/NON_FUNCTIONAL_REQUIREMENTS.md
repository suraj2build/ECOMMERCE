# Non-Functional Requirements (NFR)

**Status:** DRAFT — structural checklist only. Every numeric target
below is marked `TARGET_REQUIRED` because no target has been approved.
Do not treat any number that may appear in surrounding prose elsewhere
in this repository as an NFR target unless it appears here with a
value and a `Status: DECIDED` marker.

This document expands `NFR-001`–`NFR-006` in `DECISION_REGISTER.md`
into the full structured checklist referenced by `TESTING.md` and
`acceptance/README.md`.

## Performance

- Storefront page-load (PDP, PLP, homepage) — Core Web Vitals (LCP,
  INP, CLS): `TARGET_REQUIRED`
- Checkout API p95/p99 latency: `TARGET_REQUIRED`
- Search query response time: `TARGET_REQUIRED`
- Admin screen load time: `TARGET_REQUIRED`
- Mobile network condition assumptions (target for 3G/4G performance,
  relevant given a mobile-first, India-market audience):
  `TARGET_REQUIRED`

*(NFR-001)*

## Availability

- Storefront uptime SLO: `TARGET_REQUIRED`
- Admin/internal tooling uptime SLO (may reasonably differ from
  storefront): `TARGET_REQUIRED`
- Planned maintenance window policy: `TARGET_REQUIRED`

*(NFR-002)*

## Scalability

- Expected peak concurrent users at launch and at a defined future
  horizon (e.g., 6/12 months): `TARGET_REQUIRED`
- Expected peak order volume (e.g., sale-event traffic): `TARGET_REQUIRED`
- Catalog size assumptions (SKU count) the architecture must comfortably
  support: `TARGET_REQUIRED`

## Security

- See `SECURITY.md` for governance-level policy (already approved).
- Penetration testing cadence: `TARGET_REQUIRED`
- Dependency vulnerability scanning cadence (M29 Security Hardening):
  `TARGET_REQUIRED`

## Accessibility

- Target WCAG conformance level (A / AA / AAA): `TARGET_REQUIRED`
  *(NFR-004)*
- Scope: storefront only, or storefront + admin: `TARGET_REQUIRED`

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

## Backup / Restore / Disaster Recovery

- Backup frequency: `TARGET_REQUIRED`
- Recovery Time Objective (RTO): `TARGET_REQUIRED`
- Recovery Point Objective (RPO): `TARGET_REQUIRED`
- Disaster recovery test cadence: `TARGET_REQUIRED`

*(NFR-003)*

## Data retention & privacy

- See `CUST-001`, `AUD-001`, `AUD-002` in `DECISION_REGISTER.md` —
  retention periods per data category are unresolved and, per
  `AUD-002`, may have regulatory implications requiring legal
  verification before being treated as settled.

## Rate limiting / API reliability

- Public storefront API rate limits: `TARGET_REQUIRED`
- Admin API rate limits: `TARGET_REQUIRED`
- Error budget for critical write paths (checkout, payment,
  inventory): `TARGET_REQUIRED`

*(NFR-006)*

## Background jobs

- Maximum acceptable job queue lag (e.g., search indexing after a
  catalog change, notification dispatch after an order event):
  `TARGET_REQUIRED`
- Retry/dead-letter policy: not yet decided.

## Search indexing

- Maximum acceptable delay between a catalog change (price, stock,
  publish status) and it being reflected in Meilisearch:
  `TARGET_REQUIRED`

## Image optimization

- Supported image formats, responsive image size variants, and
  maximum acceptable image payload per PDP: `TARGET_REQUIRED`

## Mobile performance

- Given the mobile-first requirement (`ARCHITECTURE.md` §2), mobile
  performance targets should be defined explicitly rather than
  inherited generically from desktop targets: `TARGET_REQUIRED`

## Browser support

- Supported browser/OS matrix: `TARGET_REQUIRED` *(NFR-005)*

---

## How this document is used

Every `TARGET_REQUIRED` marker above corresponds to a gap that must be
filled with an explicit, approved number before the relevant milestone
can be considered to have a complete Definition of Done
(`acceptance/README.md`). Do not let an engineering agent invent a
plausible-sounding number to fill these in — that is exactly the kind
of silent assumption `CLAUDE.md` §4 prohibits.
