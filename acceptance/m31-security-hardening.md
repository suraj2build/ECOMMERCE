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

## Independent-review certification repair (2026-09-30)

Three findings against review head `7f769ef`, each reproduced from source
first. Engineering evidence below; not self-certified.

- [x] **MFA upgrade compatibility.** Pre-M31 plaintext seeds no longer
      cause a 500; the reader accepts only the versioned v1 format and
      fails closed (401 + reason-only audit) with no plaintext fallback;
      an explicit, idempotent, compare-and-swap backfill upgrades legacy
      rows (DEPLOYMENT.md ordering). Evidence:
      `test/integration/mfa-upgrade.test.ts` (A-L incl. concurrency and
      log/audit/response/CLI leak checks), `test/unit/mfa-secret-crypto.test.ts`,
      and an end-to-end run of the real pre-M31 code (`7f59f6a`) enrolling
      MFA, then migrations, backfill, and a successful login on the
      repaired code.
- [x] **CART-004 guest-session lifecycle.** Versioned, authenticated
      `gs1` token with issued-at/expiry, dedicated signing secret,
      server-enforced TTL, owner-preserving renewal, verified merge
      routes, unsigned mode impossible in production, storefront
      renewal. Evidence: `test/unit/cart-identity.test.ts`,
      `test/integration/guest-session-lifecycle.test.ts` (A-P, deterministic
      clock), `test/unit/config-production-guards.test.ts`.
- [x] **Rate-limit keying.** Only verified identities get their own
      bucket; unverifiable credentials share the IP bucket; IP resolved
      through `TRUST_PROXY_HOPS` trusted hops. Evidence:
      `test/integration/rate-limit-identity.test.ts` (fails against the
      pre-repair key generator); existing `rate-limiting.test.ts` (OTP,
      staff login) unchanged and green.

Found during this repair's own full-suite validation, root-caused, and
fixed without weakening any assertion:

- `mfa-upgrade.test.ts` - the server verifies TOTP for the current 30s
  step only (otplib `window: 0`, unchanged M01 behaviour), so a code
  generated just before a step rollover and checked after a slow
  password hash was refused. Each test now freezes `Date` mid-step. The
  leak check's log capture now runs with per-request logging on
  (`BuildAppOptions.requestLogging`, test seam only), since request
  logging is otherwise off under `NODE_ENV=test` and the auth path
  emits no other log lines.
- `shipping.test.ts` (pre-existing M17 test, no product change) - the
  split-shipment test signed one `trackingEvent(..., new Date())` body
  and posted a second, separately built one; a millisecond tick between
  the two made the signature invalid and the event was dropped. Each
  body is now built once, and webhook acceptance is asserted.
