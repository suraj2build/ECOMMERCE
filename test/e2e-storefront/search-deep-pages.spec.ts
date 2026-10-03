import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

/**
 * LR-007 (specs/09-search-discovery.md launch-readiness addendum): listing
 * pages are validated against the live result count. Every populated page
 * stays reachable — including the one holding the final item beyond 1,000
 * matches — and only a page past the live last page is redirected to it.
 *
 * The documents are written straight into the search index (the same
 * boundary the search-discovery integration test isolates); the integration
 * suite separately proves real published catalog data produces them.
 */

const MEILI_URL = process.env.MEILISEARCH_HOST ?? 'http://localhost:7700';
const MEILI_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  ...(process.env.MEILISEARCH_API_KEY ? { authorization: `Bearer ${process.env.MEILISEARCH_API_KEY}` } : {}),
};
const TOTAL = 1005;
const PAGE_SIZE = 24;
const LAST_PAGE = Math.ceil(TOTAL / PAGE_SIZE); // 42, holding items 985..1005

async function meili(path: string, method: string, body?: unknown) {
  const res = await fetch(`${MEILI_URL}${path}`, { method, headers: MEILI_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  expect(res.ok, `${method} ${path} -> ${res.status}`).toBe(true);
  const task = (await res.json()) as { taskUid?: number };
  if (task.taskUid === undefined) return;
  await expect.poll(async () => {
    const status = await (await fetch(`${MEILI_URL}/tasks/${task.taskUid}`, { headers: MEILI_HEADERS })).json() as { status: string };
    return status.status;
  }, { timeout: 60_000 }).toMatch(/succeeded|failed/);
  const final = await (await fetch(`${MEILI_URL}/tasks/${task.taskUid}`, { headers: MEILI_HEADERS })).json() as { status: string; error?: unknown };
  expect(final.status, JSON.stringify(final.error)).toBe('succeeded');
}

test.describe('Search page validation beyond 1,000 matches', () => {
  test.setTimeout(180_000);
  const token = `deep${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const ids = Array.from({ length: TOTAL }, (_, i) => `e2e-${token}-${i}`);
  // Sorted newest first, the oldest document is the final item of the result.
  const finalName = `${token} final item`;

  test.beforeAll(async () => {
    await meili('/indexes/styles/documents', 'POST', ids.map((id, i) => ({
      id,
      styleCode: `E2E-${token}-${i}`,
      name: i === 0 ? finalName : `${token} item ${i}`,
      brandId: 'e2e', brandName: 'E2E', categoryId: 'e2e', categoryName: 'E2E', categorySlug: 'e2e-deep',
      department: null, gender: null, division: null, subcategory: null, season: 'SS26', collection: 'Core',
      fabric: null, fit: null, pattern: null, occasion: null,
      colours: ['Black'], sizes: ['M'], mrp: 999, sellingPrice: 999, currency: 'INR', isMarkdown: false,
      availableQuantity: 1, inStock: true, searchPinned: false, publishedAt: 1_000 + i, thumbnailUrl: null,
    })));
  });

  test.afterAll(async () => {
    await meili('/indexes/styles/documents/delete-batch', 'POST', ids);
  });

  test('the last populated page shows the final item, and a page past it redirects there', async ({ page }) => {
    const last = await page.goto(`/search?q=${token}&sort=newest&page=${LAST_PAGE}`);
    expect(last?.status()).toBe(200);
    expect(new URL(page.url()).searchParams.get('page')).toBe(String(LAST_PAGE));
    await expect(page.getByText(finalName, { exact: true })).toBeVisible();
    await expect(page.getByText(`${token} item ${TOTAL - 1}`, { exact: true })).toHaveCount(0);

    // A page past the live last page lands on the last populated page,
    // keeping the query and sort.
    await page.goto(`/search?q=${token}&sort=newest&page=${LAST_PAGE + 5}`);
    const redirected = new URL(page.url());
    expect(redirected.searchParams.get('page')).toBe(String(LAST_PAGE));
    expect(redirected.searchParams.get('q')).toBe(token);
    expect(redirected.searchParams.get('sort')).toBe('newest');
    await expect(page.getByText(finalName, { exact: true })).toBeVisible();

    // Every page before it is populated and is served as requested.
    for (const n of [1, 17, LAST_PAGE - 1]) {
      await page.goto(`/search?q=${token}&sort=newest&page=${n}`);
      expect(new URL(page.url()).searchParams.get('page') ?? '1').toBe(String(n));
    }
  });
});
