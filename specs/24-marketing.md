# 24. Marketing

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `MKT-001`, `CUST-002`)

## Purpose

Define marketing communication capabilities: campaign management,
customer segmentation, and outbound messaging, distinct from
transactional notifications (`specs/29-notifications.md`).

## Scope

- Customer segmentation for marketing purposes
- Campaign creation and scheduling
- Marketing opt-in/opt-out preference handling

## Approved requirements (2026-09-22)

- Marketing messaging architecture **MUST support SMS, WhatsApp,
  Email, and Push** via a provider abstraction, shared with
  `specs/29-notifications.md`'s transactional-messaging architecture —
  the platform MUST NOT couple order/marketing logic directly to one
  messaging provider.
- Actual provider/channel activation at launch is configurable,
  deferred to operational decision.
- Marketing preference granularity is **per-channel and per-message-
  type** (`specs/21-customer-profile.md` `CUST-002`), not a single
  global toggle.

## Remaining open items

None. Provider selection is deferred operational configuration, not a
blocking decision.

## Acceptance criteria

See `acceptance/m25-marketing.md`.

## Dependencies

Depends on: `specs/21-customer-profile.md`, `specs/23-promotions.md`.
Related: `specs/25-social-channel-publishing.md`, `specs/29-notifications.md`.
