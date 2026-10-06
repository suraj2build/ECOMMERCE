import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Demo readiness (LR-001, specs/08-storefront.md launch-readiness addendum):
 * every navigation link, CTA and image on the public storefront must lead
 * somewhere real. Pages are rendered in a real browser (client-rendered
 * links and lazily loaded images included); every same-origin link and every
 * image found is then requested and must answer below 400 after redirects.
 * Runs at desktop width, at phone width with the menu open, and with an
 * Instagram in-app browser user agent.
 */

const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';

const PAGES = [
  '/',
  '/collections',
  '/watch-and-shop',
  '/category/women',
  '/category/men',
  '/category/new',
  '/category/sale',
  '/category/everyday-kurtis',
  '/legal/privacy',
  '/legal/terms',
  '/bag',
  '/wishlist',
  '/orders',
  '/account',
];

const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109 (iPhone15,2; iOS 17_5; en_IN; en-IN; scale=3.00; 1179x2556; 619461904)';

interface Found { links: Set<string>; images: Set<string>; broken: string[] }

async function collect(page: Page, path: string, found: Found, openMenu = false) {
  const started = Date.now();
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  if (openMenu) {
    const toggle = page.getByRole('button', { name: 'Open menu' });
    if (await toggle.isVisible()) await toggle.click();
  }
  // Bring lazily loaded images into view, then let them settle.
  // Bounded, so a page that keeps growing as it scrolls cannot use up the test's time.
  await page.evaluate(async () => {
    for (let y = 0, steps = 0; y < document.body.scrollHeight && steps < 150; y += 600, steps += 1) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  await page.waitForLoadState('networkidle');
  // Lazily loaded images scrolled past quickly may not have started; load
  // every image eagerly and wait for each to finish before judging it.
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((img) => {
      img.loading = 'eager';
      // Already finished, loaded or failed: its load/error event has fired and will not fire
      // again, so waiting would only burn the timeout. A failed one is reported below.
      if (img.complete) return null;
      return new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 15_000); });
    }));
  });
  const result = await page.evaluate(() => ({
    links: [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
    images: [...document.images].map((img) => ({ src: img.currentSrc || img.src, ok: img.complete && img.naturalWidth > 0, loading: img.loading })),
  }));
  for (const href of result.links) {
    const url = new URL(href);
    if (url.origin === new URL(STOREFRONT_URL).origin && !url.hash) found.links.add(url.pathname + url.search);
  }
  for (const image of result.images) {
    if (!image.src) continue;
    found.images.add(image.src);
    if (!image.ok) found.broken.push(`${path}: image did not render ${image.src}`);
  }
  // Per-page timing in the report, so a slow run shows which page took the time.
  test.info().annotations.push({ type: 'page-time', description: `${path}: ${Date.now() - started} ms` });
  process.stdout.write(`link-audit ${path}: ${Date.now() - started} ms\n`);
}

async function checkAll(request: APIRequestContext, found: Found) {
  const failures = [...found.broken];
  for (const link of found.links) {
    const res = await request.get(`${STOREFRONT_URL}${link}`);
    if (res.status() >= 400) failures.push(`link ${link} -> ${res.status()}`);
  }
  for (const src of found.images) {
    const res = await request.get(src);
    if (res.status() >= 400) failures.push(`image ${src} -> ${res.status()}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

test.describe('Storefront link, CTA and asset audit', () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vanya_department', 'women'));
  });

  test('desktop: every link and image on the public pages resolves', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const found: Found = { links: new Set(), images: new Set(), broken: [] };
    for (const path of PAGES) await collect(page, path, found);
    // One level deeper: the first collection, product and Watch & Shop item
    // the pages above link to, so their own CTAs are checked too.
    for (const prefix of ['/collections/', '/product/', '/watch-and-shop?media=']) {
      const next = [...found.links].find((link) => link.startsWith(prefix));
      if (next) await collect(page, next, found);
    }
    expect(found.links.size).toBeGreaterThan(10);
    await checkAll(request, found);
  });

  test('phone: the open menu and page links resolve', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const found: Found = { links: new Set(), images: new Set(), broken: [] };
    for (const path of ['/', '/category/women', '/collections', '/legal/privacy']) await collect(page, path, found, true);
    expect([...found.links].some((link) => link.startsWith('/category/'))).toBe(true);
    await checkAll(request, found);
  });

  test('Instagram in-app browser: home, a listing and a product render and link correctly', async ({ browser, request }) => {
    const context = await browser.newContext({ userAgent: INSTAGRAM_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('vanya_department', 'women'));
    const found: Found = { links: new Set(), images: new Set(), broken: [] };
    await collect(page, '/', found, true);
    await collect(page, '/category/women', found);
    const product = [...found.links].find((link) => link.startsWith('/product/'));
    if (product) await collect(page, product, found);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await context.close();
    await checkAll(request, found);
  });
});
