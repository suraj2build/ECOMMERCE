import { test, expect } from '@playwright/test';

// Presentation recording, separate from the five assertion-focused checks.
// Pauses give the viewer time to see each screen; all catalogue data is a fixture.
test('record lookbook preview with fixture shopping', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'vanya_consent_v1',
      JSON.stringify({ analytics: false, marketing: false, decidedAt: '2026-10-11T00:00:00.000Z' }),
    ),
  );
  await page.goto('/women/lookbook');
  await expect(page.getByRole('heading', { name: 'Style, in stories.' })).toBeVisible();
  await page.waitForTimeout(1800);
  await page.locator('article').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.goto('/men/lookbook');
  await page.waitForTimeout(1800);
  await page.locator('article').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.goto('/women/lookbook/after-the-light');
  await page.waitForTimeout(1800);
  await page.locator('#look-1').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  await page.goto('/women/lookbook/city-days');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Shop this look · 1 piece' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Choose size').selectOption('small');
  await page.waitForTimeout(1800);
  await panel.getByRole('button', { name: 'Add this piece' }).click();
  await expect(panel.getByRole('status')).toContainText('added to your bag');
  await page.waitForTimeout(1800);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/women/lookbook');
  await page.waitForTimeout(1800);
});
