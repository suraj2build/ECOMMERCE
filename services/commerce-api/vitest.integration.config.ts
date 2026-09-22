import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['test/integration/**/*.test.ts', 'test/e2e-proof/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/helpers/setup-env.ts'],
    // Integration tests hit a real Postgres instance and must not run
    // concurrently against each other (shared DB state per test file).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
