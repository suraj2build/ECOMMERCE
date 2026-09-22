# 24. Marketing

**Status:** DRAFT

## Purpose

Define marketing communication capabilities: campaign management,
customer segmentation, and outbound messaging (email/SMS/push),
distinct from the notification transactional messages covered in
`29-notifications.md`.

## Scope

- Customer segmentation for marketing purposes
- Campaign creation and scheduling
- Marketing opt-in/opt-out preference handling (ties into
  `21-customer-profile.md`)
- Channel(s): email, SMS, push — exact scope not yet decided

## Key architectural constraints (approved)

None domain-specific yet. Must respect customer PII/consent handling
principles (`SECURITY.md` §4).

## Open questions — DECISION_REQUIRED

- Which marketing channels are in scope for initial build?
- Build vs. integrate: is marketing automation built natively or via a
  third-party integration (e.g., an ESP)? Not yet decided.
- Segmentation criteria and how they relate to `27-analytics-reporting.md`
  data.
- Consent/compliance requirements for the target market(s) — not yet
  specified.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on:
`MKT-001`, `CUST-002` (marketing preference granularity, consolidated
from this spec and `specs/21-customer-profile.md`).

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `21-customer-profile.md`, `23-promotions.md`. Related:
`25-social-channel-publishing.md` (paid/organic social is a distinct
but adjacent concern), `29-notifications.md` (transactional vs.
marketing messaging boundary should be kept clear).
