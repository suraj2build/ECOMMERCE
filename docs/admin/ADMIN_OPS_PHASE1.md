# Desktop-First Admin Operations — Phase 1

Status: **IMPLEMENTING** (authorized by the Product Owner, Suraj, 2026-10-04:
"START BUILD — DESKTOP-FIRST ADMIN OPERATIONS, PHASE 1").

## The instruction, in brief

Make the admin practical for one owner running the business end to end.
Desktop is the primary workspace; on a phone the owner should be able to
track progress and take selected actions. "Ease" means connected workflows,
configuration the owner can understand, fewer repeated entries, clear
validation and reliable recovery.

Authorized Phase 1 scope:

1. **Guided product onboarding**: Basics → Variants → Photos → Pricing →
   Readiness → Preview → Publish. It supports resumable drafts and editing
   existing products, and uses category-appropriate attributes (apparel,
   shoes, belts, perfume) for the approved assortment.
2. **Product media management**: upload from the computer; thumbnails, cover
   image, colour assignment and ordering; safe replacement and removal;
   server-side validation. Public product media stays separate from private
   return evidence.
3. **Bulk product import**: Template → Upload → Column mapping → Validation →
   Change preview → Import → Results/error download. Identifiers are stable,
   blank cells are never treated as "clear this field", work runs in
   bounded batches, retries are safe and inventory is never touched.
4. **Visual storefront configuration**: a navigation menu editor with
   pickers, validation, ordering, preview and save feedback, clearly
   showing which placements the storefront actually reads. Banner and
   page media selection and preview improve; draft and published content
   are clearly separated; raw HTML is never rendered.
5. **Setup and health view**: every operational area shows configured /
   incomplete / test failed / unavailable, what is missing, the operational
   impact and the next action. It separates business settings (edited in
   admin) from deployment settings (set on the server). Channel publishing
   scope can be set in admin.
6. **Desktop UX**: workflow navigation, breadcrumbs, next actions,
   searchable and paginated lists, plain-language states, entered data kept
   after recoverable errors, no UUIDs, JSON or engine internals in owner
   flows. Server permissions stay authoritative.

Research only (no implementation in Phase 1): buying/receiving, dispatch,
promotions/campaigns and after-sales/money gap mapping; the dispatch
sale-posting finding; solo-owner approval options. See
[`NEXT_PHASES_RESEARCH.md`](NEXT_PHASES_RESEARCH.md).

Boundaries: no invented discount rates, shipping promises, tax rules,
carrier choices, approval exceptions or budgets. No paid advertising,
customer messaging or production deployment. The approved storefront
appearance and ongoing image work are preserved. Shipping/inventory
semantics (the sale-posting point) do not change in Phase 1, and
production mock-provider guards stay intact.

## Baseline

- The instruction named `7f5e90cf` (launch assortment) as the last
  reviewed HEAD. The working branch `claude/loving-fermat-cyucke` had
  moved on to `1195f48` (local demo port fix and an isolated local e2e
  runner, both by the Product Owner), which contains `7f5e90cf`.
- Phase 1 is built on its own branch, `claude/admin-ops-phase1`, cut from
  `1195f48`. This keeps it separate from the catalogue, image and storefront
  work continuing on `claude/loving-fermat-cyucke`. It is not merged to
  `main` until the implementation review is complete.

## What existed before Phase 1 (inspected, not assumed)

| Area | Existing | Gap closed in Phase 1 |
|---|---|---|
| Product master | Create style, add colour, generate SKU matrix, add media by URL, lifecycle transitions (`DRAFT → READY_FOR_ENRICHMENT → READY_FOR_QA → PUBLISHED`), QA completeness gate | No way to edit a style, colour or SKU after creation; media could not be removed, reordered or uploaded; SKU codes embedded part of an internal size ID |
| Category attributes | `Style` columns (fabric, fit, …) plus `customAttributes` JSON; categories had no product type | Category product type (apparel/footwear/belt/fragrance) drives which attributes and sizes the owner is offered |
| Media storage | Private return-evidence storage (local disk or S3) | A separate public product-media store using the same S3 client, served through the storefront origin |
| Bulk import | `POST /products/styles/bulk`: styles only, up to 1,000 per request, create-only | Full catalogue import (style, colour, SKU, price, image URL) with dry run, change preview, batches and retries |
| Navigation menus | `PUT /cms/navigation-menus/:key` with free-form items, edited as JSON | Visual editor; server-side link validation; consumed placements labelled |
| Landing pages / banners | Create, publish and unpublish pages; banners are live on creation | Page editing; banners can be saved as drafts; image picking with preview |
| Channels | Created by API with `config.publishAll`; no update route; `isActive` not enforced by the automatic sweep | Owner sets the publishing scope and pauses a channel in admin; a paused channel is skipped |
| Setup visibility | None | Setup & health page |

Details of each change, its tests and the remaining decisions are in the
sections below, updated as each part lands.
