# M27 — SEO Acceptance Criteria

**Spec(s):** `specs/26-seo.md`
**Status:** BUILT (2026-09-28). Not self-declared certified - awaiting
independent review.

## Business acceptance

- [x] PDP and PLP pages are server-rendered and indexable. The PDP
      (`apps/storefront/src/app/product/[styleId]/page.tsx`) was
      already server-rendered with no client-side initial fetch (M11);
      the home page (PLP) is likewise server-rendered (M09). Unchanged
      by this milestone, confirmed by review.
- [x] Structured data (`Product`, `Offer`, availability, pricing) is
      present (M11) and this milestone adds `BreadcrumbList` alongside
      it - both verified against real schema.org JSON-LD shape in
      `test/e2e-storefront/pdp.spec.ts`.
- [x] A sitemap (`apps/storefront/src/app/sitemap.ts`) is generated and
      kept current as products publish/unpublish - it pages through the
      SAME publish-gated `/storefront/styles` read every other public
      page uses (`getAllPublicStylesForSitemap`), so a draft/unpublished
      style can never appear in it structurally, not just by
      convention. **Fixed during M29's final-validation pass
      (2026-09-28):** the route's own Next.js ISR (an implicit
      build-time static snapshot) could silently serve a stale,
      pre-publish sitemap for up to its revalidate window - genuinely
      reproduced against a real production build/start, not assumed.
      Fixed with `revalidate = 0` plus an uncached fetch, so the route
      is always current; see `SEO-001`'s implementation note in
      `blueprint/DECISION_REGISTER.md`.

## Functional acceptance

- [x] Canonical URLs are set via `alternates.canonical` in
      `generateMetadata` on the PDP. This codebase has no query-param
      faceted/filtered PDP URL variants, so there is no duplicate-
      content ambiguity to resolve beyond the one canonical URL per
      style ID.
- [x] Discontinued/unpublished products return a proper 404, the
      second (not the redirect) branch of this criterion's own
      "either...or." A 301-redirect path was deliberately NOT built:
      `PdpService.getProductDetail`'s existing, already-decided M11
      invariant is that a draft/unpublished style's PUBLIC read path
      "must never let a draft product's existence be distinguished
      from a genuinely unknown one" - a redirect would require exactly
      that distinguishing existence check, directly reversing an
      already-decided invariant this milestone has no authorization to
      change. This codebase also has no category browsing page to
      redirect to. Both are recorded here rather than silently
      guessed; a real category-page build and any relaxation of the
      no-existence-leak invariant are open items for a future,
      separately-authorized pass, not this one's to decide.
- [x] Breadcrumbs render correctly
      (`apps/storefront/src/components/pdp/Breadcrumbs.tsx`) and match
      the unified category taxonomy (`product.categoryName`/
      `categorySlug`, the same fields the PDP itself already resolved
      from `Style.category` since M11).

## Negative scenarios / edge cases

1. A product is unpublished → its PDP returns a proper 404 (proven,
   `test/e2e-storefront/seo.spec.ts`) - no redirect target exists in
   this codebase, and inventing a leaky existence-check endpoint to
   support one would reverse M11's own already-decided invariant (see
   above). Confirmed identical to an unknown/nonexistent ID's 404, so
   no existence information leaks either way.

## Test requirements

- [x] Automated structured-data validation in CI: both `Product` and
      `BreadcrumbList` JSON-LD are parsed and asserted against in
      `test/e2e-storefront/pdp.spec.ts`, which runs in CI's existing
      `npm run test:e2e` step - no separate CI wiring was needed.
- [x] E2E: sitemap contains only published products
      (`test/e2e-storefront/seo.spec.ts`), plus robots.txt
      content and the 404/no-existence-leak negative cases.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
