# P2 — VANYA storefront replacement

Status: IMPLEMENTED; final automated gate is the latest run on PR #2.
Not a production-deployment approval or independent-certification declaration.

## Authorization and design

The Product Owner authorized the AI Studio storefront replacement on
2026-10-02 and instructed continued completion after interruptions.
Design source: `suraj2build/Stitch-Spark_Ai_Studio` at
`24b2399c593ca739bb035293bc81b2cbed036288`; final header reference:
“Vanya Luxury Fashion Header.png”. See `specs/08-storefront.md`.

## Implemented scope

- Department gateway, persisted choice, men/women tokens, Playfair Display/Inter.
- Separate centered VANYA brand row, utility bar, aligned navigation, direct
  mobile search, account/wishlist/bag icons, and actual API-backed counters.
- Home, category/search listings, collections/detail, Watch & Shop, PDP,
  wishlist/bag, checkout/payment confirmation, account, orders and post-purchase
  pages use the existing production APIs and domain logic.
- Superseded presentation components retired; one collection-detail API route.
- Product history restored to authenticated Customer 360; guests are not tracked.
- Selected department preserved in full search, category filters and pagination.
- Search/bag/size-guide/product-preview dialogs trap keyboard focus, close with
  Escape, lock background scrolling and restore their trigger.
- Blocked browser storage does not crash department selection.
- Login and guest merge refresh header identity/counts; failures do not block login.

## Companion repairs already on the resumed branch

This branch also contains P1 manual-adjustment idempotency repairs and M16
warehouse short-pick reservation-allocation release repairs, including the
forward-only `20261002110000_pick_shortfall_allocation_release` migration.
Original reservation quantity is preserved; released allocation is bounded.
All original integrity/concurrency tests remain mandatory.

## Verification

- Local lint, storefront typecheck and diff whitespace checks.
- Actual Chromium screenshots inspected at 320, 390, 768, 1024, 1280 and
  1440 pixels: no horizontal overflow; desktop wordmark sits above navigation;
  navigation and search/actions do not overlap.
- Local Home browser suite: 7 passed against a temporary empty-catalog HTTP
  fixture, covering layout, WCAG serious/critical checks, navigation, focus,
  and retained gender query. The fixture is test-only and is not committed or
  wired into the storefront. Real backend/customer/financial validation is CI.
- GitHub CI runs the production builds, clean database migrations, unit tests,
  full Postgres/Redis/Meilisearch integration suite, and all browser journeys.
  Consult PR #2 checks for the final head SHA and exact results; a green earlier
  commit is not accepted as proof for a later head.
- Account history tests wait for both actual recording responses before checking
  deduplication. Promotions tests target the new semantic empty-bag heading.

## Existing deployment dependencies

Published catalog/media and payment-provider configuration determine actual
content/payment availability. No catalog, payment or loyalty values are mocked
in application code. Existing legal/DPDP content-review dependencies in
`security/DPDP_READINESS.md` remain outside this visual replacement's approval.
The header does not assert the reference's complimentary tailoring/delivery
promotion without an approved business rule. No production deployment is made.
