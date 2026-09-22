# M26 — Social / Channel Publishing Acceptance Criteria

**Spec(s):** `specs/25-social-channel-publishing.md`
**Status:** READY_FOR_IMPLEMENTATION — **adapter/contract architecture
only.** No concrete marketplace integration is in scope for this
milestone.

## Business acceptance

- [ ] The Product Master schema contains **no** marketplace-specific
      fields — verified by code/schema review.
- [ ] A channel adapter contract/interface exists that a future
      concrete integration (Meta, Google Merchant, Amazon, Flipkart,
      Myntra, Ajio, etc.) would implement, with channel-specific field
      mapping expressed as configuration, not core schema changes.

## Functional acceptance

- [ ] A mock/test channel adapter can be registered and produces a
      correctly-mapped feed from core catalog data, proving the
      contract works end-to-end without a real marketplace connection.
- [ ] Publishing status per channel per SKU is tracked (even with zero
      real channels connected, the tracking structure exists and is
      tested against the mock adapter).

## Negative scenarios / edge cases

1. Attempt to add a marketplace-specific field directly to the core
   Product Master schema → this should not be the natural/available
   path in the implemented design (architectural review, not a runtime
   test).

## Explicitly out of scope for this milestone

- Any real connection to Meta, Instagram, Facebook, Google Merchant
  Center, Amazon, Flipkart, Myntra, or Ajio. Building one requires
  separate, explicit milestone authorization.

## Test requirements

- [ ] Integration test: mock adapter registration → feed generation →
      correct field mapping, with no core schema dependency on the
      mock adapter's specifics.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Do not interpret
this milestone's completion as authorization to build a real
integration.
