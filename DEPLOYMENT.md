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

### Review preview (LR-010)

No hosted preview: paid hosting is reserved for production. Reviews use the
local demo (`npm run demo`), reachable from a phone on the same Wi-Fi. See
`docs/deployment/LOCAL_DEMO.md`. It runs the production build with
`DEPLOYMENT_STAGE=preview`: production checks apply, the labelled test
providers stand in while LR-008 is open, live Razorpay keys are refused, and
the storefront is never indexed.

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

### Storefront build and cache

Build the storefront only with its own script (`npm run build
--workspace=apps/storefront`). It runs `next build` in production mode
and fails if the product route cannot render products that did not
exist at build time. A plain `next build` under any other `NODE_ENV`
silently produces a storefront where every product page is a 404.

Each storefront instance caches catalogue reads and the pages built from
them: product pages for up to 30 seconds, listings (home, category,
search, collections, Watch & Shop) for 30-60 seconds. After a quiet
spell the first visitor still gets the old copy while it refreshes, so
on its own the cache can show a removed product or an old price.

Set `STOREFRONT_REVALIDATE_URL` on the API (the storefront's
`/api/revalidate/product` URL, reachable from the API) and the same
random `STOREFRONT_REVALIDATE_SECRET` (32+ characters) on both the API
and the storefront. The API then:

- drops the product page and every cached listing after a product's
  publish, unpublish, archive, media, price or markdown change;
- drops every cached listing (`/api/revalidate/catalog`, next to the
  product URL) after a collection, badge, CMS, Watch & Shop or search-pin
  change and after `POST /search/reindex`.

Without them, those changes appear only when each cache entry expires.
Stock-only changes (orders, reservations, receipts) do not purge: listings
show no stock, a product page's availability refreshes within 30 seconds,
and cart and checkout always read live stock.

- More than one storefront instance: each keeps its own cache; use a
  shared Next.js cache handler or call every instance.
- A CDN or shared cache in front of the storefront: product pages are
  sent with `s-maxage=30, stale-while-revalidate`; either bypass the
  CDN cache for `/product/*` or purge it on the same events.
- Capacity: one storefront process served ~1,100 cached product pages
  per second in CI-class testing before newly arriving visitors queued
  for seconds; size instances or CDN offload to expected traffic
  (`acceptance/go-live/2026-10-02-readiness.md`).

**After a database restore or reseed** (any change made behind the
application), run `POST /api/v1/search/reindex` (`search:reindex`). It
rebuilds the search index from the database, removes products that are
no longer published, and purges the storefront cache. Until then the
storefront keeps the old listings and product pages, including pages
for products that no longer exist. Verified on 2026-10-04 by dropping
and reseeding the database under a running, warm storefront: the deleted
product stayed listed and its page answered 200 until the reindex, then
it left the listing and its page answered 404 within about 100 ms
(`test/e2e-storefront/listing-cache.spec.ts` checks the same path in CI).
Without `STOREFRONT_REVALIDATE_URL`, also delete
`apps/storefront/.next/cache` (or redeploy) and restart the storefront.

### Analytics and Meta (LR-003)

All off until set; nothing is collected without the visitor's consent.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | storefront build | GA4 browser tag (public ID) |
| `NEXT_PUBLIC_META_PIXEL_ID` | storefront build | Meta Pixel (public ID) |
| `GA4_MEASUREMENT_ID` + `GA4_API_SECRET` | commerce-api | Measurement Protocol purchase/refund (secret) |
| `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` | commerce-api | Conversions API (secret) |
| `STOREFRONT_PUBLIC_URL` | commerce-api | Required with Meta: event_source_url, feed links |
| `META_TEST_EVENT_CODE` | commerce-api | Optional: route events to Events Manager "Test events" while verifying |

The `NEXT_PUBLIC_` IDs are inlined at build time, so a preview built
without them shows no consent banner and loads no tags. Server events are
queued in `conversion_events` and sent by `POST /analytics/sweep/conversions`
(and the maintenance scheduler, LR-006); check
`GET /analytics/conversions` for failures. `SITE_INDEXING=enabled` must be
set only on the real production storefront (LR-002).

Purchase semantics (LR-009, Product Owner decision 2026-10-04):

- Prepaid: `purchase` / `Purchase` once the payment is captured.
- COD: placing the order sends `cod_order_placed` (GA4) and
  `CODOrderPlaced` (Meta custom event), never a purchase. The purchase is
  sent only when Finance records the cash collection after delivery
  (admin order page → "Record COD collection", or
  `POST /orders/:id/cod-collection`, permission `payment:cod:collect`),
  for the delivered lines only. A cancelled or refused COD order is
  therefore never a purchase. A refund is reported only against a
  purchase that was reported, and only when it completes after it.

`payment_type` (`cod` / `prepaid`) is on every order event. In GA4, register
it under Admin → Custom definitions as an event-scoped dimension, and mark
`cod_order_placed` as a key event only if you want placed COD orders counted
separately; do not count it as revenue. Withdrawing consent in "Privacy
choices" stops that purpose's queued server events (status `WITHDRAWN`).

Upgrading an existing database: migration `20261004110000_cod_collections`
creates `payment:cod:collect` and grants it to the SUPER_ADMIN and FINANCE
roles, so no re-seed is needed. (Re-running `npm run db:seed` against a
deployed database also creates the seed admin account if
`SEED_SUPER_ADMIN_EMAIL` is not that environment's existing admin; avoid it.)

### Product feeds: Google Merchant and Meta catalogue (LR-004)

Create a channel with `providerName` `GOOGLE_MERCHANT` or `META_CATALOG`
(admin Channels screen or `POST /channels`); add `"publishAll": true` to its
config to list every published product. Requires `STOREFRONT_PUBLIC_URL`.

| Variable | Purpose |
|---|---|
| `GOOGLE_MERCHANT_ACCOUNT_ID` | Merchant Center account |
| `GOOGLE_MERCHANT_DATA_SOURCE_ID` | API data source products are written to |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account with access to the account (secret; `\n` escapes accepted) |
| `META_CATALOG_ID` + `META_CATALOG_ACCESS_TOKEN` | Catalogue and a token with `catalog_management` (secret) |

Price, stock, publish and unpublish changes reach the channels through
`POST /channels/sweep/resync-stale` (scheduled by the maintenance runner,
LR-006). Check failures per listing in the admin Channels screen.

### Return-evidence storage (LR-005)

Production must set `RETURN_EVIDENCE_STORAGE=s3` with a private bucket
(`RETURN_EVIDENCE_S3_BUCKET`, default `return-evidence`; block all public
access) and real `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY` (secrets). Local disk is refused in production.

Before switching an environment to S3, verify the bucket with its real
settings and credentials:

```
npm run build -w @fcp/commerce-api
S3_VERIFY_ALLOWED=yes node scripts/verify-s3-bucket.mjs
```

The script must end with "All required checks passed". It proves:

- a signed upload/download round-trip;
- anonymous read, list and upload are all refused;
- no public ACL grant exists.

It also reports encryption and Block Public Access. The API credentials
need only `s3:PutObject` and `s3:GetObject` on `<bucket>/<prefix>*`; the
script reports, without failing, when DELETE is not allowed.

### Scheduled jobs and monitoring (LR-006)

Each API instance runs the maintenance scheduler. A per-job lease in
Postgres (`maintenance_job_states`) lets only one instance run a given job
at a time and spaces runs across instances. A job whose instance died
mid-run is picked up by another instance once the lease expires.

| Variable | Default | Purpose |
|---|---|---|
| `MAINTENANCE_LEASE_SECONDS` | 120 | Lease length; renewed every third of it while a job runs |
| `MAINTENANCE_ALERT_WEBHOOK_URL` | — | Secret URL; receives a JSON `{ text, kind, job, consecutiveFailures, error, environment, at }` when a job fails three runs in a row, and again when it recovers (Slack/Google Chat incoming webhooks accept it as is) |
| `MAINTENANCE_ALERT_LOG_ONLY` | false | Set `true` only when the host's log alerting pages on `alert: true` lines instead |

**Production refuses to start** without `MAINTENANCE_ALERT_WEBHOOK_URL`
unless `MAINTENANCE_ALERT_LOG_ONLY=true`. Check per-job status at
`GET /api/v1/maintenance/jobs` (`audit:read`): last run, success and failure,
consecutive failures, whether it is running, and when the alert was sent.
The scheduler cannot report its own absence, so also point an external
uptime check at `/health` and alert if no job has run recently.

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
   source). It prints counts and staff user ids only. Before any write
   it checks that EVERY existing encrypted MFA secret decrypts with the
   configured key; if even one does not, it exits 1 having modified no
   row and lists the affected staff user ids (it does not guess whether
   the key is wrong or the data is corrupt - investigate before
   re-running; a genuinely corrupt row is resolved by resetting that
   user's MFA and having them re-enroll). Exit code 2 means the backfill
   completed but some values were in no recognised format; those users
   must re-enroll MFA and are listed by id.
4. Start the new code. With `NODE_ENV=production` the API refuses to
   start (exits non-zero, never listens) while any non-v1 MFA secret
   remains, logging only the count (`pendingMfaUpgrades`), and also
   refuses if that check itself cannot run. It never runs the backfill
   itself - step 3 stays the explicit, authoritative step. Outside
   production the same condition is a warning only.
5. Re-running step 3 is a no-op.

On a fresh database there is nothing to backfill.

### Upgrading an existing database: inventory adjustment direction (P1 D-4)

Migration `20261001100000_inventory_adjustment_direction` is applied by
`prisma migrate deploy` like any other; there is no separate script and
no ordering requirement beyond deploying the new code after it.

- It adds the `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` ledger types (new
  adjustments use them) and the append-only
  `inventory_adjustment_resolutions` table.
- It never modifies existing `inventory_transactions` rows. For each
  legacy `ADJUSTMENT` row it records a direction only when the original
  `inventory.adjust` audit rows settle it (rule in the migration file);
  other legacy rows stay unresolved. Re-running the statement is a no-op.
- After deploying, count what stayed unresolved:

  ```sql
  SELECT count(*) FROM inventory_transactions t
  LEFT JOIN inventory_adjustment_resolutions r ON r."transactionId" = t.id
  WHERE t.type = 'ADJUSTMENT' AND r."transactionId" IS NULL;
  ```

  `GET /api/v1/inventory/reconcile` reports any balance with such a row as
  `UNVERIFIABLE` (never as a match). Resolving one needs evidence from
  outside the system (for example a count sheet) and a deliberate, separately
  authorized correction; the migration does not guess.
- Old code reads the new types as unknown and does not replay them, so do
  not run pre-D-4 instances against the migrated database for longer than
  the deployment itself.

On a fresh database the resolution step finds nothing.

## 6. Backup / restore / observability

See `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`'s `NFR-003` section for
the backup/restore policy status and `performance/BACKUP_RESTORE_REVIEW.md`
(M33) for this pass's own local exercise of a real backup/restore cycle
against this project's actual schema. See `performance/OBSERVABILITY_REVIEW.md`
(M33) for the structured-logging/correlation-ID review.
