# M11 — PDP Acceptance Criteria

**Spec(s):** `specs/10-pdp.md`
**Status:** IMPLEMENTED (Phase 2 build, 2026-09-23,
`services/commerce-api/src/modules/pdp/`, `apps/storefront/src/app/
product/[styleId]/`, 21 passing backend integration tests + 4 passing
browser E2E tests against a real Chromium instance).

## Business acceptance

- [x] Ratings and reviews are visible and submittable on the PDP.
      Submission requires a customer session; the storefront includes a
      minimal, self-contained mobile-OTP sign-in reusing the real M01
      OTP endpoints (never a fake/stubbed submission) - verified
      end-to-end in a real browser: OTP request → the dev console
      provider's logged code → verify → submit → review persists and
      the rating summary updates from real data.
- [x] PIN-code serviceability can be checked directly from the PDP
      before adding to cart/checking out (IND-002 static-list
      fallback - a real carrier-API check is M16's own scope).
- [x] Displayed availability always reflects the live inventory ledger
      (`InventoryBalance`, aggregated `onHand - reserved` per SKU across
      all locations at request time) — never a stale cache.

## Functional acceptance

- [x] Variant selection (color/size) updates price, images, and
      availability correctly - verified interactively in a real
      browser (colour switch updates the image set and re-filters
      available sizes for that colour).
- [x] Out-of-stock sizes are visibly disabled/marked (greyed,
      strikethrough, `disabled`) in the size selector.
- [x] Size chart displays the version applicable to the product
      (reuses the existing, already-versioned `SizeChart`/
      `SizeChartEntry` models from M02 - PROD-004 - unchanged here).
- [x] Structured data (`Product`, `Offer`, availability, pricing) is
      present and valid - a schema.org `Product` object with a nested
      `Offer` (price, currency, `InStock`/`OutOfStock` availability)
      and, when reviews exist, `AggregateRating`. Verified both by
      parsing the JSON-LD in a Playwright test and via a raw
      (JavaScript-disabled) `curl` fetch showing the same data in the
      initial HTML.

## Negative scenarios / edge cases

1. [x] Attempt to add to bag without selecting a required variant →
   blocked with a clear inline message ("Please select a size before
   adding to bag."), verified in both the vitest-free interactive
   browser check and the Playwright E2E suite.
2. [x] Non-serviceable / unrecognized PIN code entered → clear,
   distinct messaging for "not serviceable" vs. "we don't have data
   for this PIN code yet" - never blocks the rest of the page.
3. [x] All sizes out of stock → PDP still renders correctly (`200`)
   with a clear "Out of stock in all sizes right now" state, not an
   error - covered by both a backend integration test and a real
   browser check.

## Mobile / Desktop behavior

- [x] Image gallery: native horizontal swipe on mobile via CSS
      scroll-snap (no JS gesture library needed), plus a thumbnail
      strip on desktop that scrolls the gallery to the selected image.
- [x] Add-to-bag remains accessible via a sticky bottom bar on mobile.
      **Real bug found and fixed during browser verification**: the
      bar's own container only reserved bottom space for itself, not
      for the rest of the page - at the true end of scroll, the sticky
      bar permanently covered the site footer with no way to reveal it
      (confirmed via real Chromium screenshots before/after). Fixed by
      moving the reserved-space spacer to the true end of the page's
      own content, sized to the bar's height, mobile-only.
- [x] Add-to-bag itself is **not** wired to a real cart call - Cart is
      M12's own milestone, not yet built. Selecting a valid variant and
      tapping "Add to Bag" shows an honest "coming soon" message rather
      than a fake success, exactly the same PDP/Cart-dependency
      discipline M09 used for Watch & Shop.

## SEO

- [x] PDP is server-rendered and indexable - verified via a raw
      `curl` fetch (no browser, no JS execution) showing the product
      name and the JSON-LD `Product` structured data present in the
      initial HTML response.

## Performance expectations

- [ ] PDP LCP meets the `NFR-001` target. **Not yet measured** - same
      reasoning as M09/M10: no representative production imagery/CDN
      exists in any environment this was built in; deferred to the
      Phase 2 end-to-end certification round (§29), which is also when
      full-catalog-scale conditions exist to measure against.

## Test requirements

- [x] Integration tests (21, `test/integration/pdp.test.ts`): PDP
      aggregate read (publishable-gate 404 behavior, availability
      aggregation, size chart, out-of-stock-in-all-sizes rendering),
      reviews (submit, duplicate rejection, out-of-range rating
      rejection, moderation hide/unhide, RBAC), PIN-code serviceability
      (known/unknown/malformed, RBAC), cross-sell (rule-based backfill,
      manual-override ranking, silent-drop of an unpublished override,
      self-reference rejection, RBAC, removal).
- [x] E2E (4, `test/e2e-storefront/pdp.spec.ts`, real Chromium, project
      "storefront"): full desktop browse → variant-select-required
      validation → post-selection "coming soon" state; mobile
      no-horizontal-overflow and footer-reachability (the sticky-bar
      fix above); valid `Product` structured data; zero critical/serious
      automated accessibility violations (axe-core, same
      `wcag2a`+`wcag2aa` tags as Home's M09 scan). The test provisions
      its own real, published product via the same HTTP API a
      merchandiser would use (Category/Size have no admin HTTP surface
      yet - a pre-existing Phase 1 gap, not this milestone's to fix -
      so those two specifically are looked up/created directly via
      Prisma, exactly like the vitest suite's own `seedBrandAndLocation`
      helper).

## Infrastructure fix #2 (found via CI failure investigation)

- [x] **CI seeded the E2E super-admin user *before* the integration
      test step, not after.** Every integration test file truncates
      all tables (`test/helpers/db.ts` `resetDatabase()`, called in
      each file's `beforeAll`) to start from a known-empty state - so
      the first integration test file to run wiped out the seeded
      admin, and by the time the later E2E step tried to log in as
      that admin to provision its own test product, the account no
      longer existed (`401 Unauthorized`). This surfaced as an opaque
      `TypeError: Cannot read properties of undefined (reading
      'skuId')` in CI before `pdp.spec.ts`'s `beforeAll` was hardened
      with an `expectOk()` status-checking helper, which turned it
      into a clear `Staff login failed: 401 Unauthorized` instead. Not
      reproducible locally by re-running `test:e2e` alone (the
      seed step run just before it was never wiped), only by
      reproducing CI's exact step order (integration tests, *then*
      seed, *then* E2E) - confirmed both ways locally before pushing.
      Fixed by moving `.github/workflows/ci.yml`'s "Seed test-relevant
      reference data" step to run after "Integration tests" and before
      "Install Playwright browsers" / "E2E smoke".

## Infrastructure fix #1 (found via real-browser verification, not a
## pre-existing bug report)

- [x] **CORS was entirely unconfigured on commerce-api.** Every earlier
      storefront milestone (M09/M10) only ever fetched server-side from
      Next.js, which isn't subject to CORS - M11 is the first milestone
      with genuinely browser-originated requests (PIN check, review
      submission, OTP request/verify), and all three were silently
      blocked by the browser until this was found and fixed. Added
      `@fastify/cors` (pinned to the `9.x` line - the `11.x` latest
      requires Fastify v5, and this codebase is intentionally still on
      Fastify v4 pending M14's own migration spike) with a
      `CORS_ORIGINS` env var (default `http://localhost:3000`, matching
      the existing dev/CI port convention). Verified with a real
      browser: PIN check, OTP request/verify, and review submission all
      round-trip correctly post-fix.

## Definition of Done

All boxes above checked except PDP-scale LCP measurement, which is
explicitly and consistently deferred (matching M09/M10) to the Phase 2
end-to-end certification round - tracked here, not silently dropped.
