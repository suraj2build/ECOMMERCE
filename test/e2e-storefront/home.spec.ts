import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * P2 VANYA storefront shell E2E. The first visit deliberately opens the
 * Men/Women gateway; after a choice it is remembered in localStorage and
 * the production storefront shell takes over.
 */
test.describe('Storefront Home', () => {
  async function chooseWomen(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Enter WOMEN store' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter WOMEN store' }).click();
    await expect(page.getByRole('link', { name: 'VANYA — choose Men or Women' })).toBeVisible();
  }

  test('first visit presents the VANYA department gateway and remains mobile-safe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'VANYA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter MEN store' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter WOMEN store' })).toBeVisible();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('desktop department choice reveals the full production navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseWomen(page);

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    // The approved design's navigation: department home, edits, categories, Watch & Shop.
    await expect(nav.getByRole('link', { name: 'Women' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'New In' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Watch & Shop' })).toBeVisible();
  });

  test('mobile nav opens after department selection and reaches the real PLP', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseWomen(page);

    const menuButton = page.getByRole('button', { name: 'Open menu' });
    await menuButton.click();
    const mobileNav = page.getByRole('navigation', { name: 'Primary mobile' });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Collections' })).toBeVisible();
    await mobileNav.getByRole('link', { name: 'New In' }).click();
    await expect(page).toHaveURL(/\/category\/women$/);
    await expect(page.getByRole('heading', { name: "Women's Collection" })).toBeVisible();
  });

  test('the chosen department persists and the skip-to-content link remains first focusable', async ({ page }) => {
    await chooseWomen(page);
    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('new browse routes resolve and chosen Home has no serious accessibility violations', async ({ page }) => {
    await chooseWomen(page);
    // Choosing a department fades the page in; contrast is measured on the settled page, not a mid-fade frame.
    await expect(page.locator('#main-content > div').first()).toHaveCSS('opacity', '1');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    for (const route of ['/search', '/category/women', '/collections', '/watch-and-shop']) {
      const response = await page.goto(route);
      expect(response?.ok(), `${route} should resolve successfully`).toBeTruthy();
      await expect(page.locator('body')).not.toContainText('404');
    }
  });

  test('reference header separates the brand and navigation without overlap at desktop and mobile widths', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vanya_department', 'men'));
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const brand = page.getByRole('link', { name: 'VANYA — choose Men or Women' });
      await expect(brand).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'men');
      const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      expect(dimensions.content, `overflow at ${width}px`).toBeLessThanOrEqual(dimensions.width + 1);
      if (width >= 1024) {
        const nav = await page.getByRole('navigation', { name: 'Primary', exact: true }).boundingBox();
        const logo = await brand.boundingBox();
        const search = await page.getByRole('button', { name: 'Search', exact: true }).boundingBox();
        expect(nav && logo && search).toBeTruthy();
        expect(logo!.y + logo!.height).toBeLessThanOrEqual(nav!.y);
        expect(nav!.x + nav!.width).toBeLessThanOrEqual(search!.x);
      }
    }
  });

  test('mobile search and bag contain keyboard focus; full search preserves the selected department', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('vanya_department', 'men'));
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Search', exact: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'men');
    await trigger.click();
    const search = page.getByRole('dialog', { name: 'Search VANYA' });
    const searchInput = search.getByLabel('Search products');
    await expect(searchInput).toBeFocused();
    // Focus stays inside the dialog: Shift+Tab from the first control wraps to the last.
    await search.getByRole('button', { name: 'Search', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(search.getByRole('link', { name: 'Watch & Shop', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const bagTrigger = page.getByRole('button', { name: /Shopping bag/ });
    await bagTrigger.click();
    const bag = page.getByRole('dialog', { name: 'Shopping bag', exact: true });
    await expect(bag.getByRole('button', { name: 'Close bag', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bagTrigger).toBeFocused();

    await trigger.click();
    await search.getByLabel('Search products').fill('linen');
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=linen&gender=men$/);
    // The phone "Filter & Refine" sheet keeps the department when filters are applied.
    await page.getByRole('button', { name: /^Filter/ }).click();
    const filters = page.getByRole('dialog', { name: 'Filter & Refine' });
    await expect(filters.locator('form input[name="gender"]')).toHaveValue('men');
    await filters.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/gender=men/);
  });
});
