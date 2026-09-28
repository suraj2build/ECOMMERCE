# 25. Social / Channel Publishing

**Status:** IMPLEMENTED (2026-09-28, adapter architecture only — decided
2026-09-22; concrete marketplace integrations explicitly deferred — see
`blueprint/DECISION_REGISTER.md` `CHAN-001`). Repaired the same day
under a focused independent-review certification repair (below). Not
yet independently re-reviewed/certified.

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
