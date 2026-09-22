import { defineConfig } from '@playwright/test';

/**
 * Playwright is approved tooling (Phase 1 authorization §Approved
 * Technical Direction) but real browser UI E2E has no target yet: no
 * `apps/storefront` exists in the M00-M07 Phase 1 scope (Storefront is
 * M09+). This config runs API-level smoke checks via Playwright's HTTP
 * request context against a running commerce-api instance, so the
 * `test:e2e` script and CI wiring are real and exercised now - full
 * browser E2E against the storefront is added when that milestone
 * starts, without changing this config's shape.
 */
export default defineConfig({
  testDir: './test/e2e-smoke',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000',
  },
  reporter: [['list']],
});
