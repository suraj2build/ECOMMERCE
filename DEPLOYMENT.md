# Deployment

**Status (updated 2026-09-29, M33):** local development and CI are
**IMPLEMENTED** and have been since Phase 1; production deployment
topology remains **NOT YET SPECIFIED / DECISION_REQUIRED** — this
document was last accurate at the pre-M00 planning stage and is
corrected here as part of M33's deployment-readiness review, per this
project's own documentation-honesty discipline (`CLAUDE.md` §8). No
actual production deployment is performed or authorized by this
correction — see §4.

## 1. Local development (IMPLEMENTED)

Actual local topology, in place since Phase 1 and unchanged in shape
through M30-M33: **Docker Compose** (`docker-compose.yml`) orchestrates
PostgreSQL, Redis, and Meilisearch; the `services/commerce-api` Fastify
service and `apps/storefront`/`apps/admin` Next.js apps run as native
Node processes against that compose stack (`npm run dev` per
workspace), not themselves containerized in local dev. MinIO/S3-
compatible object storage is used for the M19 return-evidence-photo
upload provider abstraction (`security/PII_DATA_INVENTORY.md`
documents what it stores). No Medusa kernel exists in this codebase —
`docs/decisions/0019-custom-platform-sole-commerce-system-of-record.md`
is the live ownership decision, superseding the earlier Medusa-split
ADRs this section originally described. A fresh clone plus
`.env.example` plus the documented `npm install`/`docker compose up`/
`npm run db:migrate`/`npm run db:seed` sequence (`README.md`) is
sufficient to get a working local stack — proven repeatedly across this
project's history by this pass's own and prior passes' migration-from-
zero validations (see `performance/` and each milestone's acceptance
doc).

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

## 3. CI/CD (CI IMPLEMENTED; CD not yet implemented)

**CI is real and has run on every push to this branch since Phase 1**
(`.github/workflows/ci.yml`): installs dependencies, runs a dependency
vulnerability audit and a `gitleaks` secret scan (both added M31), runs
lint/typecheck/build across every workspace, runs the full unit +
integration suite against real Postgres/Redis in the runner, runs the
full Playwright E2E suite (storefront + `admin` + api-smoke projects),
and runs a migration-from-zero + `prisma migrate diff --exit-code`
schema-drift check. This document previously, incorrectly, described
CI as "target, not yet implemented" — corrected here.

**CD (automated deployment) remains genuinely not implemented** — no
workflow deploys anywhere; this is correct and deliberate, since no
production target exists to deploy to (see §4).

## 4. Production deployment topology (NOT YET SPECIFIED —
## `DECISION_REQUIRED`)

**Still genuinely undecided, unchanged by M30-M33**: production hosting
target (cloud provider, managed services vs. self-hosted containers,
region, scaling model, CDN/WAF vendor). This is correctly left open
rather than guessed — `CLAUDE.md` explicitly prohibits inventing
production infrastructure decisions. What M33 DOES establish, without
deciding the above, is the shape any target topology must satisfy,
directly derived from what this codebase actually requires today
(traced in `blueprint/TRACEABILITY_MATRIX.md`):

- **Compute**: one Node.js process for `services/commerce-api`
  (stateless — session state lives in Redis, not process memory) and
  one each for `apps/storefront`/`apps/admin` (Next.js, supports either
  a Node server or a platform-managed Next.js runtime).
- **Data tier**: PostgreSQL (primary system of record — every
  financial/inventory ledger table), Redis (staff sessions,
  M31 rate-limit counters — see `performance/CACHE_REDIS_REVIEW.md`
  for why nothing else is cached there), Meilisearch (search
  projection only, never a source of truth — safe to lose and
  rebuild via `POST /search/reindex`).
- **Object storage**: an S3-compatible bucket for return-evidence
  photos (currently local-disk in dev/CI, behind an interface a real
  S3 provider can implement unchanged per M19's evidence-upload repair
  note).
- **External providers**: all behind this codebase's own abstraction
  interfaces (`PaymentProvider`, `ShippingProvider`, `MarketingProvider`,
  `ChannelProvider`) — no vendor is hard-selected in code; each is
  chosen per-environment via config, with the M31 production guard
  refusing any `MOCK_*` provider when `NODE_ENV=production`
  (`security/SECRETS_CONFIG_AUDIT.md`).
- **Ingress**: a WAF/CDN layer in front of the storefront/admin apps is
  assumed but not built or selected — `security/AUTHORIZATION_SWEEP.md`
  and `security/INPUT_WEB_SECURITY.md` both document that this
  application's own security controls (rate limiting, security headers,
  auth) do not depend on any specific CDN/WAF vendor being present, so
  choosing one later does not require an application-code change.

Whatever the eventual target, the following are fixed constraints
(see `SECURITY.md`), unchanged since this document's original draft:

- Production deployment always requires explicit human approval per
  deployment — it is never autonomous.
- Destructive production operations (migrations, data deletion,
  credential changes) always require explicit human approval.
- The same application must be deployable without a rewrite — i.e.,
  production infrastructure choices should not force divergence
  between the local Docker Compose data-tier topology and how services
  are actually composed in production.

**This document does not authorize, perform, or simulate any actual
production deployment** — per M33's own explicit scope boundary, it
records readiness/topology requirements only.

## 5. Environment variables (IMPLEMENTED)

`.env.example` exists at the repo root and documents every required
environment variable with placeholder values (`packages/config/src/index.ts`
is the single source of truth the schema is validated against —
`loadEnv()` fails startup safely, per `security/SECRETS_CONFIG_AUDIT.md`,
if a required variable is missing rather than silently defaulting a
production-unsafe value). No real credentials are committed — verified
by this pass's own `gitleaks` CI step (§3) and, historically, by every
milestone's own dependency/secret hygiene review.

Production refuses to start (at `loadEnv()`) unless, in addition to the
required variables above:

- `GUEST_SESSION_SIGNING_SECRET` is set, at least 32 characters, not a
  placeholder, and different from `JWT_ACCESS_SECRET`;
- `JWT_ACCESS_SECRET` and `MFA_SECRET_ENCRYPTION_KEY` are real generated
  values, not the `.env.example` / CI placeholders;
- `GUEST_SESSION_ALLOW_UNSIGNED` and `AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX`
  are not set.

`TRUST_PROXY_HOPS` must equal the number of reverse proxies in front of
the API (default 1 = one load balancer; e.g. CDN + load balancer = 2).
Per-IP rate limiting uses the client address that many hops back, and
the API must not be reachable except through those proxies.

### Upgrading an existing database: MFA secret backfill

Staff MFA seeds written before M31 are plaintext; the application only
reads the v1 encrypted format and never falls back to plaintext, so
affected staff cannot complete MFA login until the backfill has run. It
is application code (only the application holds the key), idempotent,
and safe to run while the service is up. Order:

1. Stop or drain every instance running pre-M31 code (pre-M31 code
   writes and reads plaintext; it must not run after step 3).
2. `prisma migrate deploy` (packages/db).
3. With the production `DATABASE_URL` and `MFA_SECRET_ENCRYPTION_KEY`:
   `node services/commerce-api/dist/scripts/backfill-mfa-secrets.js`
   (or `npm run mfa:backfill --workspace=services/commerce-api` from
   source). It prints counts and staff user ids only. Exit code 2 means
   some stored values were unreadable (corrupt or encrypted under a
   different key) - those users must re-enroll MFA; they are listed by
   id. It aborts without writing if existing v1 rows do not decrypt with
   the configured key.
4. Start the new code. At startup the API logs
   `pendingMfaUpgrades` (a count, never a value) if any non-v1 secret
   remains.
5. Re-running step 3 is a no-op.

On a fresh database there is nothing to backfill.

## 6. Backup / restore / observability

See `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`'s `NFR-003` section for
the backup/restore policy status and `performance/BACKUP_RESTORE_REVIEW.md`
(M33) for this pass's own local exercise of a real backup/restore cycle
against this project's actual schema. See `performance/OBSERVABILITY_REVIEW.md`
(M33) for the structured-logging/correlation-ID review.
