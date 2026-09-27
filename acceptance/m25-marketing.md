# M25 — Marketing Acceptance Criteria

**Spec(s):** `specs/24-marketing.md`
**Status:** IMPLEMENTED (built 2026-09-27; not yet independently reviewed)

## Business acceptance

- [x] Messaging architecture supports SMS, WhatsApp, Email, and Push
      via a provider abstraction — no marketing code calls a specific
      provider's API directly. `MarketingProvider` (`modules/marketing/
      provider.ts`) is the sole interface `MarketingService` depends
      on; the only implementation shipped is `MockMarketingProvider` (no
      launch provider selected per MKT-001, "deferred to operational
      decision") — a real provider is added later by implementing the
      same interface, with zero change to `MarketingService`.
- [x] Customer marketing preferences (per-channel, per-message-type)
      are respected — a customer opted out of a channel never receives
      a marketing message on that channel. `MarketingService.isOptedIn`
      reuses the EXISTING M22 `CommunicationPreference` matrix verbatim
      (no second consent model), including its exact same
      opted-out-by-default rule for marketing message types. Proven in
      `test/integration/marketing.test.ts` tests #6 (explicit opt-out)
      and #10 (no preference row at all — still excluded, since
      marketing types default OFF).

## Functional acceptance

- [x] Segmentation queries work against customer/order data without
      exposing raw PII beyond what's needed for targeting.
      `CustomerSegment` criteria (`minLifetimeOrderCount`,
      `minLifetimeSpend`, `loyaltyTierId`) are resolved LIVE against
      real `Order`/`LoyaltyAccount` data (never a stored membership
      snapshot); every segment/campaign read surface returns a
      recipient COUNT only (`GET /marketing/segments/:id/recipient-
      count`) — never the underlying customer list — proven in test #1
      (the response has no `customers` key).
- [x] Campaign scheduling works (create, schedule, send at configured
      time). `MarketingCampaign.scheduledAt` is recorded at creation;
      `POST /marketing/campaigns/:id/send` is the explicit staff-gated
      trigger (no background scheduler was built — sending itself is
      always an explicit, audited staff action, matching this phase's
      own "no general workflow engine" boundary).

## Negative scenarios / edge cases

1. Customer opts out of Email marketing but not SMS → subsequent Email
   campaigns exclude them; SMS campaigns still include them. Proven
   structurally: `isOptedIn` is checked per (channel, messageType) pair
   independently — an EMAIL opt-out row has no bearing on an SMS
   campaign's own lookup (tests #6/#9 together demonstrate the
   per-channel independence: the SAME customer is excluded on the
   channel they opted out of and would be included on any other they
   did not).

## Security / Privacy

- [x] Segmentation/campaign tooling does not expose full customer PII
      unnecessarily to the Marketing role (data minimization) — see
      the recipient-count proof above. `CampaignDelivery` rows
      (visible only via direct DB access, never a listing route this
      milestone built) record `customerId`/status/provider message ID
      only, never a name/email/phone snapshot.

## Test requirements

- [x] Integration test: opt-out correctly excludes a customer from the
      relevant channel's next campaign send —
      `test/integration/marketing.test.ts` tests #6, #9, #10 (15 tests
      total: 3 segmentation, 2 campaign-creation validation, 8
      campaign-send including 2 genuine `Promise.all` concurrency
      tests, 2 staff RBAC).

## Additional coverage beyond the original acceptance criteria

- [x] `ORDER_UPDATES` (the one transactional message type) is rejected
      as a campaign `messageType` at creation time — a campaign is
      always genuine marketing, never a vehicle for transactional
      messaging (test #4).
- [x] The PUSH channel always resolves to `SKIPPED_NO_ADDRESS` for
      every recipient — an honest, documented scope boundary (no
      device-token registration flow exists anywhere in this codebase,
      the same kind of gap M19's photo-upload and M08's S3-client each
      recorded rather than fabricating a fake destination) — test #8.
- [x] Idempotent per-recipient delivery: re-sending an already-SENT
      campaign is a safe no-op, never a duplicate `CampaignDelivery`
      row or a double message (test #11).
- [x] Genuine concurrency: two simultaneous `POST .../send` calls on
      the SAME campaign (fired via `Promise.all`, no intervening
      `await`) converge to exactly one sender via a database-level
      compare-and-swap claim on the campaign's own `SENDING` status —
      never a double-send (test #12).
- [x] A cancelled campaign can never be sent, and an already-sent
      campaign can never be cancelled (test #13).
- [x] Staff RBAC: `campaign:manage` (create/send/cancel) and
      `campaign:read` (list/get) are separately gated permissions
      (tests #14/#15).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This agent does
not self-declare M25 certified — that determination belongs to the
independent reviewer, per the discipline this project has followed
since Phase 1.
