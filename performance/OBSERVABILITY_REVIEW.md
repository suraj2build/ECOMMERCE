# Observability Review (M33 Full System E2E + Production-Readiness)

## Method

Read the actual logging/error-handling code path (`app.ts`, the shared
`@fcp/shared` logger, `plugins/error-handler.ts`) rather than assuming
structured logging exists because it "should."

## Structured logging (confirmed, already correct)

Every log line across the entire backend is real, structured JSON
(pino, via `@fcp/shared`'s `createLogger`) - never `console.log` for
application logging (the one `console.error` finding in
`RazorpayPaymentProvider`, a logging-hygiene issue not a structure
issue, is tracked in `security/PAYMENT_SECURITY_REVIEW.md`). Every
request/response is logged automatically by Fastify's own
`loggerInstance` wiring, including method, URL, status code, and
response time - no code anywhere needs to remember to log a request.

## Secret/PII-safe logging (confirmed, already correct - re-verified
## this pass)

`packages/shared/src/logger.ts`'s pino `redact.paths` already covers
the realistic secret-leak surface (`req.headers.authorization`,
`req.headers.cookie` - added M31, `*.password`, `*.token`,
`*.otpCode`, `*.mfaSecret`, `*.giftCardCode` and `*.codeHash` - both
added M30/M31) - re-confirmed by this pass's own grep across every
module for a raw `logger.info/error/warn` call that logs a full request
body or a raw credential; none found. `security/PII_DATA_INVENTORY.md`
covers the PII-masking side of this same concern in full.

## Correlation IDs - genuine gap found and fixed this pass

**Finding**: Fastify's own default `reqId` is a per-process
incrementing counter (`req-1`, `req-2`, ...), not a real correlation
ID - it collides trivially across multiple service replicas (every
replica starts its own counter at 1) and was never exposed as a
response header, so a client, an upstream CDN/WAF, or a support agent
reading an error message had no way to hand this service's own log
line back for a specific request.

**Fixed** (`services/commerce-api/src/app.ts`): a `genReqId` function
now reuses an inbound `x-request-id` header when present (so this
service's logs correlate with whatever edge/gateway layer assigned one
first) and otherwise mints a real `crypto.randomUUID()`; an `onSend`
hook echoes the resolved ID back as the response's own `x-request-id`
header on every request. Verified manually against a live dev server:
a request with no header gets a fresh UUID back; a request carrying
`x-request-id: my-trace-123` gets that exact value echoed. Every
existing request/response log line already includes this value as
`reqId` (Fastify's own default logging behavior, unchanged) - no
logging-call-site changes were needed, only the ID's generation and its
exposure as a response header. Re-ran `order.test.ts` (32 tests) after
the change with zero regressions; the change is additive (a new
`genReqId` function and one `onSend` hook) and touches no existing
route logic.

## Audit trail (pre-existing, re-confirmed sufficient - not part of
## this pass's own logging output, but the durable equivalent for
## business-event observability)

Every authorization denial (`authz.denied`, M29), every financial ledger
mutation (loyalty, store credit, gift card, refund), every staff RBAC
action, and every customer-PII change already writes a durable
`AuditLog` row (actor, action, entity, non-PII change metadata) -
distinct from, and a stronger guarantee than, ephemeral log lines,
since it survives log-retention rotation and is independently
queryable. This pass makes no change here; it was already correct.

## What remains out of scope (correctly, not silently gapped)

No metrics/APM/tracing backend (Prometheus, Datadog, OpenTelemetry
exporter, etc.) exists or is wired up anywhere in this codebase. This
is an honest, documented scope boundary, not a claim of "observability
complete" - structured JSON logs plus the `x-request-id` correlation
this pass adds are sufficient for log-based debugging and support
correlation; a metrics/tracing backend is a genuinely separate,
larger, infrastructure-selection decision (which vendor, which
sampling policy, cost) appropriately deferred to a real production-
deployment decision, not guessed at here.
