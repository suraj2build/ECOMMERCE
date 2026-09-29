# Secrets & Configuration Audit (M31 Security Hardening, 5I)

## Committed secrets

Grepped the working tree and `.env.example` for credential-shaped
strings (`grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9+/_=-]{16,}"`
across every tracked file, excluding `node_modules`/`dist`/`.next`) —
every match is either a `.env.example` placeholder explicitly labeled
`dev-only`/`test-only`/`ci-only` or a test-fixture literal inside
`test/helpers/setup-env.ts`/`.github/workflows/ci.yml`, none of which is
usable against a real Razorpay/production account. **No real secret is
committed anywhere in this repository.** The CI secret-scan step added
by this pass (`gitleaks`, `.github/workflows/ci.yml`) makes this an
ongoing automated check going forward, not a one-time manual read.

## Unsafe default production secrets

- `JWT_ACCESS_SECRET` — **required, no default** (`z.string().min(16)`,
  no `.default()`). A production deployment that forgets to set this
  fails at `loadEnv()` startup rather than silently signing tokens with
  a guessable value.
- `MFA_SECRET_ENCRYPTION_KEY` (new, this pass) — **required, no
  default**, exact-length-validated (64 hex chars). Same fail-safe-on-
  missing-secret discipline.
- `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET` — deliberately default
  to an empty string, but this is a DIFFERENT, intentional pattern (see
  `security/PAYMENT_SECURITY_REVIEW.md`): an empty value makes the
  provider fail safe to an honest "payment unavailable" result, never a
  crash and never a fabricated success. This is not a "weak default
  secret" gap — there is no secret value being defaulted to, only an
  absence that is handled safely.
- **Every other env var with a `.default(...)` in `packages/config/src/index.ts`
  is a genuinely safe engineering default** (TTLs, thresholds, rate
  limits, `CORS_ORIGINS`) — verified by reading the full schema for this
  pass; none of them is a credential.

## Mock providers reachable in production

**Genuine gap found and fixed by this pass.** `getChannelProvider`
(M26 repair) already refused to resolve a `MOCK_*` provider name when
`NODE_ENV=production`, but the exact same risk existed, unguarded, for
`resolveShippingProvider` (`SHIPPING_PROVIDER`, defaults to `'MOCK'`,
no real carrier selected yet — SHIP-001) and `getMarketingProvider`
(`MARKETING_PROVIDER`, defaults to `'MOCK'`, no real vendor selected yet
— MKT-001). Both now carry the identical production guard, added in
this pass (`modules/shipping/provider.ts`, `modules/marketing/provider.ts`)
and adversarially tested (`test/unit/provider-production-guards.test.ts`).
Before this fix, a production deployment that left either env var at
its default (or was simply never told SHIP-001/MKT-001 have no real
integration yet) would have silently "shipped"/"sent" every order or
campaign against a fake provider — no real carrier pickup, no real
SMS/WhatsApp/Email dispatch — with no error, no warning, just a fake
success recorded as if real.

## Permissive CORS

`plugins/cors.ts` allows ONLY the exact origins in `CORS_ORIGINS`
(default `http://localhost:3000,http://localhost:3001` — the storefront
and admin apps' own dev ports) — never a wildcard `*`, never
`origin: true`/reflecting the request's own `Origin` header. A
production deployment sets `CORS_ORIGINS` to its real storefront/admin
domains; there is no code path that widens this beyond the configured
list.

## Insecure cookie behavior

**This application does not use cookies for session/auth state at
all.** Customer auth is a bearer JWT (Authorization header); staff auth
is a bearer session token (Authorization header, resolved against
Redis); the M31 CART-004 guest-session token is likewise a bearer
value in a custom header (`x-guest-session-id`), never a cookie. There
is therefore no `HttpOnly`/`Secure`/`SameSite` cookie configuration to
audit — the entire class of cookie-based session-fixation/CSRF risk
this checklist item usually targets does not apply to this
architecture's session model. (CSRF specifically: a bearer-token-in-
header scheme is inherently CSRF-resistant, since a cross-origin form
submission cannot attach an `Authorization` header — this is a
structural property of the auth design, not a control that was added.)

## Debug endpoints

Grepped every route file for a route matching `/debug`, `/admin/debug`,
`/_internal`, or similar — none exist. `/health` and `/ready` are the
only unauthenticated routes with no business-data surface, and neither
returns anything beyond a status string / dependency ping result.

## Verbose production errors

`plugins/error-handler.ts` was inspected: it returns a generic error
shape (`{ error: { code, message } }`) for every handled error class,
and for an UNHANDLED exception returns a generic 500 message — it does
not serialize a raw stack trace or internal exception detail into the
HTTP response body in any code path. Full error detail (including stack
traces) goes to the structured pino logger only, server-side, consistent
with the payment-provider-error-leakage finding in
`security/PAYMENT_SECURITY_REVIEW.md`.

## Production startup fail-safety

`loadEnv()` (`packages/config/src/index.ts`) parses the FULL environment
schema once at process startup and throws with a readable, itemized
error message on ANY missing/malformed required variable — the process
never starts partially configured. This was true before this pass and
remains true after adding `MFA_SECRET_ENCRYPTION_KEY` as a new required
variable; verified by this pass's own full local-dev boot and full test
suite run (both require the new variable to be present, and both
started/ran successfully once it was added to `.env.example`, CI, and
`test/helpers/setup-env.ts`).
