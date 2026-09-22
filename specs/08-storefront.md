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

## Lovable UX-reference boundary (`stitch-spark-cart`)

Per `AGENTS.md` §"Lovable — UI exploration / acceleration only,"
the Product Owner has used a Lovable project (`stitch-spark-cart`) to
explore and approve visual direction for Home, PLP, PDP, a
"Watch & Shop" concept, responsive behavior, and design tokens
(colour/type/spacing). This section makes the boundary explicit,
certification-pass, rather than leaving it as an undocumented
assumption:

- **`stitch-spark-cart` is a UX/visual reference only.** It is not
  part of this repository, is not imported as a dependency, and none
  of its code is wired into (or planned to be wired into) the
  production storefront. Nothing in this repository currently
  references it.
- **It is not an architectural or business-logic authority.** Any
  business logic it happens to contain (cart behavior, pricing
  display, checkout flow) has no standing here — this repository's
  approved specs (`specs/07`, `specs/11`, `specs/12`, etc.) and ADRs
  are the sole source of truth for behavior, exactly as `AGENTS.md`
  already requires for any Lovable output.
- **Adaptation path (M09+, not now):** when M09 (Storefront
  Foundation) is separately authorized, the Next.js/React/TypeScript
  application (ADR-0008) will be built from the approved specs using
  this repository's own chosen design-system foundation (see
  "Design system" above). The approved Lovable screens (Home/PLP/PDP,
  responsive layout, design tokens) may be used as a **manual visual
  reference** during that build — reviewed and re-implemented
  deliberately, not copy-pasted — consistent with `AGENTS.md`'s "must
  be reviewed and integrated deliberately" rule. If any concrete asset
  (e.g. a finalized token set) is adopted verbatim, that adoption and
  its provenance must be noted here or in a dedicated ADR at the time,
  per `AGENTS.md` §3.
- **Finding — "Watch & Shop" has no approved spec.** The Lovable
  prototype includes a "Watch & Shop" (shoppable video) concept that
  does not appear in any file under `/specs`. Per `CLAUDE.md` §4, this
  is treated as an unresolved business decision, not an implicit
  approval: **no Watch & Shop feature may be implemented at M09 or any
  later milestone until a dedicated spec is drafted and goes through
  the normal `DRAFT` → `APPROVED` human sign-off.** Its presence in the
  UX reference is not itself authorization to build it.
- This section documents current status only and does **not**
  authorize any M09 implementation work; M09 remains gated on a
  separate, explicit **START BUILD** instruction per `CLAUDE.md` §0.
