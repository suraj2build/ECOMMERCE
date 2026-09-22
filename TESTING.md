# Testing Strategy

**Status:** APPROVED (strategy baseline) — concrete test suites do not
exist yet because there is no application code (see `BUILD_PLAN.md`).

This document defines the testing approach that will apply once
implementation begins. It is a contract, not aspirational text: work
that does not satisfy it does not satisfy the Definition of Done
(`acceptance/README.md`).

## 1. Test levels

| Level | Purpose | Tooling (approved baseline) |
|---|---|---|
| Unit tests | Business logic in isolation (pricing, inventory ledger math, order state transitions, etc.) | Node.js/TypeScript test runner (choice deferred to M00 implementation ADR) |
| Integration tests | Module/service boundaries, database interactions, Medusa v2 integration points | Same runner + test database via Docker Compose |
| End-to-end (E2E) / browser tests | Real user flows through the storefront and admin UI | Playwright |
| Security / authorization tests | RBAC enforcement, tenant/data isolation, auth boundaries, common OWASP-class checks | Playwright + targeted authorization test suites |

## 2. What must be tested per domain

For every domain with financial or state-integrity consequences —
inventory, payment, order, loyalty — tests must cover:

- The happy path.
- Negative / error scenarios (invalid input, insufficient stock,
  payment failure, unauthorized access).
- Integrity of the underlying ledger/state machine (e.g., an inventory
  reservation that fails must not leave stock in an inconsistent
  state; a payment retry must not double-charge).
- Idempotency where relevant (webhooks, retries).

## 3. Viewport / device coverage (storefront)

E2E tests for customer-facing flows must pass on:

- Mobile viewport (platform is mobile-first)
- Desktop viewport

## 4. Non-negotiable rules

- **No test may be disabled, skipped, or deleted merely to obtain a
  green build.** If a test is wrong, fix the test with a clear
  rationale in the commit message; if the code is wrong, fix the code.
- A milestone is not "tested" because *some* tests exist — coverage
  must map to the domain's approved acceptance criteria
  (`acceptance/README.md`).
- Flaky tests are a defect to be root-caused, not silenced.

## 5. CI

GitHub Actions runs lint, type-checking, unit tests, integration
tests, and (where applicable) Playwright E2E on every pull request
once the pipeline exists (to be created as part of M00 once
unblocked). CI configuration itself is a normal, reversible,
non-production change and does not require special approval beyond
normal review — but it must never be modified merely to force a green
status (e.g., disabling a failing check).

## 6. Local test execution

Once implementation begins, this section will be updated with the
exact commands (`docs/architecture/` or a root `Makefile`/`package.json`
scripts) to run each test level locally via the Docker Compose
environment described in `DEPLOYMENT.md`.
