# 21. Customer Profile (Customer 360)

**Status:** DRAFT

## Purpose

Define the customer's account experience: profile data, address book,
order history, and a unified ("360") view of the customer relationship
across orders, loyalty, and support interactions.

## Scope

- Customer profile data (identity, contact, preferences)
- Address book management
- Order history and status visibility (reads from
  `14-order-management.md`, `16-shipping-tracking.md`)
- Loyalty balance visibility (reads from `22-loyalty.md`)
- Data privacy/PII handling posture

## Key architectural constraints (approved)

- Customer PII must be isolated appropriately and minimized in logs;
  every endpoint touching customer data must enforce authorization
  (`SECURITY.md` §4).

## Open questions — DECISION_REQUIRED

- Data retention and deletion policy (e.g., account deletion requests)
  — not yet defined; likely has regulatory implications depending on
  target market, needs product-owner input.
- Preference center scope (marketing opt-in/out granularity) — ties
  into `24-marketing.md`, not yet defined.
- Is there a unified "Customer 360" internal admin view distinct from
  the customer's own self-service profile? Scope for `28-admin.md`
  overlap not yet clarified.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `01-auth-rbac.md`, `14-order-management.md`,
`22-loyalty.md`. Feeds: `24-marketing.md`, `28-admin.md`.
