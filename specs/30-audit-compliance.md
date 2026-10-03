# 30. Audit / Compliance

**Status:** UNDER_REVIEW (audit-logging requirements DECIDED
2026-09-22; regulatory-requirement identification `AUD-002` remains
`UNDER_REVIEW` pending legal input — see `blueprint/DECISION_REGISTER.md`)

**Cross-cutting domain.**

## Purpose

Define platform-wide audit trail requirements and regulatory/
compliance posture.

## Scope

- Audit logging for ledger-backed domains and admin actions
- Financial reconciliation support
- Data retention and deletion policy
- Regulatory compliance requirements

## Approved requirements (2026-09-22)

- **Full auditability is required** for: inventory, pricing, orders,
  refunds, store credit, loyalty, promotions, permissions, and product
  publishing (explicit, §26).
- Every audited change MUST record: **who, what, when, old value, new
  value, reference/context.**
- Audit log access is restricted to Super Admin, Business Admin, and
  Finance by default, extendable per `specs/01-auth-rbac.md`'s
  permission matrix.
- Audit logging MUST be satisfied by querying the inventory and
  loyalty/store-credit ledgers (ADR-0012, ADR-0013), not a parallel
  logging system that could drift from them.

## Remaining open items — UNDER_REVIEW

- **`AUD-002` — Regulatory/compliance requirement identification.**
  What data-protection, consumer-protection, and financial-record-
  retention regulations apply to this platform's target market is
  **explicitly not resolved here** — the Product Owner instruction
  requires this be routed to legal verification, not invented (§28).
  Tracked jointly with `specs/21-customer-profile.md` `CUST-001`. Does
  not block M00/M01, or the audit-logging *mechanism* itself (which is
  fully decided above) — it governs retention-period specifics layered
  on top once confirmed.

## Acceptance criteria

See `acceptance/m29-admin-cms.md` for the audit-logging mechanism's
acceptance criteria (decided, testable now). Regulatory-retention-
specific criteria are deferred pending `AUD-002`.

## Dependencies

Depends on: `specs/06-inventory.md`, `specs/22-loyalty.md`,
`specs/33-store-credit-gift-cards.md`, `specs/28-admin.md`,
`specs/21-customer-profile.md`.

## Launch readiness addendum (2026-10-03) — IMPLEMENTED (awaiting independent review; external accounts not configured)

Legal pages publish only approved text (`LR-001`). Scheduled sweeps record every run and surface consecutive failures for alerting (`LR-006`). Analytics consent and its withdrawal are honoured before any third-party collection (`LR-003`).

### Implementation (2026-10-03) — scheduled sweeps and job monitoring

`services/commerce-api/src/maintenance.ts` schedules every recovery/expiry
sweep in-process (started by `src/index.ts` outside tests): payment and
reservation expiry, invoice recovery, loyalty/store-credit/gift-card hold
release (every minute); refund reconciliation and stale channel claims
(5 min); loyalty vesting (15 min) and expiry (hourly); due campaigns and
conversion-event dispatch (every minute); channel feed resync
(`CHANNEL_RESYNC_INTERVAL_MINUTES`, 15); and run-history pruning
(`MAINTENANCE_RUN_RETENTION_DAYS`, 30). Scheduled channel and campaign runs
are audited as `SYSTEM` (no staff actor). Every run is stored in
`maintenance_job_runs`; a job failing three times in a row logs at error
level with `alert: true` (route that to paging in the log platform).
`GET /api/v1/maintenance/jobs` (`audit:read`) shows per job the last run,
last success, last failure and error, consecutive failures and the alert
flag. Tests: `test/unit/maintenance.test.ts` (intervals, alert after three
failures and clearing on success), `test/integration/maintenance-jobs.test.ts`
(all 14 jobs run successfully as the system and are recorded, status route
and RBAC, pruning).

### Review follow-up (2026-10-03) — one instance per job, alerts to a person

- **Lease.** `maintenance_job_states` holds one row per job. Before a run,
  an instance takes the job's lease with a single
  `INSERT … ON CONFLICT … DO UPDATE … WHERE` in Postgres. The lease is
  granted only when no live lease exists and the job is due: its interval
  has passed since the last start on any instance, by the database clock.
  A job without its own interval runs once per sweep across all
  instances: it is spaced by 80% of the sweep interval.
  It is renewed every third of `MAINTENANCE_LEASE_SECONDS` while the job
  runs and released when the run is recorded. An instance that dies
  mid-run holds an expired lease with a holder still set, so the job runs
  again on another instance as soon as the lease expires, without waiting
  for its interval. A dead instance cannot renew or release a lease that
  someone else has taken over. `GET /maintenance/jobs` also shows
  `running` and `alertNotifiedAt`.
- **Alerts.** At three consecutive failures the job posts one `FAILING`
  alert to `MAINTENANCE_ALERT_WEBHOOK_URL`. The body is JSON:
  `{ text, kind, job, consecutiveFailures, error, environment, at }`.
  When the job next succeeds it posts one `RECOVERED` message. Delivery is
  recorded in `alertedAt`. An undelivered alert (non-2xx response or
  network error) is retried on the next failure, never lost or
  duplicated, even when the failures happen on different instances.
  Production refuses to start without a webhook unless
  `MAINTENANCE_ALERT_LOG_ONLY=true`.
- **Tests.** `test/unit/maintenance.test.ts` (7):
  - one alert per streak, recovery, a new streak;
  - delivery retried after the receiver was down;
  - message format.

  `test/integration/maintenance-jobs.test.ts` (10, real Postgres):
  - 12 instances racing for one lease, exactly one wins;
  - two instances sweeping at once run a slow job once and record one run;
  - two running schedulers run a per-sweep job once per sweep between
    them, never back to back (this test fails without the cross-instance
    spacing: 11 runs instead of at most 7);
  - the interval holds across instances;
  - a crashed instance's job is recovered after lease expiry, and the dead
    instance cannot renew or release the lease;
  - heartbeats keep a long job's lease past its length;
  - a real HTTP webhook receiver gets one alert per streak across two
    instances, the delivery is retried after a 503, and the recovery is
    posted.

  `test/unit/config-production-guards.test.ts`: production refuses to
  start without an alert destination.
- **Runtime check (2026-10-03, local).** Two real API processes ran on one
  database for 2.6 minutes. Every per-sweep job ran exactly once per
  minute (3 runs each, minimum gap 60.0 s, 0 failures); the 30 runs split
  13/17 between the instances, and no lease stayed held. One instance was
  then killed with SIGKILL. The survivor ran the next sweep's jobs (16
  runs, 0 failures) with no stuck lease.
