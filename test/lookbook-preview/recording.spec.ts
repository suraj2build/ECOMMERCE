import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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

test('record the complete edition and exact product shopping', async ({ page, request }) => {
  test.setTimeout(60000);
  mkdirSync('/workspace/scratch/36dc6287b43a/lookbook-issue-delivery', { recursive: true });
  await request.get('http://127.0.0.1:4000/_test/reset');
  await page.addInitScript(() =>
    localStorage.setItem(
      'vanya_consent_v1',
      JSON.stringify({ analytics: false, marketing: false, decidedAt: '2026-10-11T00:00:00.000Z' }),
    ),
  );
  await page.goto('/women/lookbook/issues/a-city-three-moods');
  await page.getByRole('region', { name: 'Lookbook reader' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: '/workspace/scratch/36dc6287b43a/lookbook-issue-delivery/Complete_Book_Desktop.png',
    fullPage: true,
  });
  const chooser = page.getByRole('combobox', { name: 'Go to page' });
  for (const number of ['2', '4', '6', '14', '18', '20', '22', '28', '31']) {
    await chooser.selectOption(number);
    await page.getByRole('region', { name: 'Lookbook reader' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    if (number === '22')
      await page.screenshot({
        path: '/workspace/scratch/36dc6287b43a/lookbook-issue-delivery/Heena_Book_Spread.png',
        fullPage: true,
      });
  }
  await chooser.selectOption('6');
  await page.getByRole('button', { name: 'Shop this look · 2 pieces' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Choose size').nth(0).selectOption('small');
  await panel.getByLabel('Choose size').nth(1).selectOption('small');
  await page.waitForTimeout(1800);
  await panel.getByRole('button', { name: 'Add this piece', exact: true }).nth(0).click();
  await expect(panel.getByRole('status')).toContainText('added to your bag');
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: '/workspace/scratch/36dc6287b43a/lookbook-issue-delivery/Complete_Book_Shopping.png',
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/women/lookbook/issues/a-city-three-moods#page=21');
  await page.locator('#book-page-21').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: '/workspace/scratch/36dc6287b43a/lookbook-issue-delivery/Complete_Book_Mobile.png',
    fullPage: true,
  });
});
