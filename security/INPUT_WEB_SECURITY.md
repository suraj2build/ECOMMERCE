# Input / Web Application Security Review (M31 Security Hardening, 5D)

Code-level review against this pass's own checklist. Findings that
required a fix are marked **FIXED**; everything else states the
concrete evidence for why the risk does not apply, not just an
assertion.

## Schema validation

Every route in `services/commerce-api` parses its request body/params/
query through a Zod schema before touching business logic (confirmed by
route-file sweep — the same sweep used for `security/PII_DATA_INVENTORY.md`'s
RBAC audit). `test/integration/api-input-failures.test.ts` (13 tests,
pre-existing, re-verified green by this pass) exercises missing
required fields, wrong types, invalid enums, malformed UUIDs, negative
quantities, oversized integers, malformed JSON, oversized bodies, and
unknown fields.

## SQL injection

**No exploitable surface.** Every database access goes through Prisma's
query builder or tagged-template `$queryRaw`/`$executeRaw` (which
Prisma parameterizes `${}` interpolations for automatically) — a
repo-wide grep for `$queryRawUnsafe`/`$executeRawUnsafe` (the only
Prisma APIs that accept raw, unparameterized string concatenation)
returns zero matches anywhere in `src/`.

## XSS

**FIXED — genuine stored XSS found in the storefront's JSON-LD
structured data.** `apps/storefront/src/app/product/[styleId]/page.tsx`
injected `JSON.stringify(structuredData)` directly into a `<script
type="application/ld+json">` via `dangerouslySetInnerHTML`.
`JSON.stringify` does not escape `<`, so a staff-entered product name
(free text, `product:write`-gated but not a hard-coded constant)
containing a literal `</script><script>...` would break out of the
JSON-LD script tag and inject arbitrary HTML/JS, executing in every
visitor's browser on that product page — reachable by any account with
`product:write`, not merely an already-compromised super-admin. Fixed
with `apps/storefront/src/lib/json-ld.ts`'s `safeJsonLd()` — escapes
`<` as `<` (the standard, minimal fix; verified to round-trip the
exact original value through `JSON.parse` while never containing a raw
`</script>` sequence). No other `dangerouslySetInnerHTML` usage exists
anywhere in `apps/storefront` or `apps/admin` (repo-wide grep, zero
other matches).

Every other customer-facing text field (reviews, CMS content, addresses)
is rendered through ordinary React JSX interpolation (`{value}`), which
auto-escapes by design — verified by the absence of any OTHER
`dangerouslySetInnerHTML` call.

## CSRF

**Not applicable to this architecture.** Every authenticated request
(customer and staff alike) carries its credential as a bearer token in
the `Authorization` header (or the M31 CART-004 guest-session header),
never a cookie. A cross-origin form submission or `<img>`/auto-
submitting-form CSRF attack cannot attach a custom header — this is a
structural property of the bearer-token design, not a control bolted on
separately. See `security/SECRETS_CONFIG_AUDIT.md`'s "Insecure cookie
behavior" section for the same conclusion from the cookie-audit angle.

## SSRF

**No exploitable surface.** Every outbound `fetch()` call in
`services/commerce-api` targets a hard-coded or config-defined base URL
(`RAZORPAY_API_BASE`, `MEILISEARCH_HOST`) — a repo-wide grep for a
`fetch()` call whose URL is built from `request.body`/`request.query`/
`request.params` returns zero matches. Nothing in this codebase fetches
an arbitrary client-supplied URL.

## Open redirect

**No exploitable surface — no redirect exists at all.** A repo-wide
grep for `.redirect(` across `services/commerce-api`, `apps/storefront`,
and `apps/admin` returns zero matches.

## Path traversal / upload boundaries

Already hardened by the M19 independent-review repair, re-verified
correct by this pass: `LocalDiskEvidenceStorageProvider.resolvePath`
(`modules/returns/evidence-storage.ts`) validates every object key
against a strict UUID regex BEFORE `path.join`, so a traversal sequence
(`../../etc/passwd`) can never reach the filesystem call even in
principle; keys are always server-generated (`generateEvidenceObjectKey`),
never derived from a client-supplied filename; uploaded content is
MIME-sniffed from its actual magic-number bytes
(`sniffImageMimeType`), never trusted from the client-declared
Content-Type; files are written `0o600` and the storage root is never
registered as a static-file directory by any Fastify plugin — there is
no public URL for any uploaded object at any path.

## Prototype pollution

**Low risk, no specific gap found.** Request bodies are parsed via
Fastify's own JSON parser (not a hand-rolled deep-merge), and every
body is immediately validated/reshaped through a Zod schema before use
— Zod's `.parse()` produces a fresh, schema-shaped object, it does not
merge onto or extend the original parsed object, so a `__proto__`/
`constructor.prototype` key in a request body has no path to influence
any object this codebase actually operates on afterward. No recursive
object-merge utility (the classic prototype-pollution vector) exists
anywhere in `services/commerce-api`'s own code (checked: no lodash
`merge`/`defaultsDeep`, no hand-written deep-merge helper).

## Request-body limits / malformed input

Global JSON body parser (`app.ts`) tolerates an empty body (M15 Fastify
v5 compatibility fix) and returns a clean `400`
(`FST_ERR_CTP_INVALID_JSON_BODY`) on malformed JSON rather than a raw
`SyntaxError`/500 — both re-verified green by
`api-input-failures.test.ts`. `@fastify/multipart` (the only file-
upload path in this API) enforces `RETURN_EVIDENCE_MAX_FILE_SIZE_BYTES`
as a hard transport-level ceiling, independent of `ReturnService`'s own
config-driven size/MIME checks (defence in depth, not a single point of
failure).

## Security headers / CSP / clickjacking / MIME sniffing / referrer policy

Added this pass via `@fastify/helmet` (`plugins/security-headers.ts`):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Strict-Transport-Security`, a conservative `Referrer-Policy`. CSP is
deliberately left off for this API specifically — see that file's own
docblock for why (a pure JSON API has no HTML document to attach a CSP
to; the storefront/admin Next.js apps are the correct place for a real
CSP, not built in this pass — see `security/DEPLOYMENT_READINESS.md`'s
remaining-gaps section for this as an explicit open item). Verified
with real HTTP assertions, not a fake config-constant check —
`test/integration/rate-limiting.test.ts`'s "Security headers (helmet)"
tests actually inspect response headers from a live request.

## Unsafe error leakage

See `security/SECRETS_CONFIG_AUDIT.md`'s "Verbose production errors"
section — `error-handler.ts` never serializes a stack trace or internal
exception detail into an HTTP response body, confirmed by direct code
reading.
