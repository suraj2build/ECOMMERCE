# M09 — Watch & Shop Acceptance Criteria

**Spec(s):** `specs/35-watch-and-shop.md`
**Status:** READY_FOR_IMPLEMENTATION (Phase 2, approved 2026-09-23)

## Business acceptance

- [ ] Staff can create, tag (multiple products per media item),
      schedule, publish, unpublish, and moderate (approve/reject) a
      ShoppableMedia item, each action attributed and audited.
- [ ] Only `PUBLISHED` media whose optional schedule window is active
      is ever visible to a customer.
- [ ] No fabricated engagement counts (likes/views) are displayed.
- [ ] No autonomous AI publishing exists — every lifecycle transition
      traces to a staff actor.

## Functional acceptance

- [ ] A ShoppableMedia item supports multiple tagged
      Style/Colour/SKU references with an explicit `sortOrder`.
- [ ] Tapping a tagged product surfaces colour/size selection sourced
      from the same authoritative SKU/price/availability data as PDP
      — never a cached/duplicated copy.
- [ ] Wishlist and add-to-bag actions from within Watch & Shop use the
      real Wishlist/Cart services (`specs/11-wishlist-cart.md`), not a
      parallel implementation.
- [ ] An out-of-stock size/colour is shown unavailable, matching PDP.
- [ ] View / tag-tap / add-to-bag-from-media events are recorded
      (event capture only — no dashboard/reporting built here).

## Mobile behavior

- [ ] Feed is an immersive, full-viewport vertical experience in
      `merchandisingPosition` order.

## Desktop behavior

- [ ] Media is presented with an adjacent product panel rather than a
      forced mobile-style takeover.

## Accessibility

- [ ] Video controls (play/pause/mute) are keyboard-operable and
      labeled; captions/transcripts supported where provided.

## Test requirements

- [ ] Integration tests: lifecycle state machine (draft → pending
      moderation → scheduled/published → unpublished, and rejected),
      staff-attribution/audit on every transition, unpublished/
      not-yet-scheduled media never returned to the public read path,
      multi-product tagging and ordering, RBAC enforcement on
      publish/unpublish/moderate actions.
- [ ] Adversarial: a `SCHEDULED` item with a future
      `scheduledPublishAt` is not visible; an item past its schedule
      becomes visible without a manual state change; a `REJECTED` item
      is never visible regardless of `merchandisingPosition`.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
