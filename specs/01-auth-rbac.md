# 01. Authentication / RBAC

**Status:** DRAFT

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

- Authorization must be enforced on every endpoint touching customer,
  order, payment, or inventory data — not only at the UI layer
  (`SECURITY.md` §4).
- Secrets/credentials are never committed (`SECURITY.md` §3).

## Open questions — DECISION_REQUIRED

- What roles exist beyond "customer" and "admin"? (e.g., warehouse
  staff, merchandiser, customer service, finance, supplier-facing
  role?) Exact role list and permission matrix not yet defined.
- Authentication method(s): email/password, OTP, social login,
  passkeys? Not yet decided.
- Multi-factor authentication requirements for staff/admin roles?
- Session/token strategy (e.g., JWT vs. server session) — implementation
  detail, but should be recorded here once decided since it affects
  every other domain's integration.
- Does Medusa v2's built-in auth/customer model cover storefront
  customer auth sufficiently, or is a custom layer needed for staff
  roles beyond Medusa's admin users? Needs evaluation once
  implementation starts.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`AUTH-001`, `AUTH-002`, `AUTH-003`, `ADM-001`. See also
`blueprint/OPERATING_ROLES.md` for candidate role definitions feeding
`ADM-001`.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first. See
`acceptance/README.md` for the Definition of Done process that will
apply once this spec is approved and implementation begins.

## Dependencies

Foundational — most other domains depend on this spec's RBAC model for
their own authorization rules.
