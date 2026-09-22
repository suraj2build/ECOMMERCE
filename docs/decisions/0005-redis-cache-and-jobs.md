# ADR-0005: Redis for caching and background jobs

## Status
Accepted

## Context
The platform will need caching (e.g., session data, rate limiting,
expensive read paths) and background/async job processing (e.g.,
search indexing, notifications, order-processing side effects) as it
grows. Medusa v2 also natively expects a Redis-compatible store for
its event bus/workflow engine in typical deployments.

## Decision
Use **Redis** for caching and job/queue infrastructure where
appropriate, rather than overloading PostgreSQL for these purposes or
introducing a separate queue technology.

## Reasoning
- Aligns with Medusa v2's native expectations, avoiding unnecessary
  divergence from the commerce kernel's own architecture (ADR-0003).
- Well-understood, simple to run locally via Docker Compose
  (ADR-0009), and simple to operate in most production environments.
- Keeps caching/queueing concerns out of the primary transactional
  database, preserving PostgreSQL's performance for ledger-integrity
  workloads (ADR-0004).

## Consequences
- Redis is treated as **ephemeral/derived state** — nothing that must
  survive as a source of truth should live only in Redis. Ledgers
  (inventory, loyalty) and orders remain in PostgreSQL.
- Background job design (retry semantics, idempotency) must be
  specified per-domain as those domains are built (e.g.,
  `specs/06-inventory.md`, `specs/29-notifications.md`).
