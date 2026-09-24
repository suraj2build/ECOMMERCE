# M09 — Storefront Foundation Acceptance Criteria

**Spec(s):** `specs/08-storefront.md`, `specs/35-watch-and-shop.md`
**Status:** Foundation layer (layout/nav/design-system/Home/error
boundaries) **IMPLEMENTED** (Phase 2 build, 2026-09-23). PLP/PDP/Cart/
Checkout pages behind the nav are M10-M13's own scope, not this
milestone's.

## Business acceptance

- [x] The storefront is usable end-to-end on both a mobile viewport
      and a desktop viewport — every page in this milestone's scope
      (layout shell, navigation, header/footer, Home) renders correctly
      on both. Verified with a real Chromium browser (screenshots +
      Playwright, not just code review).
- [x] No native mobile application exists or is referenced as launch
      scope.

## Functional acceptance

- [x] Global layout, navigation, header, and footer render correctly.
- [x] The design system's component foundation (`src/components/ui`,
      `src/styles/tokens.css`) is in place and used consistently - every
      Home module composes from it, no one-off inline styling. One real
      bug caught and fixed here: two Button variants combined via
      className-string concatenation raced on Tailwind's generated
      stylesheet order and made a CTA nearly invisible against the dark
      hero background - fixed by adding proper `inverse`/
      `inverse-outline` variants instead of overriding another
      variant's classes from the call site.

## Mobile behavior

- [x] Navigation collapses to a disclosure menu; Playwright proves no
      horizontal scroll/overflow at a 390px viewport and that the menu
      opens/closes correctly.

## Desktop behavior

- [x] Full navigation is usable via keyboard - skip-to-content link is
      the first focusable element (Playwright-verified); all nav/CTA
      links are real `<a>`/`<Link>` elements, never a `<div>` with a
      click handler.

## Accessibility

- [x] WCAG 2.1 AA: automated axe-core scan (`test/e2e-storefront/home.spec.ts`,
      tags `wcag2a`+`wcag2aa`) integrated into CI, zero critical/serious
      violations on Home. Manual spot-check: visible focus rings,
      `prefers-reduced-motion` support, 44px minimum touch targets,
      `jsx-a11y` ESLint rules enabled for `apps/storefront`.

## Performance expectations

- [ ] Initial page load meets the `NFR-001` LCP target on a
      representative 4G mobile profile. **PRODUCTION_VERIFICATION_REQUIRED**
      - Home currently has minimal real imagery (no seeded product/media
      data in any environment this was built in); a meaningful LCP
      measurement needs representative content. **Honesty correction
      (2026-09-24 certification repair, finding #7):** this was
      originally deferred to "the Phase 2 end-to-end certification
      round," which subsequently ran and did not measure it either - no
      LCP measurement of any kind has been taken for this milestone.
      See `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` for the honest
      status of every performance target and M32 (Performance/Load,
      not yet authorized) as the actual milestone responsible for this.

## Observability

- [x] Frontend error tracking is wired up: `app/error.tsx` (route-level)
      and `app/global-error.tsx` (root-layout-level) report through a
      single structured `console.error` call site each - a real
      APM/error-tracking provider is a one-line swap at those two sites
      once credentials exist, not a search-and-replace later.

## Test requirements

- [x] Playwright E2E: layout renders correctly at defined mobile
      (390px) and desktop (1440px) breakpoints
      (`test/e2e-storefront/home.spec.ts`, "storefront" project in
      `playwright.config.ts`; CI builds and starts both commerce-api
      and the storefront before running it).
- [x] Automated accessibility scan integrated into CI (same test file,
      `@axe-core/playwright`).

## Definition of Done

Foundation-layer boxes above are checked. The LCP measurement this
document originally deferred to "the Phase 2 certification round" was
not performed there either (2026-09-24 certification repair, finding
#7) - it now genuinely awaits M32 (Performance/Load), not yet
authorized. See `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` and
`acceptance/README.md`.
