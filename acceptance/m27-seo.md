# M27 — SEO Acceptance Criteria

**Spec(s):** `specs/26-seo.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] PDP and PLP pages are server-rendered and indexable.
- [ ] Structured data (`Product`, `Offer`, availability, pricing) is
      present and passes schema.org validation.
- [ ] A sitemap is generated and kept current as products
      publish/unpublish.

## Functional acceptance

- [ ] Canonical URLs are set correctly (no duplicate-content ambiguity
      between category-filtered URL variants).
- [ ] Discontinued/unpublished products 301-redirect rather than
      404ing where a sensible target exists.
- [ ] Breadcrumbs render correctly and match the unified category
      taxonomy.

## Negative scenarios / edge cases

1. A product is unpublished → its PDP either 301s to a sensible
   category page or returns a proper 404 (not a broken/empty 200
   page).

## Test requirements

- [ ] Automated structured-data validation in CI.
- [ ] E2E: sitemap contains only published products.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
