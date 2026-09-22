# ADR-0008: Next.js + React + TypeScript for storefront, TypeScript platform-wide

## Status
Accepted

## Context
The storefront must be mobile-first, responsive, SEO-capable
(server-rendered/indexable product content — see `ARCHITECTURE.md`
§8), and maintainable by AI engineering agents working primarily
through static analysis and types. A separate admin experience is
also anticipated. The backend/commerce kernel (Medusa v2, ADR-0003) is
also TypeScript-native.

## Decision
- Storefront: **Next.js + React + TypeScript**, mobile-first
  responsive design, with server-side rendering/static generation used
  where needed for SEO.
- A separate admin experience where appropriate (not necessarily the
  same Next.js app as the storefront, but consistent stack).
- **TypeScript** is the standard language across frontend, custom
  backend services, and tooling — not just the storefront.

## Reasoning
- Next.js provides the SSR/SSG capabilities required for the
  SEO-as-architecture requirement (product pages, structured data,
  sitemaps) without bolting on a separate rendering layer.
- A single language (TypeScript) across the stack reduces context-
  switching cost for both human and AI contributors, and aligns with
  Medusa v2's own TypeScript foundation (ADR-0003), allowing shared
  types between backend and frontend where useful.
- React's ecosystem maturity supports the long-term UI complexity
  implied by PLP/PDP/cart/checkout/admin surfaces.

## Consequences
- Any new service or script in this repository defaults to
  TypeScript unless there's a specific, documented reason otherwise.
- SEO requirements (`specs/26-seo.md`) must be designed against
  Next.js's rendering model from the start (M08 Storefront Foundation),
  not retrofitted later.
- Admin UI architecture (separate app vs. shared app with route
  separation) is deferred to `specs/28-admin.md`.
