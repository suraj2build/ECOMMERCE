# ADR-0009: Docker Compose for reproducible local development

## Status
Accepted

## Context
Development happens primarily remotely via Claude Code Web initially,
and the repository must later be clonable to a desktop machine and run
locally with no loss of fidelity (see `DEPLOYMENT.md` §2). Undocumented,
machine-specific setup ("works on my machine") is unacceptable given
the project will move between environments and between AI engineering
sessions that share no memory.

## Decision
The full local development stack (PostgreSQL, Redis, Meilisearch,
MinIO, Medusa v2, storefront, any custom services, and an nginx/
reverse proxy where appropriate) is defined and started via **Docker
Compose**, with configuration driven by a documented `.env` template
(no committed secrets — see `SECURITY.md`).

## Reasoning
- Docker Compose is a widely understood, low-ceremony way to define a
  multi-service local environment as code, versioned in Git alongside
  the application.
- It directly satisfies the remote-first requirement that a fresh
  session/clone plus documented commands is sufficient to get a
  working stack.
- It keeps local development topology close to how services are
  actually composed, reducing "local vs. production" drift (see
  `DEPLOYMENT.md` §4).

## Consequences
- Every service added to the platform must be reflected in the Docker
  Compose definition and documented startup instructions.
- Setup steps that aren't captured in Compose + documented commands
  are considered incomplete, even if they "work."
- Compose is a local/dev-time tool — it is not, by itself, the
  production deployment mechanism (production topology is a separate,
  not-yet-decided concern; see `DEPLOYMENT.md` §4).
