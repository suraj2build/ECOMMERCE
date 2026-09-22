# Architecture Decision Records

This directory contains the durable, versioned record of significant
architectural decisions for the platform. See ADR-0001 for the process
itself.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-modular-monolith.md) | Modular monolith architecture | Accepted |
| [0003](0003-medusa-v2-commerce-kernel.md) | Medusa v2 as commerce kernel | Accepted |
| [0004](0004-postgresql-primary-database.md) | PostgreSQL as primary database | Accepted |
| [0005](0005-redis-cache-and-jobs.md) | Redis for caching and background jobs | Accepted |
| [0006](0006-meilisearch-search.md) | Meilisearch for search and discovery (initial) | Accepted |
| [0007](0007-s3-compatible-media-storage.md) | S3-compatible object storage, MinIO for local dev | Accepted |
| [0008](0008-nextjs-typescript-storefront.md) | Next.js + React + TypeScript storefront, TypeScript platform-wide | Accepted |
| [0009](0009-docker-local-reproducibility.md) | Docker Compose for reproducible local development | Accepted |
| [0010](0010-github-source-of-truth.md) | GitHub as the permanent source of truth | Accepted |
| [0011](0011-payment-provider-abstraction.md) | Payment provider abstraction, Razorpay first, COD supported | Accepted |
| [0012](0012-inventory-ledger-principle.md) | Inventory as an auditable transaction/ledger | Accepted |
| [0013](0013-loyalty-ledger-principle.md) | Loyalty as an auditable transaction/ledger | Accepted |
| [0014](0014-remote-first-development.md) | Remote-first development via Claude Code Web | Accepted |
| [0015](0015-human-approval-for-production-actions.md) | Human approval required for production/destructive operations | Accepted |
| [0016](0016-medusa-v2-integration-sequencing.md) | Medusa v2 integration deferred to storefront/commerce milestones | Accepted |
| [0017](0017-medusa-custom-domain-ownership-boundary.md) | Medusa v2 ↔ custom-domain ownership boundary | Accepted |

New ADRs should be added sequentially and listed here. See
`CONTRIBUTING.md` §5 for the process.
