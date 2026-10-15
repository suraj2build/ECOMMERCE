/**
 * Loaded via vitest's `setupFiles` before any test file runs. Sets the
 * environment variables @fcp/config's loadEnv() requires, pointed at the
 * dedicated fcp_test database (never the dev/prod database) so test runs
 * never touch real data.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://fcp_app:fcp_dev_password@localhost:5432/fcp_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-test-only-secret';
process.env.MFA_SECRET_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.LOG_LEVEL ??= 'fatal';
process.env.PO_APPROVAL_THRESHOLD_INR ??= '50000';
process.env.INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS ??= '50';
process.env.GRN_EXCESS_TOLERANCE_PERCENT ??= '0';
process.env.GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS ??= '20';
process.env.INVENTORY_RESERVATION_TTL_SECONDS ??= '900';
// Admin Ops Phase 1: test uploads go to a throwaway directory, never the
// demo's var/product-media (or return evidence) store.
process.env.PRODUCT_MEDIA_STORAGE_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/fcp-test-product-media`;
process.env.RETURN_EVIDENCE_STORAGE_DIR ??= `${process.env.TMPDIR ?? '/tmp'}/fcp-test-return-evidence`;
