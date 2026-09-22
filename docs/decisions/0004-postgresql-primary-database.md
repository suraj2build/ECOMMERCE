# ADR-0004: PostgreSQL as primary database

## Status
Accepted

## Context
The platform requires a primary transactional data store capable of
supporting complex relational data (fashion product attribute model,
inventory ledger, orders, procurement) with strong consistency
guarantees, and must also be the database Medusa v2 (ADR-0003)
supports as its primary store.

## Decision
Use **PostgreSQL** as the primary relational database for the
platform.

## Reasoning
- Medusa v2 is built around PostgreSQL; aligning avoids fighting the
  commerce kernel's own assumptions.
- PostgreSQL offers strong transactional guarantees needed for
  ledger-style models (inventory, loyalty — see `ARCHITECTURE.md`
  §§5–6) and financial integrity (orders, payments).
- Rich support for JSON/JSONB gives flexibility for the extensible
  fashion attribute model (`specs/02-product-master.md`) without
  abandoning relational integrity elsewhere.
- Mature, self-hostable, well-supported in Docker Compose for local
  development (ADR-0009) and portable to most cloud providers.

## Consequences
- Data modeling across all domains should default to PostgreSQL unless
  a domain has a specific, documented reason to use a different store.
- Schema migrations must be managed through a reviewed migration
  tooling/process (to be defined at M00) — no ad hoc manual schema
  changes.
- Any future polyglot-persistence decision (e.g., a domain that
  genuinely needs a different database) requires its own ADR.
