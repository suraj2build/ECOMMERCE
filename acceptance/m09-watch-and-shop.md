# M09 — Watch & Shop Acceptance Criteria

**Spec(s):** `specs/35-watch-and-shop.md`
**Status:** Backend/content-model **IMPLEMENTED** (Phase 2, 2026-09-23,
`services/commerce-api/src/modules/content/`, 17 passing tests). The
full immersive storefront experience (dedicated `/watch-and-shop`
route) is **NOT yet built** — M09 shipped a Home preview strip only
(`apps/storefront/src/components/home/WatchAndShop.tsx`); PDP/Cart
handoff also waits on M11/M12 existing. Tracked to complete alongside
those milestones, not silently dropped.

## Business acceptance

- [x] Staff can create, tag (multiple products per media item),
      schedule, publish, unpublish, and moderate (approve/reject) a
      ShoppableMedia item, each action attributed and audited.
- [x] Only `PUBLISHED` media whose optional schedule window is active
      is ever visible to a customer.
- [x] No fabricated engagement counts (likes/views) are displayed.
- [x] No autonomous AI publishing exists — every lifecycle transition
      traces to a staff actor.

## Functional acceptance

- [x] A ShoppableMedia item supports multiple tagged
      Style/Colour/SKU references with an explicit `sortOrder`.
- [ ] Tapping a tagged product surfaces colour/size selection sourced
      from the same authoritative SKU/price/availability data as PDP
      — never a cached/duplicated copy. **Blocked on M11 PDP existing**;
      the backend already exposes the real Style/Colour/Size references
      needed (`ShoppableMediaTag`), nothing to redo when M11 lands.
- [ ] Wishlist and add-to-bag actions from within Watch & Shop use the
      real Wishlist/Cart services. **Blocked on M12** for the same reason.
- [ ] An out-of-stock size/colour is shown unavailable, matching PDP.
      **Blocked on M11.**
- [x] View / tag-tap / add-to-bag-from-media events are recorded
      (`ContentService.recordEvent`, gated to `PUBLISHED` media only).

## Mobile behavior

- [ ] Feed is an immersive, full-viewport vertical experience in
      `merchandisingPosition` order. **Not yet built** - Home currently
      ships a horizontal preview strip, not the full immersive route.

## Desktop behavior

- [ ] Media is presented with an adjacent product panel rather than a
      forced mobile-style takeover. **Not yet built**, same reason.

## Accessibility

- [ ] Video controls (play/pause/mute) are keyboard-operable and
      labeled; captions/transcripts supported where provided. **Not
      yet applicable** - no video player exists yet (preview strip
      only shows thumbnails); applies once the full route is built.

## Test requirements

- [x] Integration tests: lifecycle state machine (draft → pending
      moderation → scheduled/published → unpublished, and rejected),
      staff-attribution/audit on every transition, unpublished/
      not-yet-scheduled media never returned to the public read path,
      multi-product tagging and ordering, RBAC enforcement on
      publish/unpublish/moderate actions. See
      `test/integration/watch-and-shop.test.ts` (17 tests).
- [x] Adversarial: a `SCHEDULED` item with a future
      `scheduledPublishAt` is not visible; an item past its schedule
      becomes visible without a manual state change; a `REJECTED` item
      is never visible regardless of `merchandisingPosition`.

## Definition of Done

Backend/content-model boxes are checked. The full immersive storefront
experience remains open and must be completed (not silently dropped)
once M11 (PDP) and M12 (Cart/Wishlist) exist to hand off to — tracked
here, not closed early.
