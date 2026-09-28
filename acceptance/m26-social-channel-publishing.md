# M26 — Social / Channel Publishing Acceptance Criteria

**Spec(s):** `specs/25-social-channel-publishing.md`
**Status:** BUILT (2026-09-28) — **adapter/contract architecture
only,** as authorized. No concrete marketplace integration is in scope
for this milestone. Not self-declared certified — awaiting independent
review, per this repository's standing discipline.

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
      is tested against the mock adapter (14 integration tests,
      `test/integration/channels.test.ts`).

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
      14 tests: field-mapping with a custom template and with the
      default template, per-channel-per-SKU status tracking, honest
      validation-failure/provider-failure/provider-exception recording
      with incrementing retry count, publish/unpublish + full attempt
      history, idempotent re-publish, unique channel key, and staff
      RBAC over HTTP including a 401/403 negative case).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Do not interpret
this milestone's completion as authorization to build a real
integration.
