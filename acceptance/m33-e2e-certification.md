# M33 — Full End-to-End Certification Acceptance Criteria

**Spec(s):** all of the above
**Status:** BLOCKED — sequence-blocked; requires M00–M32 complete.

## Business acceptance

- [ ] Every flow in `acceptance/e2e-commerce-flows.md` (all 20 flows)
      passes as an automated, repeatable E2E test against a
      production-like environment.
- [ ] Every milestone's `acceptance/mNN-*.md` Definition of Done is
      independently re-verified as still passing together (integration
      regressions between milestones are a real risk this step exists
      to catch).

## Functional acceptance

- [ ] Cross-domain integrity holds under combined load: e.g., a
      concurrent mix of checkouts, cancellations, returns, and exchanges
      does not corrupt the inventory ledger, payment reconciliation, or
      loyalty/store-credit balances.

## Security

- [ ] A full security review pass (M31's suite) is re-run against the
      complete, integrated system.

## Performance

- [ ] M32's load-test suite is re-run against the complete, integrated
      system (not just the subset available when M32 first ran).

## Test requirements

- [ ] Full regression suite: unit + integration + E2E + security +
      load, all green, with no test disabled/skipped to achieve this
      (`TESTING.md` §4).

## Definition of Done

**This milestone is the platform's overall readiness certification.**
It is not achievable until every prior milestone is genuinely complete
— it does not "round up" partial completion elsewhere. Passing this
milestone is a prerequisite for any future production-deployment
authorization (`SECURITY.md`, `DEPLOYMENT.md` §4), which remains a
separate, explicit human decision regardless.
