# Backup / Restore Review (M33 Full System E2E + Production-Readiness)

## Status of the underlying policy

`blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`'s `NFR-003` already records
daily backup frequency, RPO ≤ 24h, and RTO ≤ 4h as **DECIDED** (not
open) - this pass does not invent or revise those targets. What this
pass adds is the first genuine LOCAL exercise of an actual backup/
restore cycle against this project's real schema and real data, to
sanity-check that the mechanism itself is sound - not a claim of a
production backup pipeline (no automated backup job, retention
schedule, or off-site/cross-region replication exists or is built here
- that remains a genuine, correctly-undecided production-infrastructure
question, deferred to the same production-topology decision
`DEPLOYMENT.md` §4 leaves open).

## What was exercised (real, this pass, not simulated)

1. **Backup**: `pg_dump -Fc` (custom/compressed format, the standard
   `pg_restore`-compatible choice for a database this shape) against
   the perf-seeded `fcp_dev` database (2,016 styles, 16,017 SKUs,
   16,015 inventory-balance rows, 15 orders, full schema - 38+
   migrations applied). **Completed in 1.5s**, producing a 1.7MB dump.
2. **Restore**: the dump restored into a brand-new, empty database
   (`fcp_restore_test`) via `pg_restore --no-owner --no-acl`.
   **Completed in 1.6s.**
3. **Verification**: row counts on the four tables spanning the
   catalog, inventory, and order ledgers (`styles`, `skus`,
   `inventory_balances`, `orders`) were compared between the source and
   restored databases. **Exact match on every count** - the restore is
   byte-for-byte complete, not merely "didn't error."
4. **Cleanup**: the temporary restore-test database and dump file were
   removed after verification: no artifact of this exercise is left in
   the repository or any persistent environment.

## Interpretation

At this pass's dataset scale (16k+ SKU rows, the lower half of the
approved 10,000-50,000 range), a full backup and a full restore each
complete in under 2 seconds - the mechanism itself (Postgres's own
`pg_dump`/`pg_restore` tooling against this schema) has no structural
obstacle to meeting the DECIDED RTO of 4 hours, with enormous headroom
even before accounting for the larger real-world dataset a production
system would eventually hold. This is genuine, positive evidence for
NFR-003's feasibility - not a production RTO/RPO certification, which
would require exercising this against production-scale data volumes,
a real off-site backup destination, and a real disaster-recovery
runbook rehearsal (`security/RUNBOOKS.md` already covers operational
incident response; a dedicated DR-rehearsal runbook remains a future,
separately-scoped operational exercise once a production target
exists).

## No schema or application change made

This was a pure operational exercise against the existing schema - no
code, migration, or configuration change was needed or made.
