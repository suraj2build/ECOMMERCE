# M00 — Project Foundation Acceptance Criteria

**Spec(s):** `specs/00-platform-overview.md`, `specs/31-organization-locations.md`
**Status:** READY_FOR_IMPLEMENTATION (see `BUILD_PLAN.md`)

## Business acceptance

- [ ] The repository, once implemented, reflects a **single legal
      entity** operator supporting **multiple internally-owned
      brands**, each products/styles reference via a first-class Brand
      entity (`ORG-001`).
- [ ] The data model is **location-aware**: every inventory-adjacent
      table/entity that will later need a location dimension
      (inventory, PO, fulfilment) has a location reference from the
      first migration, even though only one warehouse location is
      seeded (`ORG-002`).

## Functional acceptance

- [ ] A `Brand` entity exists with create/read/update operations,
      referenced by (not embedded in) product records.
- [ ] A `Location` entity exists with at minimum: identifier, type
      (warehouse; extensible), status (active/inactive).
- [ ] The Docker Compose local environment (PostgreSQL, Redis,
      Meilisearch, MinIO, and application services per
      `DEPLOYMENT.md`) starts successfully from a fresh clone using
      only documented commands.
- [ ] `.env.example` exists, documents every required environment
      variable with placeholder values, and contains no real secrets.

## Data integrity

- [ ] Adding a second `Brand` or `Location` after initial seed data
      requires no schema migration — proves the extensibility
      requirement from `specs/31-organization-locations.md`.

## Authorization

- [ ] No customer- or business-data endpoints exist yet at this
      milestone (foundation only) — N/A beyond repository/environment
      access.

## Auditability

- [ ] Database migration history is version-controlled and
      reproducible from a clean database.

## Positive scenarios

1. Fresh clone → documented setup commands → full local stack running
   → a smoke-test endpoint (e.g., health check) responds successfully.
2. A second Brand and a second Location can be created via
   direct data access (admin UI not required yet) without a schema
   change.

## Negative scenarios / edge cases

1. Missing `.env` file → setup fails with a clear, actionable error
   (not a silent partial start).
2. Attempting to reference a non-existent Brand/Location from another
   entity → rejected with a clear foreign-key/validation error.

## API / Database behavior

- [ ] Database schema is managed through reviewed migrations (per
      `ARCHITECTURE.md` §2), not manual/ad hoc changes.
- [ ] No API surface is expected at this milestone beyond a health
      check.

## Security

- [ ] No secrets committed (`git log` and working tree scanned clean).
- [ ] `.env.example` contains only placeholders.

## Performance expectations

- [ ] Local stack starts within a reasonable time on a standard
      developer machine (informal target, not a hard SLA at this
      stage).

## Observability

- [ ] Basic structured logging is configured for all services from the
      start (convention established here propagates to every later
      milestone).

## Test requirements

- [ ] Migration apply/rollback tested against a fresh database.
- [ ] CI pipeline runs lint, type-check, and build on every PR from
      this milestone onward (`TESTING.md` §5).

## Definition of Done

All boxes above checked, plus the full checklist in
`acceptance/README.md`.
