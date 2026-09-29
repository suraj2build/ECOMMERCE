# Payment Security Review (M31 Security Hardening, 5H)

Re-audit of the existing M14-certified Razorpay integration plus M30's
new gift-card purchase flow, against this pass's own explicit checklist:
webhook signature/replay/idempotency, amount/currency verification,
order/payment binding, environment-separated secrets, provider error
leakage, raw card-data handling.

## Webhook signature verification

`RazorpayPaymentProvider.verifyWebhookSignature`
(`checkout/payment-provider.ts:186`) — HMAC-SHA256 over the raw request
body with the configured `webhookSecret`, compared via
`node:crypto.timingSafeEqual` (constant-time, not `===`) after a
length-equality pre-check. Rejects outright (returns `false`, never
throws) when credentials are unconfigured or the header is missing.
`PaymentService.handleRazorpayWebhook` calls this FIRST, before any
JSON parsing or database write — an unsigned/forged payload never
reaches application logic at all. Verified unchanged from M14's own
certification; re-confirmed correct by this pass's own code reading.

**Genuinely new this pass:** the same additive-correlation dispatch this
codebase already used for Exchange payments (M21) was extended for
gift-card purchases (M30) — `PaymentEvent.giftCardPurchaseId`, checked
only after `paymentId`/`exchangeId` both miss, inside its own try/catch,
never touching the M14-certified `applyOutcome`/`applyCaptureOutcome`
transactions. Re-verified in this pass that the SAME signature check
above still gates ALL three dispatch branches identically — there is no
alternate code path that skips signature verification for a gift-card
or exchange webhook.

## Replay / idempotency

Every inbound webhook is durably recorded in `PaymentEvent` keyed
uniquely on `(provider, providerEventId)` BEFORE any state change is
applied (`recordOrResumeEvent`), and marked `PROCESSED` only after the
resulting outcome is actually applied — an exact duplicate delivery of
an already-processed event is a safe no-op; a duplicate of an event
that was recorded but never finished processing (crash mid-flight)
resumes against the SAME row rather than reprocessing from scratch or
being silently dropped. This is the M14 final-certification-repair
Blocker 2 design, re-verified intact by this pass (`payment.test.ts`'s
own "Payment event processing-state durability and recovery" suite, 10
tests, still green — see the full integration-suite result in the final
report). Gift-card purchase capture reuses this exact mechanism, not a
parallel one.

## Amount/currency verification

`RazorpayPaymentProvider.initiate` computes `amountPaise` from the
SERVER-COMPUTED `input.amount` (the checkout session's own
authoritative `amountPayable`, never a client-supplied number) and
hard-codes `currency: 'INR'` — there is no code path where a client
request can influence the amount or currency sent to Razorpay for order
creation. On the capture side, `applyCaptureOutcome`
(pre-existing, M14-certified, unmodified by this pass) determines the
confirmed amount from the Payment row created at `initiate()` time, not
from anything in the webhook payload itself — a forged webhook claiming
a different amount cannot alter what this system believes was actually
charged for that Payment id.

## Order/payment binding

`Payment.providerReferenceId` holds the Razorpay ORDER id while
in-flight, swapped to the actual PAYMENT id on capture — webhook
correlation always resolves through this column (or the additive
`exchangeId`/`giftCardPurchaseId` siblings), never a client-supplied
identifier. `CheckoutService.retryPayment`'s own ownership check
(`loadOwnedSession`) means a payment retry can only ever be initiated
against a checkout session the calling identity actually owns.

## Environment-separated secrets

`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` are
required-but-empty-by-default config (`packages/config/src/index.ts`) —
never hard-coded, never given a non-empty default. Unconfigured
credentials fail safe to an honest "unavailable" checkout result
(`loadRazorpayCredentials` returning `undefined`), never a crash or a
fabricated success. Genuinely separate values are expected per
environment (dev/CI/staging/production) via each environment's own
`.env`/secret store — `.env.example` ships only placeholder text, never
a real key.

## Provider error leakage

`RazorpayPaymentProvider.initiate` returns a generic customer-facing
message ("We could not start online payment right now...") on any
Razorpay-side failure — the actual HTTP status/response body is logged
server-side only, never surfaced in the API response. **One finding
from this pass:** that server-side log call
(`checkout/payment-provider.ts:175`) uses a bare `console.error(...)`
rather than this codebase's structured, redaction-aware pino logger
(`createLogger`, `packages/shared/src/logger.ts`) — an inconsistency,
not a secret leak (Razorpay's own order-creation error responses are
JSON error codes/descriptions, never payment-instrument data, so
nothing in `security/PII_DATA_INVENTORY.md`'s inventory is exposed by
it) — but it bypasses this codebase's own redaction defence-in-depth
and isn't captured by the same structured-log pipeline as everything
else. **Not fixed in this pass**: `RazorpayPaymentProvider` is
constructed without a Fastify instance (a deliberate, provider-
abstraction-boundary design — it depends only on `loadEnv()`, nothing
Fastify-specific), so wiring in the structured logger would mean
threading a logger through every call site that constructs this
provider — a real, non-trivial refactor of certified M14 code, correctly
out of scope for a single-line log-statement finding under this pass's
own "smallest safe repair" discipline. Recommended follow-up, not
performed here.

## Raw card-data handling

**Confirmed: this application never receives, transmits, stores, or
logs raw card, UPI VPA, or bank-account data anywhere.** Razorpay's
Checkout.js is a HOSTED, provider-rendered payment form — the browser
communicates payment-instrument details directly to Razorpay, never
through this application's own API. Every payment-related model
(`Payment`, `PaymentEvent`, `GiftCardPurchase`) was inspected in this
pass (see `security/PII_DATA_INVENTORY.md`) and carries only Razorpay's
own opaque reference ids and status enums — no card/account field
exists anywhere in the schema. This keeps the application correctly
outside PCI-DSS SAQ A-EP/D scope for card data (a technical
observation, not a PCI compliance certification — formal PCI scope
determination remains an external qualified-review gate, same as
`TAX-001`–`005`).

## Summary

No new vulnerability found in the core webhook/capture/refund
invariants — the M14 certification and its subsequent independent-
review repairs hold under this pass's re-audit, and the M21/M30
additive-correlation extensions were verified not to weaken them. One
minor logging-hygiene finding (documented above, not fixed — see
`security/RUNBOOKS.md`'s "known accepted gaps" if a future pass wants to
close it).
