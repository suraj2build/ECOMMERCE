# M01 — Authentication / RBAC Acceptance Criteria

**Spec(s):** `specs/01-auth-rbac.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Mobile OTP is available and functions as the **primary**
      customer authentication path (`AUTH-001`).
- [ ] A customer can complete a purchase **without creating an
      account** — guest checkout is genuinely optional, never forced
      (`CHK-001`, verified here at the auth layer: no endpoint in the
      guest checkout path requires a session token).
- [ ] The approved RBAC role set (Super Admin, Business Admin, Buying,
      Merchandising, Catalog, Warehouse Manager, Warehouse Operator,
      Customer Service, Marketing, Finance, Analytics) exists with a
      defined permission matrix (`ADM-001`).

## Functional acceptance

- [ ] Customer OTP request → OTP delivery → OTP verification →
      session issuance flow works end-to-end.
- [ ] Email is accepted as optional/supporting identity data, never
      required to authenticate.
- [ ] Staff login (password) works; MFA is **enforced** for Super
      Admin, Business Admin, Finance, and any role granted approval
      permissions (`AUTH-002`); MFA is available but optional for
      execution-only roles.
- [ ] Customer session: short-lived JWT access token + refresh token.
      Staff session: server-side, Redis-backed, instantly revocable.

## Authorization

- [ ] Every authenticated endpoint verifies the caller's role against
      the required permission **server-side** — UI hiding a button is
      never sufficient on its own.
- [ ] A staff session can be revoked by a Super Admin and the
      revoked user's next API call is rejected within one request
      (proves instant revocation for the Redis-backed session model).

## Auditability

- [ ] Every role/permission change (grant, revoke, role reassignment)
      is recorded with who/what/when/old value/new value.
- [ ] Every MFA enrollment/disablement event is audited.

## Positive scenarios

1. Guest completes OTP-free checkout (no account, contact info
   captured for order processing/communication).
2. Customer requests OTP, verifies, receives a valid session, and
   accesses their (empty, new) order history.
3. A Finance-role staff member logs in with password + MFA and reaches
   a Finance-scoped screen.
4. A Warehouse Operator logs in with password only (MFA optional) and
   reaches only Warehouse Operator-scoped screens.

## Negative scenarios / edge cases

1. Incorrect OTP → rejected, retry allowed, rate-limited after N
   attempts (ties to `NFR-006`).
2. Expired OTP → rejected with a clear "resend" path.
3. A Warehouse Operator attempts to access a Finance-only screen/API →
   403, and UI does not render the option — **verify via direct API
   call, not just UI**, that server-side authorization blocks it (FLOW
   19 in `acceptance/e2e-commerce-flows.md`).
4. A Super Admin attempts to log in without MFA configured → forced
   into MFA enrollment before proceeding (cannot bypass).
5. A revoked staff session's bearer token is replayed → rejected.

## Mobile / Desktop behavior

- [ ] OTP entry flow is usable and accessible on a mobile viewport
      (numeric keypad affordance, resend visibly available) and on
      desktop.

## API behavior

- [ ] Auth endpoints return consistent, documented error shapes for
      invalid/expired credentials (not raw stack traces).

## Database behavior

- [ ] Role/permission assignments are relational (not embedded JSON
      blobs that resist querying for audit purposes).

## Security

- [ ] Passwords (where used, staff) are hashed with a modern,
      salted algorithm — never stored or logged in plaintext.
- [ ] OTPs are never logged in plaintext in any environment.
- [ ] Rate limiting applies to OTP request and verification endpoints.

## Performance expectations

- [ ] OTP verification API responds within the `NFR-001` checkout-API
      latency target class.

## Observability

- [ ] Failed authentication attempts (customer and staff) are logged
      with enough context to detect abuse patterns, without logging
      the credential itself.

## Test requirements

- [ ] Unit tests: OTP generation/validation logic, RBAC permission
      resolution.
- [ ] Integration tests: full OTP login flow, staff MFA flow, session
      revocation.
- [ ] Authorization tests (`acceptance/e2e-commerce-flows.md` FLOW 19):
      every role boundary in the matrix is tested for both allowed and
      denied access, server-side.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
