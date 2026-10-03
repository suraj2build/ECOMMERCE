# 25. Social / Channel Publishing

**Status:** IMPLEMENTED (2026-09-28, adapter architecture only — decided
2026-09-22; concrete marketplace integrations explicitly deferred — see
`blueprint/DECISION_REGISTER.md` `CHAN-001`). Repaired 2026-09-28 and
again 2026-09-29 under two focused independent-review certification
repairs (below). Not yet independently re-reviewed/certified.

## Independent-review certification repair (2026-09-29) — Blocker 1: provider idempotency operation identity

The 2026-09-28 repair's provider-facing `idempotencyKey` was
`${channelId}:${skuId}` for BOTH publish and unpublish, reused verbatim
across every publish/resync/unpublish call — a real provider could
conflate an initial publish, a later resync, and an unpublish as the
same already-processed operation. Fixed with a durable, pre-dispatch
operation identity (`ChannelListing.currentOperationId`, resolved
inside `ChannelService.claimProcessing`'s own transaction, before any
provider call): a fresh id is minted when claiming from a SETTLED
status (`NOT_PUBLISHED`/`PUBLISHED`/`FAILED` — each a genuinely new
logical operation), and the existing id is REUSED when reconciling a
still-open one (`AMBIGUOUS_RECONCILIATION_REQUIRED`, or a reclaimed
stale `PROCESSING`). The provider-facing key is now
`${channelId}:${skuId}:${action}:${currentOperationId}` — `action`
keeps publish/unpublish identity spaces separate even in the one
legitimate case where the same operationId is reused across both. See
`CHAN-001`'s own repair addendum in `blueprint/DECISION_REGISTER.md`
for the complete design record and
`acceptance/m26-social-channel-publishing.md` for the corrected
Definition of Done.

## Independent-review certification repair (2026-09-28)

An independent review of the original M26 build returned two blockers,
both fixed the same day:

1. **Channel availability was fabricated.** `buildFeedItem` returned
   `availability: 'in_stock'` unconditionally, never derived from real
   inventory. Fixed: availability is now computed live from the
   canonical inventory ledger (M06) via a new shared
   `InventoryService.getAvailableToSellBySku` method — the SAME
   cross-location `onHand - reserved` formula the certified public PDP
   (M11) already used, extracted so both consumers share one
   implementation rather than each computing "sellable" independently.
   No new inventory table, ledger, or channel-specific stock
   allocation policy was invented. Publishability (style PUBLISHED +
   active price + SKU active) and stock level are kept deliberately
   separate — a catalog-publishable SKU with zero stock still publishes
   as `out_of_stock`, never auto-unpublished, since no such policy is
   approved. A staff-callable resync sweep
   (`POST /channels/sweep/resync-stale`) detects PUBLISHED listings
   whose live availability has drifted from what was last actually told
   to the channel (a pure read-time comparison against
   `ChannelListing.payloadSnapshot`, no new persisted "stale" flag) and
   corrects them by reusing `publishSku` itself.
2. **A thrown/timed-out provider call was recorded as an ordinary
   definite failure.** Fixed with an honest three-outcome model:
   `SUCCESS` (provider confirms), `FAILED` (a DEFINITE, known rejection
   — local validation, provider config resolution failure, or an
   explicit provider rejection), and the new
   `AMBIGUOUS_RECONCILIATION_REQUIRED` (the provider call itself threw/
   timed out after dispatch, or a stale in-flight claim was reclaimed —
   the same status this codebase's Marketing (M25) and Notification
   (M29) domains already use for an identical reliability problem).
   Applied to BOTH publish and unpublish.

Also implemented as part of this repair: a durable, DB-backed
`PROCESSING` claim (row-locked, `SELECT ... FOR UPDATE`) taken on the
`ChannelListing` row BEFORE any external provider call — committed to
Postgres before dispatch, so it is durable evidence an attempt began,
and the real serialization point preventing two genuinely concurrent
publish/unpublish requests on the same channel+SKU from both reaching
the provider; a staff-callable stale-claim sweep
(`POST /channels/sweep/reclaim-stale`) reclaims a claim whose owning
process crashed mid-flight; the stable `channelId:skuId` idempotency
key is unchanged (a real provider is expected to de-duplicate on it,
including on an operator-safe retry of an ambiguous outcome); and a
production-environment guard (`getChannelProvider`) that refuses to
resolve any `MOCK_*` provider when `NODE_ENV=production`. See
`CHAN-001`'s repair addendum in `blueprint/DECISION_REGISTER.md` for
the complete design record and
`acceptance/m26-social-channel-publishing.md` for the corrected
Definition of Done.

## Purpose

Define how the product master/catalog is published to channels beyond
the primary website.

## Scope

```
PRODUCT MASTER -> CHANNEL PUBLISHING -> WEBSITE / GOOGLE / META / marketplaces
```

- Channel adapter/contract architecture
- Channel-specific field mapping/configuration
- Publishing status tracking per channel per SKU

## Approved requirements (2026-09-22)

- The core Product Master (`specs/02-product-master.md`) **MUST NOT**
  embed marketplace-specific fields — channel requirements are
  expressed through **channel-specific mappings/configuration**, kept
  outside the core schema.
- A **channel adapter/publishing contract** MUST be built now,
  designed to support future configurable integration with: Meta,
  Instagram, Facebook, Google Merchant Center, Amazon, Flipkart,
  Myntra, Ajio, and future channels.
- **No concrete marketplace integration is built now.** Each actual
  integration requires separate, explicit milestone authorization
  before implementation begins (explicit, §3) — this spec's approval
  covers the adapter architecture only, not any specific channel's
  live integration.
- Not a third-party seller marketplace model — see
  `specs/31-organization-locations.md` `ORG-001`.

## Remaining open items

Which channel(s), if any, get a concrete integration and when remains
a future, separately-authorized decision — not a blocker on this
spec's approved architecture scope.

## Acceptance criteria

See `acceptance/m26-social-channel-publishing.md` (adapter contract
scope only).

## Dependencies

Depends on: `specs/02-product-master.md`, `specs/07-catalog-merchandising.md`.
Related: `specs/24-marketing.md`, `specs/26-seo.md`.

## Launch readiness addendum (2026-10-03) — IMPLEMENTING

Google Merchant and Meta catalogue providers are authorized and built on the existing ChannelProvider contract (`LR-004`): one item per SKU grouped by style, image, product URL, INR price, live availability; publish/unpublish/price/stock resync; rejection is FAILED, transport uncertainty is AMBIGUOUS. Watch & Shop is internal and is not an Instagram integration; Instagram product tagging is not promised.

### Implementation (2026-10-03)

- **Providers.** `services/commerce-api/src/modules/channels/feed-providers.ts`:
  `GOOGLE_MERCHANT` writes `productInputs:insert` / deletes `productInputs`
  on the Merchant API (`products/v1`) into one API data source, authorised
  with a service-account JWT (RS256, `auth/content` scope) exchanged for an
  OAuth token and cached; `META_CATALOG` sends Graph `items_batch`
  (`PRODUCT_ITEM`, `allow_upsert`, `UPDATE`/`DELETE`) with the access token
  in the body. Both are selected per channel (`providerName`) and are the
  only non-mock providers; production still refuses `MOCK*`.
- **Feed item.** One item per SKU (`offerId`/`id` = SKU code), grouped by
  style code (`itemGroupId`/`item_group_id`), title/description from the
  channel template, absolute product link (`STOREFRONT_PUBLIC_URL`) and
  image, brand, colour, size, gender, INR price; when marked down, the MRP
  is the price and the selling price the sale price. Availability comes from
  the inventory ledger (unchanged since M26). No GTIN/MPN is sent
  (Google `identifierExists=false`).
- **Outcomes.** Missing credentials, a missing link/image/brand, a 4xx or
  Meta item validation errors → definite FAILED, no provider call where
  avoidable; timeout, network error, 429 or 5xx → AMBIGUOUS (re-issuing the
  same publish is safe: both providers upsert by SKU code). Meta processes
  batches asynchronously: a success means accepted, and later ingestion
  errors appear in Commerce Manager.
- **Resync.** `POST /channels/sweep/resync-stale` now: republishes any
  published listing whose title, description, image, link, price, sale
  price or availability changed; unpublishes listings whose style is no
  longer published/priced or whose SKU is inactive; and, for channels with
  config `publishAll: true`, publishes newly published SKUs (up to 200 per
  channel per run).
- **Watch & Shop is not Instagram.** Watch & Shop is the storefront's own
  shoppable-video page. Nothing here connects to Instagram, and Instagram
  product tagging is not promised: it needs a Meta Commerce Account, an
  approved catalogue (the `META_CATALOG` channel can supply it) and the
  Instagram account's shopping eligibility, all checked in Meta's tools.
- **Tests.** `test/integration/channel-feeds.test.ts` (5): Google payload
  and verified JWT signature, Meta payload/token placement and DELETE,
  definite vs ambiguous outcomes and the safe retry, missing configuration,
  and the resync sweep (price change, sell-out, unpublished style,
  publish-all). `channels.test.ts` (42) unchanged except the sweep result
  now also reports `unpublished`/`published`.
- **Not yet verified against the real services:** no Merchant Center
  account, data source, service account or Meta catalogue is configured.
  The request shapes follow the published Merchant API v1 and Graph API
  documentation; the first real publish must be checked in Merchant
  Center diagnostics and Commerce Manager.
