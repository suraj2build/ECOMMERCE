# Architecture

**Status:** APPROVED (technology/architecture baseline only — see
caveat below).

This document describes the **approved architectural baseline** for
the platform. It governs *how* the system will be built once
implementation is authorized. It does **not** authorize the start of
implementation — see `BUILD_PLAN.md` for current per-milestone status
and `blueprint/READINESS.md` for why decision/milestone readiness is
not the same thing as implementation authorization (which, as of this
update, has not been given).

> Business-domain behavior (order rules, inventory rules, loyalty
> rules, etc.) is **not** covered here — see `/specs`. This document
> covers technology choices and structural principles only.

Full reasoning for each decision below is recorded as an ADR in
`docs/decisions/`. This document is the summary; the ADRs are the
source of truth for *why*.

## 1. Overall architectural style

- **Modular monolith** initially. Domain boundaries must remain
  explicit (clear module ownership, no silent cross-domain coupling)
  even though the code is deployed as one application. Avoid premature
  microservices decomposition.
- **Local-first but cloud-portable.** The system must run fully on a
  developer machine via containers, and must not hard-code assumptions
  that only hold on a specific cloud platform.
- **Containerized / reproducible development.** See `DEPLOYMENT.md`.

## 2. Technology baseline

| Layer | Choice | Notes |
|---|---|---|
| Frontend (storefront) | Next.js + React + TypeScript | Mobile-first, responsive. Separate admin experience where appropriate. |
| Commerce kernel | Medusa v2 | See ADR-0002. |
| Custom app/business services | Node.js + TypeScript | Domain services not covered by the commerce kernel. |
| Primary database | PostgreSQL | See ADR-0003. |
| Cache / jobs | Redis | Where appropriate (caching, queues/jobs). |
| Search | Meilisearch | Initial choice; see ADR-0005. |
| Object/media storage | S3-compatible abstraction; MinIO for local dev | See ADR-0006. |
| Payments | Provider abstraction; Razorpay first; COD supported | Future providers must be pluggable without rewriting order logic. See ADR-0011. |
| Testing | Unit, integration, Playwright E2E, security/authorization tests | See `TESTING.md`. |
| Infrastructure | Docker Compose (local); nginx/reverse proxy where appropriate; GitHub as source of truth; GitHub Actions for CI/CD | See `DEPLOYMENT.md`. |

## 3. Domain boundary principle

Even inside the modular monolith, each business domain (product,
inventory, procurement, order, fulfilment, loyalty, promotions,
customer, catalog, search, payments, etc.) must:

- Own its data model and expose behavior through explicit interfaces
  (service/module boundaries), not shared mutable state reached
  directly from unrelated modules.
- Be extractable into a separate service later without a rewrite, if
  that ever becomes necessary (this is *why* boundaries matter now,
  not a commitment to do it).
- Never encode unapproved business rules. A module boundary is a
  structural constraint; the behavior inside it still must trace back
  to an `APPROVED` spec.

## 4. Fashion product model (structural requirement)

The product/catalog data model must support:

```
STYLE -> COLOR -> SIZE -> SELLABLE SKU
```

with an **extensible attribute system** (department, gender, division,
category, subcategory, collection, season, brand, fabric, fit,
pattern, occasion, sleeve, neck, wash care, country of origin, and
future attributes) — i.e., attributes must be data-driven, not a fixed
set of hard-coded columns that blocks future extension.

See `specs/02-product-master.md`.

## 5. Inventory model (structural requirement)

Inventory must be modeled as an **auditable transaction/ledger**, not
a single mutable quantity field. The ledger must be able to represent
(at minimum): stock on hand, reserved, available, in transit, damaged,
return pending, adjustments, receipts, sales, cancellations, returns,
transfers. Exact fields/states are defined in
`specs/06-inventory.md` once approved.

See ADR-0012.

## 6. Loyalty model (structural requirement)

Loyalty must be modeled as an **auditable transaction/ledger**
(earn, redeem, reverse, expire, adjust), not a mutable points balance
alone. See ADR-0013 and `specs/22-loyalty.md`.

## 7. Channel architecture (structural requirement)

The product/catalog core must not be tightly coupled to one channel:

```
PRODUCT MASTER -> CHANNEL PUBLISHING -> WEBSITE / GOOGLE / META / future marketplaces
```

See `specs/25-social-channel-publishing.md`.

## 8. SEO (structural requirement)

SEO-relevant concerns (server-side rendering/indexability, canonical
URLs, sitemaps, structured data for `Product`/`ProductGroup`/`Offer`,
breadcrumbs, image metadata) must be designed into the storefront
architecture from the start, not retrofitted. See `specs/26-seo.md`.

## 9. Payments abstraction

All payment integrations go through a provider-abstraction layer.
Razorpay is the first provider; Cash on Delivery (COD) is supported as
a non-gateway payment method. Order logic must depend on the
abstraction, never on a specific provider's API shape, so that adding
or replacing a provider does not require rewriting order/checkout
logic. See ADR-0011.

## 10. What this document does not do

This document does **not** authorize implementation. Product Blueprint
V2 and specification approval are now complete (see
`blueprint/DECISION_REGISTER.md`) and most milestones in
`BUILD_PLAN.md` are `READY_FOR_IMPLEMENTATION` — but implementation
itself still requires a separate, explicit human **START BUILD**
authorization, which has not been given. See `CLAUDE.md` §0.
