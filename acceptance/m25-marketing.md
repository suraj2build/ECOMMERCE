# M25 — Marketing Acceptance Criteria

**Spec(s):** `specs/24-marketing.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Messaging architecture supports SMS, WhatsApp, Email, and Push
      via a provider abstraction — no marketing code calls a specific
      provider's API directly.
- [ ] Customer marketing preferences (per-channel, per-message-type)
      are respected — a customer opted out of a channel never receives
      a marketing message on that channel.

## Functional acceptance

- [ ] Segmentation queries work against customer/order data without
      exposing raw PII beyond what's needed for targeting.
- [ ] Campaign scheduling works (create, schedule, send at configured
      time).

## Negative scenarios / edge cases

1. Customer opts out of Email marketing but not SMS → subsequent Email
   campaigns exclude them; SMS campaigns still include them.

## Security / Privacy

- [ ] Segmentation/campaign tooling does not expose full customer PII
      unnecessarily to the Marketing role (data minimization).

## Test requirements

- [ ] Integration test: opt-out correctly excludes a customer from the
      relevant channel's next campaign send.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
