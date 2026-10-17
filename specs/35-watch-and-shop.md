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

---

## ADDENDUM (2026-10-17): reel-viewing interaction — modal +
## horizontal navigation

**Status: IMPLEMENTED (built 2026-10-17, commit `e24f4e0`).** Does not
change the `APPROVED` status or any already-built requirement above.
This addendum **supersedes W-1's page-navigation and vertical-arrow
specifics only** (`docs/design/VANYA_VISUAL_PARITY.md`) — W-1's
underlying visual design (colours, typography, card/rack content) is
not otherwise affected. Built under a separate, explicit build
authorization given after approval — this spec approval and
implementation authorization remain distinct, per this file's own §3/§5
discipline.

### Why

The Product Owner shared screenshots of a competitor site's ("Kisah")
"Seen on Real People" shoppable-reel experience (reviewed 2026-10-17)
as a reference for how reel viewing should work. Comparing it against
the current implementation
(`apps/storefront/src/vanya/views/ReelsView.tsx`,
`apps/storefront/src/vanya/views/HomeView.tsx:324-407`) found most of
the underlying capability already matches or exceeds the reference —
multiple tagged products per reel, mute toggle, live price/Add to
Bag/Full Details are all already built per this spec's "Approved
requirements" above. Two concrete interaction differences remain:

1. Today, clicking a reel thumbnail on Home navigates to a separate
   full page (`<Link href="/watch-and-shop?reel=<id>">`,
   `HomeView.tsx:364`). The reference opens a full-screen **modal**
   overlaying the current page instead.
2. Today, moving between reels uses vertical `ChevronUp`/`ChevronDown`
   controls layered on the video itself (`ReelsView.tsx:162-182`). The
   reference uses large **left/right** arrow controls outside the
   video frame.

### Decision requested

Approve changing (1) and (2) only, as scoped below.

### What changes

- **Desktop/tablet**: opening a reel (from the Home carousel, or from
  the `/watch-and-shop` grid itself) opens a full-screen modal over the
  current page — no full page navigation, no loss of scroll position
  on the page underneath. The modal shows the same content the current
  `ReelsView` right-hand rack shows today (tagged garments list, price,
  Quick Buy, Full Details), next to the video.
- **Reel-to-reel paging**: replace the vertical chevrons with large
  circular left/right arrow buttons positioned at the outer edges of
  the modal frame (matching the reference's placement, not overlaid on
  the video itself). Same ordering as today
  (`merchandisingPosition`-ordered `reels` array, unchanged), same
  disabled-at-the-ends behavior as today's chevrons.
- **Mobile**: the modal renders full-viewport (no visible page behind
  it) — this is not a new requirement, it is the existing "Mobile: an
  immersive, vertical, full-viewport feed" line under "Storefront
  experience" above, unchanged. Only the desktop windowed-modal-vs-
  full-page distinction is new.
- **Deep-linking is preserved, not dropped.** `/watch-and-shop?reel=<id>`
  must keep working as a directly-loadable, shareable URL that renders
  the reel's real content server-side (for SEO/link-preview parity with
  today — no empty client-only shell). Recommended implementation:
  Next.js intercepting + parallel routes (the same pattern Instagram's
  own web app uses for this exact behavior) — a click from elsewhere on
  the site intercepts the navigation and opens the modal with a shallow
  URL update; a hard load or shared link to that same URL renders the
  full, non-modal page. This is an implementation recommendation, not
  a new product requirement — an equivalent client-side approach that
  meets the same "shareable, SEO-renderable, no full reload from
  in-app clicks" bar is also acceptable.
- **Close affordance**: an explicit close (✕) control, plus Escape-key
  and backdrop-click dismissal, consistent with this codebase's other
  modals (reuse `useModalFocus`, already imported in
  `ReelsView.tsx:12`, for focus trapping).
- The `/watch-and-shop` standalone grid page (browsing all reels,
  today's "Explore All Shoppable Reels" section) continues to exist as
  a real destination page for browsing/SEO; the modal is the viewing
  mechanism for one reel at a time, opened from that grid, from Home,
  or from a direct link — it does not replace the grid page itself.

### Explicitly not addressed by this addendum (separate, undecided — do not conflate)

- Branding/copy (e.g. "Seen on Real People" vs. today's "VANYA ON
  INSTAGRAM" / "Watch & Shop Cinema") — unaffected, unchanged.
- Real Instagram-embed video sources — remains explicitly out of scope
  per this spec's "Explicitly out of scope" section above; unaffected.
- View/engagement counts — remains the existing open item tracked in
  `docs/design/VANYA_VISUAL_PARITY.md`'s Decision list; unaffected.

### Acceptance criteria to add

- Clicking a reel thumbnail on Home opens the modal without a full
  page navigation (verified by a route-change/network check, not
  visual inspection alone); the page underneath keeps its scroll
  position when the modal closes.
- A fresh/hard-loaded or shared `/watch-and-shop?reel=<id>` URL renders
  that reel's real content server-side, not an empty shell awaiting
  client JS.
- Left/right arrows page through reels in the same
  `merchandisingPosition` order the vertical chevrons use today;
  disabled correctly at the first/last reel.
- Multi-product tagging strip, mute toggle, Add to Bag, Quick Buy, and
  Full Details all continue to work unchanged inside the modal.
- Mobile continues to render full-viewport, matching the pre-existing
  requirement — not a new behavior to verify, a regression check that
  this change didn't alter it.
