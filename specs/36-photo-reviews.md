# 36. Photo Reviews & "What Our Customers Say"

**Status:** DRAFT — awaiting Product Owner approval. Reference: a
competitor site's ("Littlebox India") "What Our Customers Say?"
shoppable-testimonial carousel, shared by the Product Owner 2026-10-17.

## Purpose

Let a customer attach a photo of themselves wearing/using a product to
their review, and surface a staff-curated selection of these photo
reviews in a homepage carousel ("What Our Customers Say") — each card
showing the customer's photo, name, star rating, review text, and a
link back to the exact product they reviewed.

This extends the existing M11 review capability
(`services/commerce-api/src/modules/pdp/review-service.ts`,
`Review` model) rather than building a second, parallel review system.
Ratings, review text, one-review-per-customer-per-style, and the
live-computed average-rating/count discipline are all **unchanged** —
this spec adds exactly two things: a photo on a review, and a
homepage surface for a staff-chosen subset of them.

## Scope

- **One optional photo per review.** A customer may attach a photo
  when submitting a review, or add one afterward to their own existing
  review. Not a gallery — V1 is one photo, matching the reference
  exactly; this codebase's own convention (`specs/35`'s "don't build
  speculative capability") argues against a multi-photo model nothing
  has asked for yet.
- **Storage**: reuse the existing PUBLIC product-media storage
  abstraction's pattern
  (`services/commerce-api/src/modules/product/media-storage.ts`) — a
  minimal `put(key, buffer, mimeType)`/`get(key)` provider, local-disk
  today with an S3-compatible interface for later, server-generated
  keys only, magic-byte MIME sniffing that never trusts the client-
  declared Content-Type (the same discipline M19's return-evidence
  upload already established). A **new, separate** store/prefix from
  both product media and the private return-evidence store — a review
  photo's key can never collide with either.
- **Homepage featuring is always an explicit staff action.** Attaching
  a photo to a review never, by itself, makes it eligible for the
  homepage carousel. A staff member with `content:moderate` (the same
  permission that already gates hiding a review) sets `featuredOnHome`
  (boolean) and a `featuredSortOrder` (integer, ties broken by most-
  recently-featured) on a specific review — mirroring the staff-
  curated `merchandisingPosition` discipline `specs/35` already
  established for Watch & Shop, for the same reason: high-visibility
  homepage placement is never auto-populated from raw submissions.
  `featuredOnHome` can only be set on a review that has a photo and is
  not `HIDDEN`.
- **Consent for public photo display.** Submitting or attaching a
  photo requires an explicit, separate checkbox/confirmation ("I agree
  this photo may be shown publicly on VANYA's website and marketing"),
  recorded with a timestamp — this is a photo of the customer
  themselves, personal data, distinct from the already-implicit
  publication of their review text and first name.
- **Homepage carousel**: shows only `PUBLISHED` reviews with
  `featuredOnHome = true`, each card rendering the photo, the
  customer's first name (never full name/surname — the existing
  `listPublishedReviews` already selects `fullName`, but the public
  card shows only a first-name-style display, same minimal-PII
  discipline as Watch & Shop's creator attribution), the star rating,
  review count for that reviewer is **not** shown (unlike the
  reference's "(482)" — that number in the reference is the
  *product's* total review count, already computed live by the
  existing `listPublishedReviews`/average-rating logic; reusing it
  here, not inventing a new per-reviewer metric), review text
  (truncated with a "read more" affordance if long), and a linked
  product card (thumbnail, name, price) pointing at the real PDP —
  exactly the product the review is of, no separate tagging mechanism
  needed since a review already names exactly one `styleId`.
- **Staff curation surface**: a filtered, sortable list of reviews with
  photos (`hasPhoto = true`), with a toggle for `featuredOnHome` and a
  position field — the minimum surface needed, not a general content
  calendar.

## Explicitly out of scope (do not build now)

- Multiple photos per review, or video testimonials — a photo-review
  gallery is a materially bigger feature; not requested.
- Customer-facing moderation status/feedback ("your photo was
  rejected") — out of scope until a moderation policy decision (see
  Open question below) actually requires it.
- Fabricated or cross-posted social engagement numbers on a card
  (likes, shares) — same "no fake engagement" discipline as `specs/35`.
- A generic customer-generated-content/UGC platform, rights-management
  system, or influencer program — the Product Owner has separately
  noted a competitor's creator/affiliate program page as visual
  reference only, not a request to build that program; this spec is
  scoped to reviews with photos, nothing broader.
- Automatic selection of which reviews to feature (e.g. "auto-feature
  every 5-star photo review") — featuring is always a specific staff
  action on a specific review, never a rule-based auto-promotion.

## RESOLUTION (Product Owner, 2026-10-17): photo moderation policy

**Decided: auto-publish immediately, same as text reviews.** A photo
attached to a review follows the exact existing text-review discipline
("auto-published on submission... staff can hide after the fact via
`content:moderate`") — no new pre-moderation gate, no second
publish-state machine. A photo appears on the product's own PDP
review list the instant it's attached, exactly like review text does
today; staff moderation remains the existing after-the-fact
`status = HIDDEN` action, now also hiding the photo (a hidden review's
photo is never served, independent of `featuredOnHome`).

This keeps the review system as ONE discipline, not two — the thing
`specs/35`'s own `ShoppableMedia` pre-moderation step exists for
(deliberately-curated brand content, never auto-published) is already
handled separately by this spec's own `featuredOnHome` staff gate,
which was never in question: a photo being visible on its own review
is independent from a photo being chosen for the high-visibility
homepage carousel, and only the latter ever required staff action.

## Requirements (data model)

- `Review` gains: `photoKey` (string, nullable — the storage key, not
  a public URL, following the product-media pattern), `photoConsentAt`
  (DateTime, nullable — set when the consent checkbox above is
  confirmed; a photo can never be stored without this being set in the
  same request), `featuredOnHome` (boolean, default false),
  `featuredSortOrder` (integer, nullable, staff-set only, meaningful
  only when `featuredOnHome` is true).
- A public read route serves a review photo by its style/review id,
  the same shape as the existing public product-media read route — no
  raw storage key ever reaches the client.
- Every `featuredOnHome`/`featuredSortOrder` change is staff-attributed
  and audited (`recordAudit`), the same discipline as every other
  publish-adjacent action in this codebase.

## Acceptance criteria

- A customer can attach one photo (with consent) to their own review,
  either at submission or afterward to an existing review — never to
  someone else's.
- A review without `photoConsentAt` set can never have a photo stored
  against it, enforced server-side, not just hidden client-side.
- `featuredOnHome` can only be set true by staff with `content:moderate`,
  only on a review that has a photo and is not `HIDDEN`; attempting it
  on a photo-less or hidden review is rejected, not silently ignored.
- The homepage carousel renders only `featuredOnHome = true`,
  `PUBLISHED` reviews, each linking to the real PDP of the exact
  product reviewed, with the product's live price (never a stale
  cached price).
- Hiding a review (`status = HIDDEN`) immediately removes it from the
  homepage carousel, even if `featuredOnHome` is still true — the
  carousel's own query checks both fields, not just one.
- No fabricated per-reviewer engagement numbers appear on a card.

## Dependencies

Depends on: this spec's own base, `services/commerce-api/src/modules/pdp/review-service.ts`
(M11 reviews — rating/text/one-per-customer, unchanged),
`specs/02-product-master.md` (Style reference for the linked product
card), `specs/07-catalog-merchandising.md` (live price shown on the
card). Reuses the storage *pattern* established by
`services/commerce-api/src/modules/product/media-storage.ts` and
`services/commerce-api/src/modules/returns/evidence-storage.ts`
(magic-byte MIME validation, server-generated keys) without sharing
either one's actual bucket/prefix. Feeds: Home (`specs/08-storefront.md`).
