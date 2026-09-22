# 08. Storefront Foundation

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `SF-001`, `SF-002`, `NFR-004`, `NFR-005`)

## Purpose

Define the foundational storefront application: layout shell,
navigation, responsive/mobile-first framework, and cross-cutting
concerns every storefront page depends on.

## Scope

- Next.js application structure and routing foundation (ADR-0008)
- Global layout, navigation, header/footer
- Mobile-first responsive framework/design system foundation
- Performance and accessibility baseline

## Approved requirements (2026-09-22)

- **Both mobile web and desktop web are required. The UI MUST be fully
  responsive. Native mobile applications are explicitly LATER, not
  launch scope.**
- Single locale at launch (India / English / INR); architecture MUST
  NOT preclude future localization.
- Design system: adopt an accessible, actively-maintained component
  foundation customized with brand/multi-brand design tokens
  (supporting `specs/31-organization-locations.md`'s multi-brand
  requirement) rather than a fully custom build from scratch.
- Accessibility target: WCAG 2.1 AA.
- Browser/device support: last 2 versions of Chrome, Safari, Firefox,
  Edge; current iOS Safari and Android Chrome.
- Performance targets (initial, revisable after M32 load testing): PDP
  LCP < 2.5s on representative 4G mobile; see `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m09-storefront-foundation.md`.

## Dependencies

Foundational for: `specs/09-search-discovery.md`, `specs/10-pdp.md`,
`specs/11-wishlist-cart.md`, `specs/12-checkout.md`, and all other
customer-facing specs.
