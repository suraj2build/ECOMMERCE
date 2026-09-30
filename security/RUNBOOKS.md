# Security Operations Runbooks (M31 Security Hardening, 5K)

**Status:** ENGINEERING DOCUMENTATION ONLY. Writing a runbook is not the
same as proving operational readiness — none of these procedures has
been exercised against a real production incident, and several steps
depend on infrastructure (a real hosting provider, a real on-call
rotation, a real secrets manager) that does not exist yet outside this
codebase. Treat this as a first draft for whoever operates a real
deployment, not a certification that incident response is "ready."

## 1. Incident response — general

1. **Identify scope**: which system (storefront/admin/API/DB/Redis/
   Meilisearch/a specific provider) and which data category
   (`security/PII_DATA_INVENTORY.md`) is affected.
2. **Contain**: for an API-level compromise, the fastest containment is
   revoking the specific credential/session implicated (§5/§6 below),
   not a full service shutdown, unless the compromise is at the
   infrastructure layer itself.
3. **Preserve evidence**: `AuditLog` (`specs/30-audit-compliance.md`)
   and `PaymentEvent` are append-only application-level records — do not
   delete or "clean up" rows during an active investigation, even ones
   that look related to the incident.
4. **Notify**: this document does not define WHO to notify or within
   what timeframe — that is a `CUST-001`/`AUD-002`-adjacent legal
   question (breach-notification obligations), not an engineering
   decision, and remains open.

## 2. Suspected staff credential compromise

1. Deactivate the account immediately: `StaffUser.isActive = false` —
   this codebase's OWN certified behavior (`auth-security.test.ts`,
   "invalidates an already-active session the moment the staff account
   is deactivated") means every existing session for that account is
   rejected on its very next request, with no separate revocation step
   needed. For belt-and-braces instant revocation without waiting on the
   next-request check, call `StaffSessionStore.revokeAllForUser(staffUserId)`
   directly — it deletes every active Redis session key for that account
   in one call (`modules/auth/staff-session.ts`), the same mechanism a
   staff-offboarding flow would use.
2. Force MFA re-enrollment on reactivation: reset `mfaSecret` to `null`,
   `mfaEnabled` to `false` before reactivating — the next login will
   require a fresh `/mfa/enroll`.
3. Review `AuditLog` filtered by `actorStaffId` for the suspected window
   to establish what the credential was used for while compromised.
4. If the account holds a role in `MFA_REQUIRED_ROLES` and MFA was
   somehow bypassed, that is itself a P0 finding requiring immediate
   escalation — MFA bypass should be structurally impossible per
   `AuthService.staffLogin`'s own logic, so its occurrence indicates a
   deeper issue, not routine account hygiene.

## 3. Suspected customer account compromise

1. Revoke every refresh token for the customer:
   `UPDATE customer_refresh_tokens SET "revokedAt" = now() WHERE "customerId" = $1 AND "revokedAt" IS NULL`
   — forces re-authentication (a fresh OTP) on next use; existing
   short-lived access JWTs remain valid until their own expiry
   (`JWT_ACCESS_TTL_SECONDS`, 15 minutes by default) since this
   codebase's customer auth has no server-side access-token revocation
   list (an accepted architecture — see §7's note on this exact gap).
2. Review orders/addresses/gift-card purchases created in the suspected
   window for signs of fraudulent use.
3. If a gift card was issued or redeemed during the window, treat it as
   potentially compromised — disable it (`POST /gift-cards/:id/disable`)
   pending investigation; its own audit trail
   (`GiftCardLedgerEntry`) is immutable, never edit it retroactively.

## 4. Suspected payment-provider (Razorpay) compromise

1. Rotate `RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` from the
   Razorpay dashboard immediately, then update the deployment's secret
   store and restart the API — every webhook signed with the OLD secret
   will correctly start failing verification the moment the new secret
   is live (`RazorpayPaymentProvider.verifyWebhookSignature` re-reads
   config on every call, no caching to invalidate).
2. Review `PaymentEvent` rows with `status = 'FAILED'` or
   `processingError IS NOT NULL` around the incident window for
   anomalies.
3. This application never holds raw card data (see
   `security/PAYMENT_SECURITY_REVIEW.md`), so a Razorpay-side compromise
   cannot expose card data THROUGH this system — the exposure surface
   here is limited to order/contact metadata already covered by §7.

## 5. Data exposure (a table/export believed leaked)

1. Cross-reference the exposed table against
   `security/PII_DATA_INVENTORY.md` to establish exactly which data
   categories were exposed.
2. If a HASHED value (OTP, refresh token, gift-card code) was exposed,
   the hash alone does not grant an attacker the ability to use the
   credential — no rotation of the hashing scheme itself is required,
   though affected individual credentials should still be treated as
   compromised.
3. If `StaffUser.mfaSecret` rows were exposed, this IS a live risk even
   after this pass's AES-256-GCM encryption fix — an attacker who also
   has `MFA_SECRET_ENCRYPTION_KEY` can decrypt and generate valid codes.
   Rotate `MFA_SECRET_ENCRYPTION_KEY` and force every staff account to
   re-enroll MFA (§2 step 2, applied to every affected account, not just
   one). After rotation, existing v1 values no longer decrypt: logins
   fail closed (401 + `staff.mfa.secret_unreadable` audit, reason
   `decrypt_failed`) rather than falling back, and the backfill refuses to
   run against rows it cannot decrypt - re-enrollment, not the backfill,
   is the recovery path.
4. Formal breach-notification obligations are outside this document's
   scope (see §1.4).

## 6. Emergency session revocation

- **All staff sessions, immediately**: `StaffSessionStore` is
  Redis-backed and keyed per-token — `redis-cli --scan --pattern
  'staff-session:*' | xargs redis-cli del` revokes every active staff
  session at once (an emergency-only blunt instrument; every staff
  member is logged out and must re-authenticate).
- **One staff account**: `StaffUser.isActive = false` (see §2).
- **One customer account**: revoke refresh tokens (see §3) — note the
  access-JWT caveat there.
- **All guest-session tokens**: stateless (self-verifying HMAC, no
  DB/Redis row), so not individually revocable. Each token expires on
  its own after `GUEST_SESSION_TTL_SECONDS` (default 30 days; lowering it
  immediately invalidates longer-lived tokens already issued). To revoke
  every guest token at once, rotate `GUEST_SESSION_SIGNING_SECRET` - a
  dedicated secret since the M31 certification repair, so this no longer
  touches customer JWTs. Guests then obtain a new session; carts, orders
  and store credit under the old owner ids stay in the database but are
  no longer reachable from the old tokens.

## 7. Known, accepted architectural gaps (not fixed by this pass)

- **No server-side customer access-JWT revocation list.** A stolen
  access JWT remains valid until its own 15-minute expiry even after
  the corresponding refresh token is revoked. Accepted trade-off:
  short TTL bounds the exposure window; adding a revocation list would
  mean a Redis lookup on every authenticated customer request, a
  real latency/availability trade-off not undertaken speculatively in
  this pass.
- **`RazorpayPaymentProvider`'s error log uses `console.error`, not the
  structured pino logger** — see `security/PAYMENT_SECURITY_REVIEW.md`
  for why this was documented rather than fixed here.
- **No centralized alerting** — `security/OBSERVABILITY.md` (M33)
  covers what metrics/log signals exist; wiring them to a real alerting
  system is infrastructure that does not exist in this environment.

## 8. Backup restoration

See `security/BACKUP_RESTORE.md` (M33) for the PostgreSQL backup/
restore procedure and its own honestly-scoped exercised-vs-documented
distinction.
