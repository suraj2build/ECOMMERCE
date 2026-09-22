# Deployment

**Status:** DRAFT (local development model is APPROVED baseline;
production deployment topology is not yet specified)

## 1. Local development (approved baseline, not yet implemented)

The project must run locally through a **reproducible containerized
development environment**, so that:

- A fresh clone plus documented commands is enough to get a working
  local stack — no undocumented machine-specific setup.
- The same environment definition works whether developed remotely
  (Claude Code Web) or later cloned to a desktop machine.

Approved components of the local stack (see `ARCHITECTURE.md` and the
corresponding ADRs):

- **Docker Compose** orchestrating: PostgreSQL, Redis, Meilisearch,
  MinIO (S3-compatible storage), the Medusa v2 commerce kernel, the
  Next.js storefront, and any custom Node.js/TypeScript services.
- **nginx/reverse proxy** in front of the stack where appropriate.
- Environment configuration via a documented `.env.example` template
  (no real secrets committed — see `SECURITY.md`).

None of the above is implemented yet — this section describes the
target, to be built starting at M00 once `BUILD_PLAN.md` is unblocked.

## 2. Remote-first development requirement

This project is developed primarily through **Claude Code Web**
initially. Consequences:

1. GitHub must contain everything required for a new engineering agent
   to understand the project (this documentation set exists for that
   reason).
2. No critical architectural knowledge should exist only in chat
   history.
3. A fresh Claude session must be able to determine, from the repo
   alone: what the product is, how it's architected, what's approved,
   what's unresolved, what milestone is active, how to test it, and
   what constitutes done.
4. The repository must later support being cloned to a desktop and run
   locally with no loss of fidelity.
5. Local startup must eventually be reproducible through documented
   commands/container configuration, not tribal knowledge.

## 3. CI/CD (target, not yet implemented)

- **GitHub Actions** for CI/CD.
- CI must run lint, type-checking, and the test suite (see
  `TESTING.md`) on every pull request once the pipeline exists.
- CD (actual deployment automation) is out of scope until a production
  environment is defined and approved — see §4.

## 4. Production deployment (NOT YET SPECIFIED)

**DECISION_REQUIRED:** Production hosting target (cloud provider,
managed services vs. self-hosted containers, region, scaling model)
has not been decided. This section will be completed once the human
project owner and ChatGPT (Product Owner) define production
requirements as part of a future blueprint.

Whatever the eventual target, the following are fixed constraints
(see `SECURITY.md`):

- Production deployment always requires explicit human approval per
  deployment — it is never autonomous.
- Destructive production operations (migrations, data deletion,
  credential changes) always require explicit human approval.
- The same containerized application must be deployable without a
  rewrite — i.e., production infrastructure choices should not force
  divergence between the local Docker Compose topology and how
  services are actually composed in production.

## 5. Environment variables

Once services exist, this repository will include a `.env.example` (or
per-service equivalents) documenting every required environment
variable with placeholder values, kept in sync with actual usage.
No real credentials are ever committed (see `SECURITY.md`).
