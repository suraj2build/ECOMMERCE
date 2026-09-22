# M11 — PDP Acceptance Criteria

**Spec(s):** `specs/10-pdp.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Ratings and reviews are visible and submittable on the PDP.
- [ ] PIN-code serviceability can be checked directly from the PDP
      before adding to cart/checking out.
- [ ] Displayed availability always reflects the live inventory ledger
      — never a stale cache showing a sold-out item as in stock.

## Functional acceptance

- [ ] Variant selection (color/size) updates price, images, and
      availability correctly.
- [ ] Out-of-stock sizes are visibly disabled/marked in the size
      selector.
- [ ] Size chart displays the version applicable to the product,
      correctly per category/gender/brand.
- [ ] Structured data (`Product`, `Offer`, availability, pricing) is
      present and valid (schema.org validation passes).

## Negative scenarios / edge cases

1. Attempt to add to cart without selecting a required variant →
   blocked with a clear inline message.
2. Non-serviceable PIN code entered → clear messaging, does not block
   the rest of page browsing.
3. All sizes out of stock → PDP still renders correctly with a clear
   "out of stock" state, not an error.

## Mobile / Desktop behavior

- [ ] Image gallery supports swipe on mobile and thumbnail navigation
      on desktop.
- [ ] Add-to-cart action remains accessible (e.g., sticky bar pattern)
      on mobile without excessive scrolling.

## SEO

- [ ] PDP is server-rendered and indexable (verified via a
      JavaScript-disabled fetch showing full content).

## Performance expectations

- [ ] PDP LCP meets the `NFR-001` target.

## Test requirements

- [ ] Integration tests: variant selection updates correctly.
- [ ] E2E: full PDP browse → variant select → add-to-cart flow, on both
      mobile and desktop viewports.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
