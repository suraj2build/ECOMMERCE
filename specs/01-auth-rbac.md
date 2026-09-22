# 01. Authentication / RBAC

**Status:** IMPLEMENTED (Phase 1 build, 2026-09-22 — was APPROVED, decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `AUTH-001`–`003`, `ADM-001`)

## Purpose

Define how users (customers, staff, admins) authenticate, and how
role-based access control (RBAC) governs what each identity may do
across the storefront and internal/admin surfaces.

## Scope

- Customer authentication (storefront)
- Staff/admin authentication (internal tools, warehouse, merchandising,
  customer service, etc.)
- Role and permission model
- Session management
- Password/credential policy
- Integration points: every other domain's endpoints depend on this
  for authorization enforcement (see `SECURITY.md` §4)

## Key architectural constraints (approved)

- Authorization MUST be enforced on every endpoint touching customer,
  order, payment, or inventory data — not only at the UI layer
  (`SECURITY.md` §4). **UI hiding alone is never considered security**
  — server-side authorization is authoritative.
- Secrets/credentials MUST NOT be committed (`SECURITY.md` §3).

## Approved requirements (2026-09-22)

### Customer authentication

- **Mobile OTP MUST be the primary customer authentication method.**
  Email is optional/supporting, never the sole primary path.
- **Guest checkout MUST be supported and MUST be genuinely guest** —
  the system MUST NOT force account creation before purchase (see
  `specs/12-checkout.md` `CHK-001`).
- The platform MUST capture appropriate contact information (mobile,
  and email where provided) for order processing and transactional
  communication regardless of whether the customer has a full account.
- After purchase, the customer MAY be invited to activate/access a
  full account; this MUST remain optional.

### Staff/admin authentication

- Staff/admin authentication MUST use password + **mandatory MFA for
  every role with elevated/approval authority** (Super Admin, Business
  Admin, Finance, and any role granted approval permissions under the
  RBAC matrix below). MFA MUST be available (recommended, not forced)
  for execution-only roles.
- The platform MUST NOT weaken staff authentication security to reduce
  implementation effort (`SECURITY.md`, Product Owner instruction §11).

### Session strategy

- Customer sessions: short-lived JWT access token + refresh token
  (engineering default, chosen for stateless scalability).
- Staff/admin sessions: server-side, instantly-revocable session
  (Redis-backed), chosen so an offboarded or compromised staff account
  can be revoked immediately.

### RBAC role list & permission matrix

The following role set is **approved** (finalized by the Principal
Engineering Agent per explicit Product Owner delegation, §25 of the
2026-09-22 decision session — see `blueprint/OPERATING_ROLES.md` for
full responsibilities/screens/permissions per role, and
`specs/28-admin.md` for the admin-surface consumption of this matrix):

**Super Admin, Business Admin, Buying, Merchandising, Catalog,
Warehouse Manager, Warehouse Operator, Customer Service, Marketing,
Finance, Analytics.**

- Sensitive operations — large/exceptional discounts, manual inventory
  adjustments, exceptional refunds, high-risk financial actions,
  role/permission changes — MUST require elevated authorization (a
  role explicitly granted that permission, or a configurable
  second-approver threshold), not merely the ability to reach the
  relevant screen.
- Every role/permission change MUST be audited (`specs/30-audit-compliance.md`).
- This role list and matrix MAY be revised by the Product Owner at any
  time — it is a documented default, not a frozen commitment, but it is
  sufficient to build against now.

## Remaining open items

None. All decisions within this spec's scope were resolved on
2026-09-22.

## Acceptance criteria

See `acceptance/m01-auth-rbac.md` for the full testable Definition of
Done for this milestone.

## Dependencies

Foundational — most other domains depend on this spec's RBAC model for
their own authorization rules.
