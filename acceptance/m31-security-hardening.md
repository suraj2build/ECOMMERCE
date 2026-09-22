# M31 — Security Hardening Acceptance Criteria

**Spec(s):** `SECURITY.md` + cross-cutting across all specs
**Status:** READY_FOR_IMPLEMENTATION (continuous — applies incrementally
alongside every other milestone, formally validated here)

## Business acceptance

- [ ] No milestone's implementation weakened security to reduce
      implementation effort (spot-check against `SECURITY.md` and each
      spec's authorization/security requirements).

## Functional acceptance

- [ ] Dependency vulnerability scanning is active in CI.
- [ ] Server-side authorization is verified as authoritative across
      **every** role boundary in `acceptance/m29-admin-cms.md`'s
      matrix — this milestone re-runs and formally certifies that
      suite.
- [ ] Rate limiting is active on public storefront APIs, particularly
      OTP request/verify (`acceptance/m01-auth-rbac.md`) and checkout/
      payment endpoints.
- [ ] Secrets management is audited — no secrets in source control,
      history, logs, or error messages across the full built
      application (not just documentation, as verified in earlier
      milestones).

## Negative scenarios / edge cases

1. Simulated common OWASP-class attacks (injection, broken access
   control, etc.) against key endpoints (auth, checkout, payment,
   admin) are blocked.
2. A forged/tampered JWT is rejected.

## Test requirements

- [ ] Security-focused test suite (`TESTING.md` §1) covering
      authorization, injection, and session-handling classes of
      defect.
- [ ] Dependency audit report reviewed with no unresolved critical
      vulnerabilities.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
