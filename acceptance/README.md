# Acceptance / Definition of Done

**Status:** APPROVED (process baseline) — no milestone has reached this
stage yet; see `BUILD_PLAN.md`.

This document defines when an implementation milestone may be
considered **DONE**. Code existing is not sufficient. This checklist
applies to every milestone in `BUILD_PLAN.md` once implementation is
authorized, and to every spec's transition from `IMPLEMENTING` to
`IMPLEMENTED` (see `CLAUDE.md` §3).

## Definition of Done checklist

A milestone/feature is **DONE** only when **all** applicable items
below are satisfied:

- [ ] The relevant spec(s) in `/specs` are `APPROVED` (not `DRAFT` or
      `UNDER_REVIEW`)
- [ ] Acceptance criteria specific to the spec (added to that spec once
      approved) are implemented
- [ ] Lint passes
- [ ] TypeScript/type checking passes
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Build succeeds
- [ ] Application starts (locally, via the Docker Compose environment —
      see `DEPLOYMENT.md`)
- [ ] Database migrations succeed (apply cleanly to a fresh database)
- [ ] Browser E2E (Playwright) passes for the affected flows
- [ ] Mobile viewport passes (storefront is mobile-first —
      `ARCHITECTURE.md` §2)
- [ ] Desktop viewport passes
- [ ] Authorization tests pass (RBAC enforcement per
      `specs/01-auth-rbac.md` and `SECURITY.md` §4)
- [ ] Negative / error scenarios are tested, not just the happy path
- [ ] Where the change touches inventory, payment, or order state:
      integrity of the relevant ledger/state machine is explicitly
      verified (see `TESTING.md` §2) — e.g., no overselling, no
      double-charge, no lost/duplicated ledger entries
- [ ] No tests were disabled, skipped, or deleted merely to obtain a
      green result (`TESTING.md` §4)
- [ ] Documentation is updated: the relevant spec's status is advanced
      appropriately, `BUILD_PLAN.md` status is updated, and any new
      architectural decision has an ADR
- [ ] No secrets are committed (`SECURITY.md` §3)

## Who marks what

- The implementing engineering agent may set a spec's status to
  `IMPLEMENTING` (on start) and `IMPLEMENTED` (once every applicable
  box above is checked).
- `VERIFIED` is set only after independent/human verification — never
  by the same agent that implemented the feature. This is a
  deliberate check against self-certification.

## Milestone-level vs. feature-level

Individual features/PRs within a milestone should satisfy this
checklist for their own scope. A milestone as a whole
(`BUILD_PLAN.md`) is DONE only when every feature within it is DONE
and the milestone's spec(s) are fully implemented — partial completion
must be reflected honestly in `BUILD_PLAN.md`, not rounded up.

## Relationship to the future autonomous development loop

This checklist is the "TEST" / "REVIEW" gate in the loop documented in
`CLAUDE.md` §5:

```
READ APPROVED SPEC -> REVIEW ACCEPTANCE CRITERIA -> PLAN -> IMPLEMENT
  -> RUN -> TEST -> DIAGNOSE FAILURES -> FIX -> RETEST -> REVIEW
  -> COMMIT -> UPDATE BUILD STATUS -> NEXT APPROVED MILESTONE
```

A milestone does not advance past "REVIEW" in that loop until this
checklist is fully satisfied.

## Per-milestone acceptance criteria (added 2026-09-22)

Following the Product Owner's Blueprint V2 decision session, every
milestone in `BUILD_PLAN.md` (M00–M33) now has a dedicated
`acceptance/mNN-*.md` document with testable, milestone-specific
criteria — business acceptance, functional acceptance, data integrity,
authorization, auditability, positive/negative scenarios, mobile/
desktop behavior where relevant, API/database behavior, concurrency/
idempotency where relevant, security, performance expectations,
observability, and test requirements. These documents apply this
checklist concretely per milestone; they do not replace it.

See `acceptance/e2e-commerce-flows.md` for the 20 cross-domain
automated E2E scenarios referenced throughout the per-milestone
documents.
