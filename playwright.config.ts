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
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000',
        // apps/storefront (via Next.js's peer dependency) can resolve a
        // newer @playwright/test than this sandbox's pre-cached browser
        // revision - launch the pre-installed chromium binary directly
        // rather than the version-pinned headless-shell variant.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
});
