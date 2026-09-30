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

Found by the first CI run of this repair (`bdefec9`) and by re-running
locally with CI's exact secrets:

- `mfa-secret-crypto.test.ts` built its "unversioned pre-repair"
  fixture with a hard-coded key that only matched the local test
  default; it now uses the configured key, as the pre-repair code did.
- Wishlist add-item (pre-existing M12 code) used an upsert with an empty
  update, which Prisma runs as read-then-insert: concurrent adds of the
  same SKU raced into a unique violation and a 500 (lifecycle test M, 4
  of 8 runs). It is now `INSERT ... ON CONFLICT DO NOTHING`
  (`createMany({ skipDuplicates: true })`), 10 of 10 runs green.
  Observed, not changed (outside this repair): cart add-item computes
  the new quantity from a read before its upsert, so concurrent adds of
  the same SKU can under-count quantity (no error, no duplicate row).

## Final independent-review delta repair (2026-09-30, review head `d0dad56`)

Two MFA upgrade-safety findings; guest-session, rate-limit, M30, M32 and
M33 untouched. Engineering evidence below; not self-certified.

- [x] **Backfill preflight.** It previously aborted only when every v1
      row failed to decrypt, so a mixed state (some valid, some not)
      still encrypted legacy rows. Now every existing encrypted value
      (v1 and the unversioned format) must authenticate-decrypt before
      any write; otherwise zero rows are modified, the CLI exits 1, and
      only a count and staff user ids are reported. Evidence:
      `test/integration/mfa-upgrade-safety.test.ts` tests 1/1b (mixed
      valid-v1 + corrupt-v1 + legacy; every `staff_users` row, including
      `updatedAt`, byte-identical afterwards; real CLI process exit 1),
      2/2b (wrong key), 3 (all-valid v1 + legacy migrates), 4 (rerun
      no-op); existing `mfa-upgrade.test.ts` G/H and I tightened to the
      same zero-write guarantee.
- [x] **Production startup gate.** Startup previously logged a warning
      and listened; a failed count was read as zero. `startServer`
      (the only path from `buildApp` to `listen`, used by `src/index.ts`)
      now refuses to listen in production while any non-v1 secret remains
      or when the check cannot run, logging the count only; it never runs
      the backfill. Development keeps a warning. Evidence: tests 5, 6, 7,
      the two development cases, and 8 (no seed or stored value in logs or
      errors). A full production process cannot boot in any environment
      yet (the existing production guard refuses the `MOCK` shipping
      provider, SHIP-001), so the gate is proven through `startServer`
      with a real app, database and `listen`.
- Mutation check: reintroducing the old preflight rule and the old
  warn-only startup makes 6 of these tests fail.
