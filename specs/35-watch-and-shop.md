# 35. Watch & Shop

**Status:** APPROVED (Product Owner "START BUILD — PHASE 2" instruction,
2026-09-23 §9 — "The Product Owner explicitly wants Watch & Shop as
part of the customer experience," marking this business direction
approved and requiring a dedicated spec before implementation, per
`specs/08-storefront.md`'s Lovable UX-reference-boundary finding that
flagged this concept as previously unspecified.)

## Purpose

Own the shoppable short-form video experience surfaced on Home and
linked from PDP: vertical fashion media with tagged, purchasable
products. This is a genuinely new customer-facing capability, not a
UI treatment of an existing spec — it needs its own domain model
(content, tagging, moderation, scheduling) distinct from Product
Master (`specs/02`) and Catalog (`specs/07`), which it references but
does not duplicate.

## Scope

- Shoppable video/media entity: upload reference, campaign/creator
  attribution, lifecycle (draft/scheduled/published/unpublished/
  pending moderation/rejected), merchandising position.
- Product tagging: one media item tags one or more Style/SKU
  references, with an explicit ordering and an optional default
  colour/size pre-selection.
- Staff-facing publish/unpublish/schedule/moderate workflow (RBAC-
  gated, audited — same discipline as `catalog:publish`).
- Storefront consumption: vertical full-screen feed on mobile, video +
  adjacent product panel on desktop; product preview → colour → size →
  wishlist/add-to-bag → PDP handoff.
- Analytics event *hooks* (view/tap/add-to-bag events emitted for a
  future M28 Analytics/Reporting milestone to consume) — not an
  analytics platform.

## Explicitly out of scope (do not build now)

- Real Instagram/Meta API ingestion or publishing — that is
  `specs/25-social-channel-publishing.md` (M26), adapter-contract
  architecture only, no concrete integration authorized yet. Media
  for Watch & Shop is **platform-hosted/configured content** (staff
  uploads/references a video asset; no external platform is called).
- Fabricated/simulated social engagement counts (likes, views shown to
  customers) — none are displayed unless and until a real measurement
  exists. No "12.3K likes" placeholder numbers.
- Autonomous AI selection, generation, or publishing of Watch & Shop
  content — every publish/unpublish/schedule action is a staff action,
  attributed and audited, exactly like `catalog:publish`.
- A generic CMS/content-authoring surface — that is M29 Admin (+ CMS).
  Watch & Shop's own staff workflow is purpose-built for this one
  content type, not a general page/block editor.

## Approved requirements

### Content model

- A **ShoppableMedia** entity owns: a media reference (video URL/
  asset id — the physical file lives in object storage per ADR-0007,
  this entity stores the reference), a thumbnail, a title/caption,
  creator/campaign attribution (free text — no external creator
  identity system required at V1), a **lifecycle state**
  (`DRAFT → PENDING_MODERATION → SCHEDULED/PUBLISHED → UNPUBLISHED`,
  plus `REJECTED` from moderation), an optional `scheduledPublishAt`,
  `publishedAt`, and a `merchandisingPosition` (integer, staff-set,
  determines feed order — ties broken by most-recently-published).
- Every lifecycle transition is staff-attributed and audited (same
  `recordAudit` discipline as `product:publish`/`catalog:publish`).
- A **ShoppableMediaTag** join entity links one ShoppableMedia to one
  Style (optionally scoped to a specific Colour), with an explicit
  `sortOrder` and an optional default `sizeId` pre-selection. A media
  item MUST support **multiple** tagged products (per V1 capability:
  "tagged products/SKUs," plural).
- Only `PUBLISHED` media (and only while its optional schedule window
  is currently active, if used) is ever returned to the storefront
  read path — the same "publishable" discipline as
  `CatalogService.getCatalogEntry`'s `isPublishable` gate.

### Moderation and scheduling

- A `PENDING_MODERATION` state exists as a distinct step before
  `PUBLISHED`, so a content workflow with a review gate is supported
  without requiring every publish to be instant (configurable per
  operating process — going straight from `DRAFT` to `PUBLISHED` is
  also a valid path if no moderation step is used).
- `scheduledPublishAt` is honored at read time (a `SCHEDULED` item
  becomes visible on the storefront once its scheduled time has
  passed and its state machine promotes it), not merely a display
  label — mirroring `MerchandiseBadge.startsAt/endsAt`'s effective-
  window pattern.

### Storefront experience

- **Mobile:** an immersive, vertical (full-viewport, swipe/scroll)
  feed of published media, in `merchandisingPosition` order.
- **Desktop:** the same media, presented with an adjacent product
  panel (not forced into a mobile-style vertical takeover) — per
  `specs/08-storefront.md`'s "both mobile web and desktop web are
  required" and "fully responsive" requirements.
- Tapping/clicking a tagged product surfaces a **product preview**
  (image, name, price) with **colour** and **size** selection, then
  **wishlist** and **add to bag** actions using the same authoritative
  SKU/price/availability data as PDP (`specs/10-pdp.md`) and Cart
  (`specs/11-wishlist-cart.md`) — Watch & Shop is a discovery surface
  over the same commerce data, never a second source of product/price
  truth. A "view full details" action hands off to the real PDP.
- Availability-aware: an out-of-stock size/colour is shown as
  unavailable, exactly as PDP does — no fake availability.

### Analytics hooks

- View, tag-tap, and add-to-bag-from-media events are emitted (an
  audit-log-style event write, actor type `CUSTOMER` or anonymous
  session, referencing the ShoppableMedia id) so a future M28
  Analytics/Reporting milestone has real data to build on. This spec
  does **not** build dashboards, funnels, or reporting — event
  capture only.

## Remaining open items

None — this is a new capability with no compliance/legal dependency;
all requirements above are engineering-decidable now.

## Acceptance criteria

See `acceptance/m09-watch-and-shop.md`.

## Dependencies

Depends on: `specs/02-product-master.md` (Style/Colour/Size/SKU
references), `specs/06-inventory.md` (availability), `specs/07-catalog-merchandising.md`
(price). Feeds: `specs/08-storefront.md` (Home module), `specs/10-pdp.md`
(handoff target), `specs/11-wishlist-cart.md` (wishlist/add-to-bag
actions). Explicitly does not depend on
`specs/25-social-channel-publishing.md` (no real social platform
integration at V1).
