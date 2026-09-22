import { test, expect } from '@playwright/test';

/**
 * Smoke check that a running commerce-api instance is reachable and its
 * infrastructure dependencies (Postgres, Redis) are healthy. This is the
 * "fresh clone -> documented commands -> full local stack running ->
 * a smoke-test endpoint responds successfully" scenario from
 * acceptance/m00-project-foundation.md.
 */
test.describe('commerce-api smoke', () => {
  test('health endpoint responds ok', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('ready endpoint confirms database and redis connectivity', async ({ request }) => {
    const response = await request.get('/ready');
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ status: 'ready' });
  });
});
