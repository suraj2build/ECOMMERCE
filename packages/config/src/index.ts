import { z } from 'zod';

/**
 * Environment variable schema. Fails fast on startup if a required
 * variable is missing or malformed, rather than failing confusingly
 * later at first use. See CLAUDE.md §8 / SECURITY.md §3 - no defaults
 * for secrets, only for genuinely safe local-dev conveniences.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Database ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- Redis (sessions, cache, future jobs - ADR-0005) ---
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // --- Search (ADR-0006) ---
  MEILISEARCH_HOST: z.string().default('http://localhost:7700'),
  MEILISEARCH_API_KEY: z.string().optional(),

  // --- Object storage (ADR-0007) ---
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('product-media'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // --- Auth (AUTH-001/002/003) ---
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  // M31 Security Hardening (5F/5I) - encrypts StaffUser.mfaSecret (a TOTP
  // seed - a real credential, not merely a reference id) at rest. The
  // schema's own long-standing column comment claimed this was already
  // "encrypted at rest by application layer" - a genuine finding this
  // pass caught: no such encryption was ever actually implemented, the
  // secret was written to the database as plain text. Required, no
  // default (the same "no defaults for real secrets" discipline as
  // JWT_ACCESS_SECRET) - exactly 32 bytes once hex-decoded, the key size
  // AES-256-GCM requires (see modules/auth/mfa-secret-crypto.ts).
  MFA_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MFA_SECRET_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30 days
  STAFF_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800), // 8 hours

  // --- OTP (AUTH-001, IND-001) ---
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300), // 5 min
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_LENGTH: z.coerce.number().int().positive().default(6),

  // --- Inventory (INV-002) ---
  INVENTORY_RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min, configurable per INV-002

  // --- Approval thresholds (PO-001, ADM-003) ---
  PO_APPROVAL_THRESHOLD_INR: z.coerce.number().nonnegative().default(50_000),
  INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS: z.coerce.number().int().nonnegative().default(50),

  // --- GRN / QC thresholds (GRN-002, GRN-004) ---
  GRN_EXCESS_TOLERANCE_PERCENT: z.coerce.number().nonnegative().default(0), // 0 = any excess over ordered qty is flagged
  GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS: z.coerce.number().int().nonnegative().default(20),

  // --- Service ---
  PORT: z.coerce.number().int().positive().default(4000),
  // Number of reverse-proxy hops in front of the API whose
  // X-Forwarded-For entries are trusted. request.ip (used for per-IP rate
  // limiting and audit) is the address that many hops back, so
  // client-supplied X-Forwarded-For prefixes are ignored. 1 = one load
  // balancer in front; set to the real hop count (e.g. CDN + LB = 2) in
  // production; 0 = trust no proxy (use the socket address).
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- CORS (M11 - the storefront's client-side PIN-check/review/OTP
  // calls are the first browser-originated requests this API serves;
  // everything before M11 was server-side-only fetching, which isn't
  // subject to CORS). Comma-separated allowed origins. localhost:3001
  // added at M29 for apps/admin's own client-side fetches (login,
  // CMS/inventory-adjustment/support/channel/analytics calls).
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  // --- Wishlist / Cart (M12, CART-001/002) ---
  CART_GUEST_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CART_MAX_QUANTITY_PER_SKU: z.coerce.number().int().positive().default(10),

  // --- Checkout / Payment (M13, CHK-003, PAY-001 COD value cap) ---
  SHIPPING_DEFAULT_FLAT_AMOUNT: z.coerce.number().nonnegative().default(99),
  SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD: z.coerce.number().nonnegative().default(1999),
  // The two amounts above are engineering defaults until the business
  // confirms them; only then are they published as structured data (LR-002).
  SHIPPING_RATES_CONFIRMED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  COD_MAX_ORDER_VALUE_INR: z.coerce.number().positive().default(5000),

  // --- Auth rate limiting (M31 5B/5E) test/E2E override ---
  // The OTP-request/verify and staff-login rate limits (auth/routes.ts)
  // are keyed by IP+identifier, so a real multi-spec Playwright E2E run
  // from ONE host reusing ONE shared seeded identity (the same super
  // admin, across ~10 independent storefront specs) legitimately
  // collapses into one bucket and trips the limit - a real M33 finding
  // (see auth/routes.ts's own comment). Unset (the default, every
  // environment including production and the adversarial
  // rate-limiting.test.ts suite) leaves each route's real security
  // limit untouched; set ONLY by the E2E CI/local step (never globally,
  // never in production) to a generous ceiling for that one run's own
  // legitimate reuse pattern - the exact same "explicit, narrow,
  // test-environment-only override" idiom COD_MAX_ORDER_VALUE_INR above
  // already established.
  AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX: z.coerce.number().int().positive().optional(),

  // --- Guest session credential (CART-004, M31 certification repair) ---
  // The guest-session token is a bearer credential for a guest's cart,
  // wishlist, checkout and guest orders, signed with its OWN secret
  // (never JWT_ACCESS_SECRET, so the two credential types can never be
  // confused or share a compromise). Required in production (see the
  // production guards below); outside production, when unset, a key is
  // derived from JWT_ACCESS_SECRET with a fixed domain-separation label
  // so dev/test setups need no new variable.
  GUEST_SESSION_SIGNING_SECRET: z.string().min(32, 'GUEST_SESSION_SIGNING_SECRET must be at least 32 characters').optional(),
  // Credential lifetime, enforced server-side from the token's own
  // authenticated expiry. This is a SECURITY TTL for the bearer token,
  // not a data-retention period (CUST-001 remains UNDER_REVIEW and is
  // untouched): an expired token simply stops authenticating; no cart,
  // order or guest data is deleted. Default 30 days, the same lifetime
  // this codebase already uses for customer refresh tokens
  // (JWT_REFRESH_TTL_SECONDS). Active guests renew before expiry via
  // POST /storefront/guest-session/renew, which keeps the same guest owner.
  GUEST_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  // Per-IP ceiling on minting brand-new guest identities (each one is a
  // fresh credential). Renewal of an existing valid token is keyed by
  // its verified owner instead, so it never consumes this budget.
  GUEST_SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  // Dev/test-only compatibility: accept a raw, unsigned client-supplied
  // guest id (every pre-existing integration fixture uses one). Defaults
  // to enabled outside production and disabled in production; explicitly
  // enabling it in production is a hard startup error (see below).
  GUEST_SESSION_ALLOW_UNSIGNED: z.enum(['true', 'false']).optional(),

  // --- Razorpay (M14, ADR-0011, PAY-001/002/003/005) ---
  // Deliberately optional with an empty-string default, never required:
  // when absent, RazorpayPaymentProvider fails safe to an honest
  // "unavailable" result (the same TaxConfigurationError-style
  // fail-safe-when-unconfigured discipline as M08's tax engine) rather
  // than crashing the whole service at startup. Real credentials are
  // operational configuration, never guessed or hard-coded.
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  PAYMENT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900), // 15 min, matches the reservation TTL default (PAY-005)
  PAYMENT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(3),

  // --- Shipping / Tracking (M17, ADR-0020, specs/16-shipping-tracking.md) ---
  // No launch carrier is selected yet (SHIP-001) - MOCK is the only
  // registered provider until a real carrier integration is built; see
  // ShippingProvider/resolveShippingProvider. SHIP-004: configurable
  // redelivery-attempt count before a shipment is marked RTO, engineering
  // default 2 - business behaviour, never hard-coded.
  SHIPPING_PROVIDER: z.string().default('MOCK'),
  SHIPPING_MAX_REDELIVERY_ATTEMPTS: z.coerce.number().int().nonnegative().default(2),

  // --- Returns (M19, specs/18-returns.md, RET-001) ---
  // Platform-wide fallback used only when no ReturnPolicy row overrides a
  // given style/category - "MUST be configurable by category/product, not
  // one global hard-coded policy" (RET-001); this is the configurable
  // baseline, never hard-coded into ReturnService's own logic.
  RETURN_WINDOW_DEFAULT_DAYS: z.coerce.number().int().positive().default(7),

  // --- Exchanges (M21, specs/20-exchanges.md, EXC-002) ---
  // How long a replacement SKU's reservation is held awaiting the
  // original item's receipt+QC before ExchangeService treats it as
  // REPLACEMENT_UNAVAILABLE (acceptance/m21-exchanges.md negative
  // scenario #2: "hold reservation for a bounded window") - deliberately
  // far longer than INVENTORY_RESERVATION_TTL_SECONDS's checkout-session
  // default, since an exchange's original item genuinely takes days to
  // travel back, not minutes. The 14-calendar-day default is an EXPLICIT
  // Product Owner decision (Post-Purchase Phase independent-review
  // repair, 2026-09-26 - see EXC-004 in blueprint/DECISION_REGISTER.md),
  // not an engineering default - it remains configurable here, and MUST
  // NOT be silently changed without a corresponding Product Owner
  // decision recorded the same way.
  EXCHANGE_REPLACEMENT_HOLD_DAYS: z.coerce.number().int().positive().default(14),

  // --- Return evidence (M19 independent-review repair, finding 2) ---
  // Config-driven per ReturnPolicy.evidenceRequired - these are the
  // platform-wide upload constraints, never per-request client input.
  // No usable S3/MinIO object-storage client existed anywhere in this
  // codebase before this repair (ADR-0007 only ever scaffolded the
  // config/docker-compose service, never a client) and no MinIO instance
  // is reachable in CI/this sandbox - RETURN_EVIDENCE_STORAGE_DIR is a
  // private, non-statically-served local-disk directory (the minimum
  // provider abstraction this pass actually needs and can test for
  // real), never served directly by any route.
  RETURN_EVIDENCE_STORAGE_DIR: z.string().default('var/return-evidence'),
  // LR-005: where return-evidence photos are kept. 'local' (the directory
  // above) is for development and tests only and is refused in production;
  // 's3' writes private objects to RETURN_EVIDENCE_S3_BUCKET through the
  // S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY settings above.
  RETURN_EVIDENCE_STORAGE: z.enum(['local', 's3']).default('local'),
  RETURN_EVIDENCE_S3_BUCKET: z.string().min(3).default('return-evidence'),
  RETURN_EVIDENCE_S3_PREFIX: z.string().default('return-evidence/'),
  RETURN_EVIDENCE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(5_242_880), // 5 MiB
  RETURN_EVIDENCE_ALLOWED_MIME_TYPES: z.string().default('image/jpeg,image/png,image/webp'),
  RETURN_EVIDENCE_MAX_FILES_PER_LINE: z.coerce.number().int().positive().default(6),

  // --- Refunds (M20 independent-review repair, finding 4) ---
  // Age-based recovery cutoff for a Refund stuck in PROCESSING (the
  // in-flight CAS-claimed status - see RefundStatus's own schema
  // comment) because the process that claimed it crashed before ever
  // reaching the terminal claim - same "stale after N seconds is safe to
  // reclaim" idiom as PAYMENT_TIMEOUT_SECONDS/expireStalePayments.
  REFUND_PROCESSING_STALE_SECONDS: z.coerce.number().int().positive().default(300), // 5 min

  // --- Customer 360 (M22, specs/21-customer-profile.md) ---
  // Bounds the "recently viewed products" log per customer - product-
  // behavior storage bounding (never grow unbounded), NOT a stand-in for
  // the still-UNDER_REVIEW CUST-001 legal data-retention policy. A
  // conservative, configurable engineering default, not a compliance
  // conclusion.
  RECENTLY_VIEWED_MAX_ITEMS: z.coerce.number().int().positive().default(50),
  // M22 certification-repair (finding 2): the count bound above alone
  // does not age entries out over time - a customer who views fewer than
  // RECENTLY_VIEWED_MAX_ITEMS products could otherwise keep an
  // arbitrarily old view in the list forever. This is a SEPARATE,
  // ALSO-configurable engineering bound on how long a view is
  // considered "recent" for display purposes - still product-behavior
  // storage bounding, NOT a resolution of CUST-001/AUD-002 (data
  // retention/deletion policy), which remain UNDER_REVIEW. A
  // conservative 90-day default.
  RECENTLY_VIEWED_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // --- Loyalty (M23, specs/22-loyalty.md, LOY-002/003/004) ---
  // Every rate/threshold below is an intentionally CONFIGURABLE
  // engineering default (LOY-002/003 explicitly: "no fixed commercial
  // percentage/rate is invented here") - never a Product Owner-approved
  // commercial policy. Real launch economics require a separate,
  // explicit business decision before these are changed in production.
  //
  // Points earned per 100 (integer) currency-minor-units-free INR spent
  // on the qualifying (pre-tax, pre-shipping) order subtotal - default
  // "1 point per Rs.100" is a conservative, illustrative rate.
  LOYALTY_EARN_POINTS_PER_100_INR: z.coerce.number().int().nonnegative().default(1),
  // Redemption conversion: each point is worth this many paise (1/100
  // INR) when redeemed - default 25 paise/point (4 points = Rs.1).
  LOYALTY_REDEMPTION_PAISE_PER_POINT: z.coerce.number().int().positive().default(25),
  // A redemption action must draw at least this many points at once.
  LOYALTY_MIN_REDEMPTION_POINTS: z.coerce.number().int().positive().default(100),
  // Per-order ceiling on points redeemable in a single checkout.
  LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER: z.coerce.number().int().positive().default(2000),
  // Points expire this many days after they were earned (LOY-004:
  // "MUST be configurable" - explicitly contrasted with store credit,
  // which never expires, REF-002).
  LOYALTY_POINTS_EXPIRY_DAYS: z.coerce.number().int().positive().default(365),

  // --- Promotions (M24, specs/23-promotions.md, TAX-006) ---
  // Pre-tax by default (common practice) - a configurable computation
  // flag so it can be switched post-TAX-001-verification, per TAX-006's
  // own explicit decision. Never a per-promotion setting - this is a
  // single system-wide invoice-presentation/compliance flag, not a
  // marketing parameter.
  PROMOTIONS_DISCOUNT_PRETAX: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // --- Marketing (M25, specs/24-marketing.md, MKT-001) ---
  // Provider abstraction, same pattern as SHIPPING_PROVIDER/PAYMENT_PROVIDER
  // - marketing/notification logic never couples to one messaging vendor's
  // SDK directly. No launch provider selected (MKT-001: "deferred to
  // operational decision") - the only implementation shipped is MOCK, a
  // genuine deterministic test/reference double, never presented as a
  // production SMS/WhatsApp/Email/Push integration.
  MARKETING_PROVIDER: z.string().default('MOCK'),
  // A campaign stuck in SENDING for longer than this (the process that
  // claimed it crashed mid-send) is safe to reclaim - the same age-based
  // recovery idiom RefundService.claimProcessing/PaymentService.
  // expireStalePayments already established.
  MARKETING_SENDING_STALE_SECONDS: z.coerce.number().int().positive().default(600),
  // M25 independent-review certification-repair (Blocker 4): a single
  // recipient's CampaignDelivery claim (PENDING) stuck longer than this
  // (the process that claimed it crashed between the provider call and
  // recording SENT/FAILED) is reclaimed as
  // AMBIGUOUS_RECONCILIATION_REQUIRED, never silently retried - a
  // shorter window than MARKETING_SENDING_STALE_SECONDS since a single
  // provider call should complete far faster than an entire campaign send.
  MARKETING_DELIVERY_STALE_SECONDS: z.coerce.number().int().positive().default(120),

  // --- Channel Publishing (M26, specs/25-social-channel-publishing.md,
  // CHAN-001) independent-review certification repair (2026-09-28) ---
  // A ChannelListing stuck in PROCESSING (the durable in-flight claim
  // taken before any external provider call - see ChannelListingStatus's
  // own schema comment) for longer than this is safe to reclaim into
  // AMBIGUOUS_RECONCILIATION_REQUIRED - the process that claimed it
  // crashed somewhere between the provider call and recording an
  // outcome. Mirrors REFUND_PROCESSING_STALE_SECONDS's exact idiom; a
  // single publish/unpublish provider call is expected to complete on a
  // similar timescale to a single refund settlement, not an entire
  // campaign send, hence the same 5-minute default rather than
  // MARKETING_SENDING_STALE_SECONDS's longer window.
  CHANNEL_PUBLISH_STALE_SECONDS: z.coerce.number().int().positive().default(300), // 5 min

  // --- Storefront product-page cache ---
  // The storefront caches each public product page for up to 30 seconds.
  // After a publish, unpublish, archive, media or price change the API
  // asks the storefront to drop that page (apps/storefront
  // /api/revalidate/product) so the change shows on the next request.
  // Unset: no call is made and pages refresh within 30 seconds instead.
  // The secret must match the storefront's STOREFRONT_REVALIDATE_SECRET.
  STOREFRONT_REVALIDATE_URL: z.string().url().optional(),
  STOREFRONT_REVALIDATE_SECRET: z.string().min(32, 'STOREFRONT_REVALIDATE_SECRET must be at least 32 characters').optional(),

  // --- Server-side conversion events (LR-003) ---
  // Each integration is off until its credentials are set. Secrets stay
  // server-side; the storefront only ever gets the public IDs.
  GA4_MEASUREMENT_ID: z.string().regex(/^G-[A-Z0-9]+$/, 'GA4_MEASUREMENT_ID must look like G-XXXXXXX').optional(),
  GA4_API_SECRET: z.string().min(8).optional(),
  // Measurement Protocol endpoint; /debug/mp/collect validates without recording.
  GA4_MP_URL: z.string().url().default('https://www.google-analytics.com/mp/collect'),
  META_PIXEL_ID: z.string().regex(/^[0-9]{5,20}$/, 'META_PIXEL_ID must be the numeric dataset/pixel ID').optional(),
  META_CAPI_ACCESS_TOKEN: z.string().min(20).optional(),
  // Routes events to Events Manager's "Test events" view instead of live data.
  META_TEST_EVENT_CODE: z.string().min(1).max(64).optional(),
  META_GRAPH_URL: z.string().url().default('https://graph.facebook.com/v21.0'),
  // Public storefront origin, used as Meta's event_source_url and for feed product links.
  STOREFRONT_PUBLIC_URL: z.string().url().optional(),
  // --- Product feeds (LR-004). A channel using a real provider fails with a
  // clear error until its credentials are set. ---
  GOOGLE_MERCHANT_ACCOUNT_ID: z.string().regex(/^[0-9]+$/).optional(),
  // The Merchant API data source the products are written to (an API data source).
  GOOGLE_MERCHANT_DATA_SOURCE_ID: z.string().regex(/^[0-9]+$/).optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  // PEM private key of the service account; literal \n sequences are accepted.
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_MERCHANT_API_URL: z.string().url().default('https://merchantapi.googleapis.com'),
  GOOGLE_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  META_CATALOG_ID: z.string().regex(/^[0-9]+$/).optional(),
  // Needs catalog_management on the catalogue; separate from the Conversions API token.
  META_CATALOG_ACCESS_TOKEN: z.string().min(20).optional(),
  // LR-006 scheduler: how often feeds are resynced, how long run history is kept.
  CHANNEL_RESYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  MAINTENANCE_RUN_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // A running job's lease; renewed every third of it while the job runs.
  // An instance that dies mid-job loses the lease after this long and
  // another instance runs the job.
  MAINTENANCE_LEASE_SECONDS: z.coerce.number().int().min(10).default(120),
  // Where a failing-job alert (three failures in a row) and its recovery
  // are POSTed as JSON with a `text` field (Slack, Google Chat and most
  // incident tools accept this). The URL is a secret: it is never logged.
  MAINTENANCE_ALERT_WEBHOOK_URL: z.string().url().optional(),
  // Production refuses to start without MAINTENANCE_ALERT_WEBHOOK_URL
  // unless this explicitly says alerts are picked up from the logs
  // (alert: true at error level) by the host's own log alerting.
  MAINTENANCE_ALERT_LOG_ONLY: z.enum(['true', 'false']).default('false'),
  CHANNEL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  CONVERSION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  // A SENDING claim older than this belongs to a crashed dispatcher.
  CONVERSION_SENDING_STALE_SECONDS: z.coerce.number().int().positive().default(300),
  CONVERSION_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

const PLACEHOLDER_SECRET_MARKERS = ['change-me', 'changeme', 'ci-only', 'test-only', 'dev-only', 'placeholder', 'example', 'replace-me'];

function looksLikePlaceholderSecret(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_SECRET_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * A genuinely random 64-hex-char key uses ~16 distinct hex digits; the
 * repeated-pattern placeholders used in .env.example / CI / tests
 * (c1c1..., aaaa...) use one or two.
 */
function looksLikeLowEntropyHexKey(value: string): boolean {
  return new Set(value.toLowerCase()).size < 10;
}

/**
 * Production-only guards (M31 certification repair): refuse to boot with
 * a placeholder/low-entropy secret, a missing or shared guest-session
 * signing secret, or a test-only relaxation switched on. Outside
 * production none of these apply, so local dev/test/CI keep working with
 * their documented placeholders.
 */
const validatedEnvSchema = envSchema
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (env.STOREFRONT_REVALIDATE_URL && !env.STOREFRONT_REVALIDATE_SECRET) {
      fail('STOREFRONT_REVALIDATE_SECRET', 'is required when STOREFRONT_REVALIDATE_URL is set');
    }

    if (Boolean(env.GA4_MEASUREMENT_ID) !== Boolean(env.GA4_API_SECRET)) {
      fail('GA4_API_SECRET', 'is required whenever GA4_MEASUREMENT_ID is set, and the other way round');
    }
    if (Boolean(env.META_PIXEL_ID) !== Boolean(env.META_CAPI_ACCESS_TOKEN)) {
      fail('META_CAPI_ACCESS_TOKEN', 'is required whenever META_PIXEL_ID is set, and the other way round');
    }
    if (env.META_PIXEL_ID && !env.STOREFRONT_PUBLIC_URL) {
      fail('STOREFRONT_PUBLIC_URL', 'is required for the Meta Conversions API (event_source_url)');
    }

    if (env.NODE_ENV !== 'production') return;

    if (env.STOREFRONT_REVALIDATE_SECRET && looksLikePlaceholderSecret(env.STOREFRONT_REVALIDATE_SECRET)) {
      fail('STOREFRONT_REVALIDATE_SECRET', 'must be a real secret in production, not a placeholder');
    }

    if (looksLikePlaceholderSecret(env.JWT_ACCESS_SECRET)) {
      fail('JWT_ACCESS_SECRET', 'must be a real secret in production, not a placeholder');
    }
    if (looksLikeLowEntropyHexKey(env.MFA_SECRET_ENCRYPTION_KEY)) {
      fail('MFA_SECRET_ENCRYPTION_KEY', 'must be a randomly generated key in production (e.g. openssl rand -hex 32), not a repeated-pattern placeholder');
    }
    if (!env.GUEST_SESSION_SIGNING_SECRET) {
      fail('GUEST_SESSION_SIGNING_SECRET', 'is required in production');
    } else {
      if (env.GUEST_SESSION_SIGNING_SECRET === env.JWT_ACCESS_SECRET) {
        fail('GUEST_SESSION_SIGNING_SECRET', 'must differ from JWT_ACCESS_SECRET');
      }
      if (looksLikePlaceholderSecret(env.GUEST_SESSION_SIGNING_SECRET)) {
        fail('GUEST_SESSION_SIGNING_SECRET', 'must be a real secret in production, not a placeholder');
      }
    }
    if (env.GUEST_SESSION_ALLOW_UNSIGNED === 'true') {
      fail('GUEST_SESSION_ALLOW_UNSIGNED', 'unsigned guest identities can never be enabled in production');
    }
    if (env.AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX !== undefined) {
      fail('AUTH_RATE_LIMIT_E2E_OVERRIDE_MAX', 'is a test-only override and must not be set in production');
    }
    if (!env.MAINTENANCE_ALERT_WEBHOOK_URL && env.MAINTENANCE_ALERT_LOG_ONLY !== 'true') {
      fail('MAINTENANCE_ALERT_WEBHOOK_URL', 'is required in production so failing scheduled jobs reach a person (or set MAINTENANCE_ALERT_LOG_ONLY=true when log-based alerting is configured)');
    }
  })
  .transform((env) => ({
    ...env,
    GUEST_SESSION_ALLOW_UNSIGNED:
      env.GUEST_SESSION_ALLOW_UNSIGNED === undefined
        ? env.NODE_ENV !== 'production'
        : env.GUEST_SESSION_ALLOW_UNSIGNED === 'true',
  }));

export type Env = z.infer<typeof validatedEnvSchema>;

let cachedEnv: Env | undefined;

/**
 * Parse and validate process.env. Call once at process startup; throws
 * with a readable message listing every missing/invalid variable rather
 * than failing on first use deep in application code.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const result = validatedEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

/** Test-only helper to reset the cached env between test files. */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
