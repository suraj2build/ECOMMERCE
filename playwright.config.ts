import { defineConfig, devices } from '@playwright/test';

/**
 * Two independent Playwright projects, matching the two things that need
 * browser/HTTP E2E coverage:
 *
 * - `api-smoke`: HTTP-level request checks against commerce-api
 *   (test/e2e-smoke) - no browser needed, just a running commerce-api.
 * - `storefront`: real Chromium browser checks against apps/storefront
 *   (test/e2e-storefront), added at M09 now that the storefront exists.
 *
 * CI starts both servers itself (see .github/workflows/ci.yml) and sets
 * E2E_BASE_URL/STOREFRONT_BASE_URL; both default to localhost for local
 * development against `npm run dev:api` / `npm run dev:storefront`.
 */
export default defineConfig({
  timeout: 30_000,
  reporter: [['list']],
  projects: [
    {
      name: 'api-smoke',
      testDir: './test/e2e-smoke',
      use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000',
      },
    },
    {
      name: 'storefront',
      testDir: './test/e2e-storefront',
      // Runs in its own project after this one (below): it adds 1,005
      // documents to the shared search index, which would otherwise show
      // up in listings other specs are auditing at the same moment.
      testIgnore: /search-deep-pages\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000',
        // LR-003: specs run as a visitor who has already declined tracking,
        // so the first-visit consent banner never covers the controls they
        // use. consent.spec.ts starts from an empty state to test the banner.
        storageState: {
          cookies: [],
          origins: [{
            origin: new URL(process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000').origin,
            localStorage: [{ name: 'vanya_consent_v1', value: JSON.stringify({ analytics: false, marketing: false, decidedAt: '2026-01-01T00:00:00.000Z' }) }],
          }],
        },
        // apps/storefront (via Next.js's peer dependency) can resolve a
        // newer @playwright/test than this sandbox's pre-cached browser
        // revision - launch the pre-installed chromium binary directly
        // rather than the version-pinned headless-shell variant.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
    {
      name: 'storefront-deep-search',
      testDir: './test/e2e-storefront',
      testMatch: /search-deep-pages\.spec\.ts/,
      dependencies: ['storefront'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000',
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
    {
      // `admin`: real Chromium browser checks against apps/admin (M29,
      // specs/28-admin.md) - a genuinely separate application from
      // apps/storefront, run on its own port (3001).
      name: 'admin',
      testDir: './test/e2e-admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_BASE_URL ?? 'http://localhost:3001',
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
});
