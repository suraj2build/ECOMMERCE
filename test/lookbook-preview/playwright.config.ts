import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: process.env.LOOKBOOK_RECORD_PREVIEW ? 'recording.spec.ts' : 'lookbook.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: '../../lookbook-test-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    { command: 'node mock-api.mjs', port: 4000, reuseExistingServer: false },
    {
      command: 'npm run start --workspace=apps/storefront -- --port 3000 --hostname 127.0.0.1',
      cwd: '../..',
      port: 3000,
      reuseExistingServer: false,
    },
  ],
});
