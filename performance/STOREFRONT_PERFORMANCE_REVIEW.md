# Storefront Performance Review (M32 Performance/Scale, 6F)

## Core Web Vitals proxy (real measurement)

See `performance/HOT_PATH_BENCHMARKS.md` for the actual Lighthouse
mobile-simulated-throttling run against a real `next build && next
start` production server: Home LCP 2.2s, PDP LCP 2.1s, both under the
2.5s NFR-001 target, CLS 0 on both, TBT 150-330ms. This is the first
genuine LCP measurement taken anywhere in this codebase's history - see
that document for the full honest scope caveat (single-container
sandbox, simulated throttling, not a field/CDN measurement).

## Bundle size (real `next build` output, this pass)

| Route | First Load JS |
|---|---|
| `/` (Home) | 111 kB |
| `/product/[styleId]` (PDP) | 118 kB |
| `/bag` | 114 kB |
| `/checkout` | 108 kB |
| `/wishlist` | 114 kB |
| Shared baseline (all routes) | 103 kB |

Essentially unchanged from the 2026-09-24 baseline recorded in
`blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` (PDP was 117kB, now 118kB -
the one extra kB is this pass's own `apps/storefront/src/lib/json-ld.ts`
XSS-escaping helper, see `security/INPUT_WEB_SECURITY.md`). No bundle
regression from M26-M31's additions (gift cards, CART-004 guest-session
signing, security headers awareness) - those are all server-side or
tiny client additions.

## Hydration / rendering strategy (unchanged, re-confirmed correct)

Re-confirmed via the build output's own route table: PLP/Home/most
account pages remain static (`○`) or ISR-revalidated
(`/` at 30s), PDP/checkout/order-detail/sitemap remain server-rendered
on demand (`ƒ`) where they must be (per-request personalization or
inventory-freshness requirements, e.g. `sitemap.xml`'s M27 `revalidate
= 0` fix). No route was moved to full client-side rendering or lost its
existing static/ISR classification by any M26-M31 change - build output
route-type table matches the pre-M26 shape.

## Images

All storefront product/media rendering already goes through
`next/image` (7 files use it; zero raw `<img>` tags exist anywhere in
`apps/storefront/src`), giving automatic responsive `srcset`, lazy
loading below the fold, and format negotiation - this was already true
before M32 and required no change; re-confirmed by this pass's own
grep-based audit rather than assumed.

## SEO (M27) - re-confirmed not degraded by any M30-M32 change

`sitemap.xml`/`robots.txt`/canonical tags/`BreadcrumbList` JSON-LD
(M27) are unchanged in behavior by M30 (gift cards), M31 (security
headers, CART-004, rate limiting), or M32's own read-only benchmarking
work. The one M31 change touching an SEO-relevant file
(`safeJsonLd()` escaping in `product/[styleId]/page.tsx`, see
`security/INPUT_WEB_SECURITY.md`) changes ONLY how special characters
are escaped inside the `<script type="application/ld+json">` payload -
the structured data's own field values and presence are byte-for-byte
unchanged for any normal (non-attack-payload) product name, so no
search-engine-visible structured-data regression exists. Security
headers (`security-headers.ts`, `X-Content-Type-Options`,
`X-Frame-Options: SAMEORIGIN`, HSTS) are additive HTTP response headers
with no effect on crawlability or rendered content.

## No change made

This review found no storefront-side performance regression and no
required fix - bundle size, hydration strategy, image handling, and SEO
surface all measured/re-confirmed unchanged or improved (the new real
LCP measurement itself) by this phase's work.
