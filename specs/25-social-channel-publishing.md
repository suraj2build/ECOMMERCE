# 25. Social / Channel Publishing

**Status:** APPROVED (adapter architecture only — decided 2026-09-22;
concrete marketplace integrations explicitly deferred — see
`blueprint/DECISION_REGISTER.md` `CHAN-001`)

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
