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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- CORS (M11 - the storefront's client-side PIN-check/review/OTP
  // calls are the first browser-originated requests this API serves;
  // everything before M11 was server-side-only fetching, which isn't
  // subject to CORS). Comma-separated allowed origins.
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // --- Wishlist / Cart (M12, CART-001/002) ---
  CART_GUEST_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CART_MAX_QUANTITY_PER_SKU: z.coerce.number().int().positive().default(10),

  // --- Checkout / Payment (M13, CHK-003, PAY-001 COD value cap) ---
  SHIPPING_DEFAULT_FLAT_AMOUNT: z.coerce.number().nonnegative().default(99),
  SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD: z.coerce.number().nonnegative().default(1999),
  COD_MAX_ORDER_VALUE_INR: z.coerce.number().positive().default(5000),

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
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Parse and validate process.env. Call once at process startup; throws
 * with a readable message listing every missing/invalid variable rather
 * than failing on first use deep in application code.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(source);
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
