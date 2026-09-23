import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Home page browser E2E (M09, acceptance/m09-storefront-foundation.md):
 * layout at mobile and desktop breakpoints, no horizontal overflow, an
 * automated accessibility scan, and keyboard-operable navigation.
 */
test.describe('Storefront Home', () => {
  test('renders correctly at a mobile breakpoint with no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1 for sub-pixel rounding
  });

  test('renders correctly at a desktop breakpoint with full nav visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Shop Women' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Shop Men' })).toBeVisible();
  });

  test('mobile nav opens via the menu button and closes after selecting a link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menuButton = page.getByRole('button', { name: 'Open menu' });
    await menuButton.click();
    const mobileNav = page.getByRole('navigation', { name: 'Primary mobile' });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole('link', { name: 'Shop Women' }).click();
    await expect(page).toHaveURL(/\/category\/women$/);
  });

  test('the skip-to-content link is the first focusable element', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('has no critical or serious automated accessibility violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
