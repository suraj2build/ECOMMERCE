import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'unit',
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/helpers/setup-env.ts'],
  },
});
