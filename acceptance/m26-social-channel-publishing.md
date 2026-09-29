# M26 — Social / Channel Publishing Acceptance Criteria

**Spec(s):** `specs/25-social-channel-publishing.md`
**Status:** BUILT (2026-09-28) — **adapter/contract architecture
only,** as authorized. No concrete marketplace integration is in scope
for this milestone. **Independent-review certification repair applied
2026-09-28** (channel-availability truth + ambiguous-provider-outcome
model) **and a second, focused independent-review certification repair
applied 2026-09-29** (provider idempotency operation identity) — see
the spec's own repair addenda and `CHAN-001` in
`blueprint/DECISION_REGISTER.md`. Not self-declared certified —
awaiting independent re-review, per this repository's standing
discipline.

## Business acceptance

- [x] The Product Master schema contains **no** marketplace-specific
      fields — verified by code/schema review: `Style`/`Sku`/`Price`
      gained zero new columns; all channel-specific mapping lives in
      `Channel.config` (JSON), outside the core schema.
- [x] A channel adapter contract/interface exists
      (`services/commerce-api/src/modules/channels/provider.ts`,
      `ChannelProvider`) that a future concrete integration (Meta,
      Google Merchant, Amazon, Flipkart, Myntra, Ajio, etc.) would
      implement, with channel-specific field mapping expressed as
      configuration (`ChannelFieldMapConfig` template strings resolved
      against real catalog data), not core schema changes.

## Functional acceptance

- [x] A mock/test channel adapter (`MockChannelProvider`) can be
      registered and produces a correctly-mapped feed from core
      catalog data (`ChannelService.buildFeedItem`/`previewFeedItem`),
      proving the contract works end-to-end without a real marketplace
      connection.
- [x] Publishing status per channel per SKU is tracked
      (`ChannelListing`, `@@unique([channelId, skuId])`) — even with
      zero real channels connected, the tracking structure exists and
      is tested against the mock adapter (14 original + 19 repair
      integration tests, `test/integration/channels.test.ts`).
- [x] **(Repair)** Feed `availability` is derived from the canonical
      inventory ledger (`InventoryService.getAvailableToSellBySku`, the
      same cross-location formula the certified PDP uses), never
      fabricated — `in_stock` iff `sum(onHand) - sum(reserved) > 0`
      across all locations.
- [x] **(Repair)** Publishability and stock level are independent: a
      catalog-publishable, zero-stock SKU still publishes, correctly
      marked `out_of_stock` — no auto-unpublish-at-zero-stock policy
      exists or was invented.
- [x] **(Repair)** A staff-gated, idempotent, callable resync sweep
      (`POST /channels/sweep/resync-stale`) detects and corrects a
      PUBLISHED listing whose live availability has drifted from its
      last-synced snapshot, in both directions (in_stock → out_of_stock
      and back).
- [x] **(Repair)** Provider outcomes distinguish `SUCCESS` / `FAILED`
      (a DEFINITE, known rejection) / `AMBIGUOUS_RECONCILIATION_REQUIRED`
      (the provider call threw/timed out, or a stale claim was
      reclaimed) — never conflating the last two — for both publish and
      unpublish.
- [x] **(Repair)** A durable, row-locked `PROCESSING` claim is taken on
      the `ChannelListing` row before any provider call, closing the
      concurrency gap: two genuinely concurrent requests for the same
      channel+SKU converge to at most one provider dispatch. A
      staff-gated stale-claim sweep (`POST /channels/sweep/reclaim-stale`)
      reclaims a claim whose owning process crashed mid-flight.
- [x] **(Repair)** No `MOCK_*` provider can be resolved when
      `NODE_ENV=production` (`getChannelProvider`'s own guard).
- [x] **(2026-09-29 repair)** The provider-facing idempotency identity
      distinguishes PUBLISH from UNPUBLISH, and distinguishes a
      genuinely new logical publish/resync operation from an earlier
      completed one, while remaining STABLE across retries/reconciliation
      of the SAME open (ambiguous or reclaimed-stale) operation — a
      durable `ChannelListing.currentOperationId`, minted or reused
      inside `claimProcessing`'s own row-locked transaction BEFORE any
      provider dispatch, composed into
      `${channelId}:${skuId}:${action}:${operationId}`. No random
      per-call value is used, preserving retry safety.

## Negative scenarios / edge cases

1. Attempt to add a marketplace-specific field directly to the core
   Product Master schema → confirmed not the natural/available path in
   the implemented design: the only channel-specific data path is
   `Channel.config`, read only by `ChannelService`/`ChannelProvider`,
   never by catalog/price/inventory code (architectural review, not a
   runtime test).

## Explicitly out of scope for this milestone

- Any real connection to Meta, Instagram, Facebook, Google Merchant
  Center, Amazon, Flipkart, Myntra, or Ajio. Building one requires
  separate, explicit milestone authorization. Confirmed: the only
  registered provider names are `MOCK`/`MOCK_UNRELIABLE`/
  `MOCK_ALWAYS_FAILS`.

## Test requirements

- [x] Integration test: mock adapter registration → feed generation →
      correct field mapping, with no core schema dependency on the
      mock adapter's specifics (`test/integration/channels.test.ts`,
      14 original tests: field-mapping with a custom template and with
      the default template, per-channel-per-SKU status tracking, honest
      validation-failure/provider-failure/provider-exception recording
      with incrementing retry count, publish/unpublish + full attempt
      history, idempotent re-publish, unique channel key, and staff
      RBAC over HTTP including a 401/403 negative case).
- [x] **(Repair)** 19 additional adversarial tests: inventory truth
      (no balance row / onHand=0 / fully-reserved / cross-location
      aggregation / zero-stock-still-publishes / no channel write ever
      touches InventoryBalance), stale-projection detection+resync
      (drift down, no-op re-sweep, drift back up), ambiguous vs.
      definite provider outcomes for both publish and unpublish
      (including the operator-safe ambiguous-retry path and the
      never-published-so-nothing-to-unpublish boundary), durability
      (exactly-once SUCCESS recording, a manufactured stale-PROCESSING
      crash scenario reclaimed by the sweep, a provider-configuration
      failure recorded as a definite FAILED rather than left stuck),
      genuine `Promise.all`/row-lock concurrency for both publish and
      unpublish, and security (publish/reconcile RBAC, the production
      mock-provider guard).
- [x] **(2026-09-29 repair)** 9 additional adversarial tests
      (`test/integration/channels.test.ts`, now 42 total): publish vs.
      unpublish use distinct operation identities even when one
      reconciles the other's still-open ambiguous state; a retry of the
      same ambiguous publish, and separately the same ambiguous
      unpublish, preserve the same operationId across repeated attempts;
      a resync of an already-PUBLISHED listing and a retry after a
      DEFINITE `FAILED` both mint a NEW operationId; a reclaimed stale
      `PROCESSING` claim preserves the crashed attempt's original
      operationId; two genuinely concurrent publish requests converge to
      at most one provider dispatch; and operation-identity resolution
      never reads or writes `InventoryBalance`.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Do not interpret
this milestone's completion as authorization to build a real
integration.
