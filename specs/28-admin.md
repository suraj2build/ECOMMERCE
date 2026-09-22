# 28. Administration

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `ADM-001`–`003`)

## Purpose

Define the internal admin/operations experience, including
admin-controlled content management (CMS).

## Scope

- Admin application structure
- Per-domain admin screens
- Admin RBAC
- Audit trail for admin actions
- Content Management (CMS)

## Approved requirements (2026-09-22)

### RBAC (finalized per Product Owner delegation, §25)

- Approved role set: **Super Admin, Business Admin, Buying,
  Merchandising, Catalog, Warehouse Manager, Warehouse Operator,
  Customer Service, Marketing, Finance, Analytics** — see
  `blueprint/OPERATING_ROLES.md` for full per-role responsibilities,
  screens, permissions, high-risk actions, and approval requirements.
- Sensitive operations — **large/exceptional discounts, manual
  inventory adjustments, exceptional refunds, high-risk financial
  actions, role/permission changes** — MUST require elevated
  authorization via configurable approval/permission controls, not
  merely screen access.
- All role/permission changes MUST be audited.

### Application structure

- One admin application (separate from the customer storefront app),
  with role-gated routes internally.

### Manual inventory adjustment (`ADM-003`)

- Restricted to Warehouse Manager and above; Finance co-approval for
  high-value adjustments; mandatory justification field; fully audited
  (who/what/when/old value/new value/reference).

### Content Management (CMS)

- Admin-controlled content **is required**, supporting at minimum:
  homepage banners, collections, campaign landing pages, navigation/
  menus, and content blocks.
- The content architecture MUST support routine merchandising changes
  **without requiring a code deployment**.

### Internal Customer 360 view

- A distinct, data-minimized Customer-Service-facing Customer 360 view
  lives here, separate from the customer's own self-service profile
  (`specs/21-customer-profile.md` `CUST-003`).

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m29-admin-cms.md`. See
`acceptance/e2e-commerce-flows.md` FLOW 19 (unauthorized admin action
blocked) and FLOW 20 (inventory adjustment audited).

## Dependencies

Depends on: `specs/01-auth-rbac.md` and effectively every other domain
spec. Feeds: `specs/27-analytics-reporting.md`, `specs/30-audit-compliance.md`.
