# Authorization Sweep — IDOR / BOLA / Privilege Escalation (M31 Security Hardening, 5C)

## Method

Every `fastify.(get|post|patch|put|delete)(` registration across all 30
route files in `services/commerce-api/src/modules/*/routes.ts` was
enumerated (`grep -nE "fastify\.(get|post|patch|put|delete)\("`) and
each one's auth configuration inspected directly (single-line matches
read inline; multi-line registrations read with surrounding context).
No route was accepted as "protected" from a comment or a variable name
alone — every `identityAuth`/`readAuth`/`manageAuth`-style local was
traced back to its `fastify.requireStaffAuth`/`requirePermission`/
`requireCustomerAuth`/`tryCustomerAuth` definition.

## Result: every non-public route carries an explicit auth preHandler

No route was found missing authentication or a permission check.
Deliberately PUBLIC (unauthenticated) routes, and why each is correct:

| Route(s) | Why public is correct |
|---|---|
| `GET /health`, `GET /ready` | Infrastructure liveness/readiness probes |
| `POST /storefront/guest-session` | The mechanism BY WHICH a guest identity is established (M31 CART-004) — nothing to authenticate against yet |
| `POST /auth/customer/otp/request`, `/verify`, `/refresh`, `/logout` | The authentication endpoints themselves |
| `POST /auth/staff/login` | Same, staff side |
| `POST /webhooks/razorpay`, `POST /webhooks/shipping/:provider` | Provider-to-server webhooks, authenticated by HMAC signature instead of a bearer token (PAY-002/003, SHIP-005) |
| `GET /storefront/styles`, `/storefront/collections`, `GET /storefront/products/:styleId`, `GET /storefront/search`, `GET /storefront/serviceability` | Public catalog — the entire point of an e-commerce storefront; never exposes a draft/unpublished style (`CatalogService.listPublicStyles` filters server-side) |
| `GET /storefront/cms/*` | Publish-gated CMS content (M29) — public by design, never exposes an unpublished banner/page |
| `GET /storefront/categories`, `/storefront/sizes` | Public reference data (category/size taxonomy), no PII |
| `POST /content/watch-and-shop/:id/events` | Anonymous engagement-analytics ping, no PII, no state mutation beyond a counter |
| `GET /content/watch-and-shop/feed` | Public shoppable-media feed |
| `GET /robots.txt`, `GET /sitemap.xml` (storefront app routes, not commerce-api) | Standard public SEO files |

## Ownership (IDOR/BOLA) verification — beyond route-level auth

Route-level auth alone doesn't stop one authenticated customer from
reading another's order/return/refund/exchange/gift-card-purchase by
guessing an id — that requires a SERVICE-level ownership check on every
customer-facing resource lookup. Spot-verified this pass (in addition
to the extensive pre-existing per-milestone IDOR test suites already
listed in `CLAUDE.md`'s own milestone history — M19 returns, M20
refunds, M21 exchanges, M22 customer-profile, M23 loyalty, M30 gift
cards, all with their own "cross-customer IDOR"/"does not let one
identity read another's X" tests, all re-run green as part of this
pass's full regression):

- `CheckoutService.getCheckoutSession`/`retryPayment` — both call
  `loadOwnedSession(id, identity)` FIRST, before returning or mutating
  anything; a mismatched identity throws, never returns another
  session's data.
- `GiftCardService` staff routes (`GET /gift-cards/:id`, disable,
  adjust, refund-to-gift-card) are staff-RBAC-gated
  (`giftcard:read`/`giftcard:manage`) — there is no customer-facing
  gift-card-by-id lookup route at all (the customer-facing surface is
  purchase-only), so no customer-side IDOR surface exists for this
  resource by construction.
- `resolveCartIdentity` (cart/checkout/order/return/refund/exchange
  routes) is the single choke point every `identityAuth`-gated route
  calls to derive WHO the request is for — a logged-in customer's JWT
  always wins over any guest header (verified by
  `test/unit/cart-identity.test.ts`), so an authenticated customer can
  never accidentally or deliberately operate as a guest identity by
  supplying a guest header alongside their bearer token.

## Horizontal privilege escalation (staff-to-staff)

RBAC is purely permission-based, not role-hierarchy-based — a staff
member with role A and a staff member with role B are isolated from
each other's privileged actions purely by which PERMISSIONS their role
grants (`packages/shared/src/permissions.ts`,
`packages/db/prisma/seed.ts`'s role→permission grants), re-audited as
complete since M01 per M29's own RBAC completeness audit (unchanged by
this pass — no new gap found).

## Vertical privilege escalation (customer-to-staff)

Structurally separated: `request.customer` and `request.staffUser` are
two entirely different decorators, populated by two entirely different
auth mechanisms (`requireCustomerAuth`/`tryCustomerAuth` verify a
customer JWT; `requireStaffAuth` resolves a Redis-backed staff session)
— `auth-security.test.ts`'s existing "rejects a customer JWT used
against a staff-only endpoint" test (re-run green) proves a customer
token is never accepted by a `requireStaffAuth`-gated route.

## Negative tests across the required resource list

`customer`, `address`, `order`, `return`, `refund`, `exchange`, `store
credit`, `loyalty`: covered by each domain's own pre-existing IDOR test
(re-verified green in this pass's full regression run — see the final
report's integration-test count). `gift card`: new this pass, RBAC
negative tests in `test/integration/gift-cards.test.ts` (tests #15/#16
— unauthorized staff cannot issue/disable/adjust; missing
`giftcard:read` cannot view; unauthenticated is rejected). `CMS`,
`channels`, `analytics`, `warehouse`: all staff-RBAC-gated per the
route sweep above, consistent with their own milestone's existing RBAC
tests (M29 CMS, M26 channels, M28 analytics, M16 warehouse). `admin
operations`: covered by M29's own FLOW 19 (a real browser-driven
unauthorized-role 403 against the inventory-adjustment form) and its
adversarial integration-test matrix.

## No new gap found

This sweep did not find a missing authentication check, a missing
permission check, or a service-level ownership gap anywhere in the
current route surface. The genuine findings this pass DID make in the
authorization/session space are recorded separately:
`security/AUTH_SESSION_SECURITY.md` (rate limiting, MFA secret
encryption) and the CART-004 closure
(`blueprint/DECISION_REGISTER.md`).
