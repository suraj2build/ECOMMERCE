# Authentication / Session Security Review (M31 Security Hardening, 5B)

## OTP brute force / resend abuse / rate limiting

**FIXED this pass** — previously unlimited. `POST /auth/customer/otp/request`
now rate-limited (5 per 15 minutes per mobile+IP) and
`POST /auth/customer/otp/verify` (10 per 15 minutes per mobile+IP) — see
`plugins/rate-limit.ts` and `auth/routes.ts`. The verify limit
specifically closes a loophole the pre-existing per-code
`OtpCode.maxAttempts` (5) alone did not: requesting a fresh OTP resets
that per-code counter, so without a request-volume limit an attacker
could brute-force the full 6-digit space across many freshly-requested
codes with no cap at all. Adversarially tested
(`test/integration/rate-limiting.test.ts`).

## Verification attempt limits

Pre-existing, re-verified correct: `AuthService.verifyCustomerOtp`
rejects once `otp.attempts >= otp.maxAttempts` (default 5) for a SINGLE
OTP code, and separately rejects an expired code
(`OTP_TTL_SECONDS`) — both proven by `auth-security.test.ts`'s existing
"locks out after the maximum attempt count" and "rejects an expired
OTP" tests, re-run green by this pass.

## Login rate limiting

**FIXED this pass** — previously unlimited.
`POST /auth/staff/login` now rate-limited (10 per 15 minutes per
email+IP), closing a genuine staff-password brute-force gap. Verified
the limit applies even when the FINAL attempt would have used the
correct password (`rate-limiting.test.ts`) — the throttle is on request
volume for the identity, not merely on repeated failures, so an
attacker cannot use a single "test the real password last" trick to
dodge it.

## Account enumeration

Pre-existing, re-verified: `AuthService.staffLogin` runs a bcrypt
compare against a fixed dummy hash even when the email does not exist,
so a nonexistent-account login and a wrong-password login return the
identical `401`/timing profile — explicit code comment and behavior
confirmed unchanged. Customer OTP request never reveals whether a
mobile number is already registered (`Customer` rows are
upserted only at VERIFY time, never checked for existence at REQUEST
time) — confirmed by reading `requestCustomerOtp`.

## Session fixation

**Structurally not possible in this design.** Neither the staff session
token nor the customer JWT/refresh token accepts a client-supplied
value at authentication time — `StaffSessionStore.create` always mints
a fresh `randomBytes(32)` token server-side, and
`AuthService.verifyCustomerOtp` always mints a fresh JWT + a fresh
`randomBytes(32)` refresh token server-side. There is no code path
where a pre-authentication request can influence what identifier gets
bound to the authenticated session afterward.

## Session rotation on role/permission change

**Confirmed already correct, not a gap.** `requireStaffAuth` calls
`resolveStaffPermissions(prisma, session.staffUserId)` fresh on EVERY
request — permissions are never cached inside the session token/Redis
payload itself (`StaffSessionPayload` carries only `{ staffUserId }`).
A permission revoked mid-session takes effect on the attacker's/staff
member's VERY NEXT request, with no stale-permission window at all —
actually stronger than "rotate the session on role change," which would
still leave a window between the role change and the rotation.

## Token/session expiry

- Staff session: `STAFF_SESSION_TTL_SECONDS` (8h default), enforced as
  a real Redis `EX` TTL — the key expires and stops resolving
  automatically, not merely a timestamp checked in application code.
- Customer access JWT: `JWT_ACCESS_TTL_SECONDS` (15 min default),
  enforced by `@fastify/jwt`'s own signature+expiry verification.
- Customer refresh token: `JWT_REFRESH_TTL_SECONDS` (30 days default),
  checked against `CustomerRefreshToken.expiresAt` on every refresh
  call.

## Logout invalidation

Pre-existing, re-verified: `AuthService.staffLogout` calls
`StaffSessionStore.revoke`, which deletes the Redis key AND marks the
persisted `StaffSession` row `revokedAt` — the session is genuinely
gone, not merely marked client-side (`auth.test.ts`'s "revokes a
session immediately on logout", re-run green). Customer logout
(`revokeCustomerRefreshToken`) sets `revokedAt` on the refresh token row
— `refreshCustomerToken` checks `revokedAt` and rejects, confirmed by
`auth-security.test.ts`'s "revokes a refresh token on logout" test. The
customer ACCESS JWT itself has no server-side revocation (see the
"known, accepted architectural gap" note in `security/RUNBOOKS.md` §7)
— an already-issued access token remains valid until its own short
expiry even after logout, an accepted trade-off given the 15-minute TTL.

## Replay

Covered structurally by the above: an OTP code is single-use
(`consumedAt` set on success, re-verified as `UnauthorizedError` on
replay — `auth-security.test.ts`'s "rejects replaying an already-
consumed OTP"), and MFA TOTP replay is rejected by `otplib`'s own
window-based replay protection (`auth-security.test.ts`'s "rejects
replaying the same TOTP code twice for login"). Both re-run green.

## Authorization after role changes

Covered above under "Session rotation on role/permission change" — a
role/permission change is live on the very next request, no separate
mechanism needed.

## Privileged staff access / MFA readiness

`MFA_REQUIRED_ROLES` (`@fcp/shared`) gates which roles must supply a
valid TOTP code to complete login once MFA is enrolled+confirmed — a
confirmed-MFA account cannot bypass it (`AuthService.staffLogin`'s own
explicit "cannot bypass" logic, unchanged by this pass). This pass's
own genuine finding: the MFA secret itself was stored in plaintext
despite a comment claiming otherwise — now AES-256-GCM encrypted (see
`security/PII_DATA_INVENTORY.md` and `modules/auth/mfa-secret-crypto.ts`).
No SMS/real MFA-provider implementation was invented — TOTP (app-based,
no external provider dependency) remains the only mechanism, consistent
with this pass's own explicit instruction not to build an SMS provider
integration solely for this milestone.
