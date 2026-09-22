# M09 — Storefront Foundation Acceptance Criteria

**Spec(s):** `specs/08-storefront.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] The storefront is usable end-to-end on both a mobile viewport
      and a desktop viewport — every page in this milestone's scope
      (layout shell, navigation, header/footer) renders correctly on
      both.
- [ ] No native mobile application exists or is referenced as launch
      scope.

## Functional acceptance

- [ ] Global layout, navigation, header, and footer render correctly
      across the approved browser/device matrix (`NFR-005`).
- [ ] The design system's component foundation is in place and used
      consistently (no ad hoc one-off styling bypassing it).

## Mobile behavior

- [ ] Navigation collapses to a mobile-appropriate pattern; no
      horizontal scroll/overflow on standard mobile viewport widths.

## Desktop behavior

- [ ] Full navigation is usable via keyboard (accessibility baseline,
      `NFR-004`).

## Accessibility

- [ ] WCAG 2.1 AA conformance verified for the layout shell (automated
      scan + manual spot-check).

## Performance expectations

- [ ] Initial page load meets the `NFR-001` LCP target on a
      representative 4G mobile profile.

## Observability

- [ ] Frontend error tracking is wired up from this milestone forward.

## Test requirements

- [ ] Playwright E2E: layout renders correctly at defined mobile and
      desktop breakpoints.
- [ ] Automated accessibility scan integrated into CI.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
