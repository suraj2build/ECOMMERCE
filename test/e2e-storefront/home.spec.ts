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
    await expect(page.getByRole('link', { name: 'VANYA home' })).toBeVisible();
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
    await expect(nav.getByRole('link', { name: 'Women' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'New In' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Collections' })).toBeVisible();
  });

  test('mobile nav opens after department selection and reaches the real PLP', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await chooseWomen(page);

    const menuButton = page.getByRole('button', { name: 'Open menu' });
    await menuButton.click();
    const mobileNav = page.getByRole('navigation', { name: 'Primary mobile' });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole('link', { name: 'Shop women' }).click();
    await expect(page).toHaveURL(/\/category\/women$/);
    await expect(page.getByRole('heading', { name: 'Women' })).toBeVisible();
  });

  test('the chosen department persists and the skip-to-content link remains first focusable', async ({ page }) => {
    await chooseWomen(page);
    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('new browse routes resolve and chosen Home has no serious accessibility violations', async ({ page }) => {
    await chooseWomen(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    for (const route of ['/search', '/category/women', '/collections', '/watch-and-shop']) {
      const response = await page.goto(route);
      expect(response?.ok(), `${route} should resolve successfully`).toBeTruthy();
      await expect(page.locator('body')).not.toContainText('404');
    }
  });
});
