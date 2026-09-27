# M25 — Marketing Acceptance Criteria

**Spec(s):** `specs/24-marketing.md`
**Status:** IMPLEMENTED (built 2026-09-27); independent-review
certification-repair applied 2026-09-27 (Blocker 3 — scheduling was not
genuinely implemented; Blocker 4 — per-recipient dispatch had a
crash-then-duplicate-send gap); not yet independently re-reviewed.

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
- [x] **(Corrected 2026-09-27, independent-review certification-repair,
      Blocker 3)** Campaign scheduling works (create, schedule, send at
      configured time). **The original claim here was incorrect**: the
      original build persisted `MarketingCampaign.scheduledAt` at
      creation but left every campaign in `DRAFT` regardless, and the
      ONLY send path was the manual staff `POST .../send` route, which
      claimed any `DRAFT`/`SCHEDULED` campaign immediately regardless
      of `scheduledAt` — there was no genuine due-campaign execution
      mechanism at all, so this box was checked on a capability that
      did not exist. Now genuinely implemented: `createCampaign` sets
      `status: 'SCHEDULED'` (not `DRAFT`) whenever a `scheduledAt` is
      supplied; a new `MarketingService.processDueCampaigns()`
      (`POST /marketing/sweep/send-due`, staff-gated, callable, the
      same shape as `POST /loyalty/sweep/expire`) claims and sends ONLY
      campaigns where `status = SCHEDULED AND scheduledAt <= now` —
      literally that condition and nothing broader; a `DRAFT` campaign
      (no schedule committed) or a `SCHEDULED` campaign whose
      `scheduledAt` is still in the future is never touched by it. The
      pre-existing manual `POST .../send` route is unchanged and
      remains available as a SEPARATE, explicit immediate-send
      operation that does not redefine what the automatic sweep itself
      picks up. No background scheduler/job platform was built — the
      sweep is a plain callable function compatible with a future
      external scheduler/cron trigger, matching this phase's own "no
      general workflow engine" boundary. See `MKT-001`'s Blocker 3
      repair note in `blueprint/DECISION_REGISTER.md` for the full
      design record.
- [x] **(Added 2026-09-27, independent-review certification-repair,
      Blocker 4)** Per-recipient dispatch is durably claimed BEFORE the
      external provider call, closing a genuine crash-then-duplicate-
      send gap the original build had (provider accepts a message →
      process crashes before the `CampaignDelivery` row is written →
      a later reclaim finds no row and calls the provider again).
      `CampaignDelivery` now durably claims each recipient with a
      `PENDING` row (its own `@@unique([campaignId, customerId])`
      constraint is the atomicity guarantee) before ever calling
      `provider.send()`. A stale `PENDING` claim, or a provider call
      that itself throws/times out, is recorded as a new honest
      terminal state, `AMBIGUOUS_RECONCILIATION_REQUIRED` — never
      silently retried and never conflated with a provider's own
      definite `FAILED` rejection. This build does not claim universal
      exactly-once delivery (the provider abstraction does not
      guarantee that); it claims no INTENTIONAL duplicate dispatch, and
      every genuinely unknown outcome is labeled as such. See
      `MKT-001`'s Blocker 4 repair note in
      `blueprint/DECISION_REGISTER.md` for the full design record.

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
      `test/integration/marketing.test.ts` tests #6, #9, #10 (27 tests
      total: 3 segmentation, 2 campaign-creation validation, 8
      campaign-send including 2 genuine `Promise.all` concurrency
      tests, 7 scheduling/due-sweep tests including 2 genuine
      `Promise.all` concurrency tests, 5 durable per-recipient dispatch
      tests, 2 staff RBAC).
- [x] **(Blocker 3)** Controlled-time scheduling tests: a future
      campaign is not sent by the due sweep; a campaign is picked up
      the instant its `scheduledAt <= now` boundary is reached
      (inclusive); a genuinely past-due campaign is sent; a `DRAFT`
      campaign (no `scheduledAt`) is never touched by the sweep; a
      `CANCELLED` scheduled campaign is never sent by the sweep; two
      genuinely concurrent due-sweep invocations racing the SAME due
      campaign converge to exactly one sender; a customer opted-in at
      schedule time who opts out before the due time is suppressed by
      the sweep (preference checked at send time, never snapshotted) —
      tests #16–#22.
- [x] **(Blocker 4)** Adversarial per-recipient dispatch tests: two
      workers racing to durably claim the same recipient converge to
      exactly one winner; a fresh (non-stale) `PENDING` claim is never
      redispatched; a stale `PENDING` claim (simulated crash after the
      provider call, before recording the outcome) is reclaimed as
      ambiguous WITHOUT calling the provider again; a provider's
      definite rejection is recorded `FAILED`; a provider call that
      throws is recorded ambiguous and never auto-resolved/redispatched
      by a later send — tests #23–#27.

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
