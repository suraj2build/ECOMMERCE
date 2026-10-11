import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
  await request.get('http://127.0.0.1:4000/_test/reset');
  await page.addInitScript(() =>
    localStorage.setItem(
      'vanya_consent_v1',
      JSON.stringify({ analytics: false, marketing: false, decidedAt: '2026-10-11T00:00:00.000Z' }),
    ),
  );
});
test('separate hubs render images and fit desktop and mobile', async ({ page }) => {
  for (const department of ['women', 'men']) {
    await page.goto('/' + department + '/lookbook');
    await expect(page.getByRole('heading', { name: 'Style, in stories.' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('vanya_department')))
      .toBe(department);
    await expect(page.locator('article')).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .locator('main img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'lookbook-test-results/' + department + '-desktop.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/women/lookbook');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'lookbook-test-results/women-mobile.png', fullPage: true });
});
test('occasion filter and cross-department refusal', async ({ page }) => {
  await page.goto('/women/lookbook');
  await page.getByRole('button', { name: 'Evening', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('After the light');
  const response = await page.goto('/men/lookbook/city-days');
  expect(response?.status()).toBe(404);
});
test('exact colour and selected size reach the existing bag API', async ({ page, request }) => {
  await page.goto('/women/lookbook/city-days');
  await page.getByRole('button', { name: 'Shop this look · 1 piece' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('Yellow');
  await expect(panel.getByRole('button', { name: 'Add this piece' })).toBeDisabled();
  await expect(panel.locator('option[value="medium"]')).toBeDisabled();
  await panel.getByLabel('Choose size').selectOption('small');
  await panel.getByRole('button', { name: 'Add this piece' }).click();
  await expect(panel.getByRole('status')).toContainText('added to your bag');
  expect(await (await request.get('http://127.0.0.1:4000/_test/additions')).json()).toEqual([
    { skuId: 'exact-yellow-small', quantity: 1 },
  ]);
  await page.screenshot({ path: 'lookbook-test-results/shop-story-panel.png' });
});
test('stock changing after panel load refuses the add', async ({ page, request }) => {
  await page.goto('/women/lookbook/city-days');
  await page.getByRole('button', { name: 'Shop this look · 1 piece' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Choose size').selectOption('small');
  await request.get('http://127.0.0.1:4000/_test/sold-out');
  await panel.getByRole('button', { name: 'Add this piece' }).click();
  await expect(panel.getByRole('status')).toContainText('no longer available');
  expect(await (await request.get('http://127.0.0.1:4000/_test/additions')).json()).toEqual([]);
});
test('mobile shopping panel closes and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/women/lookbook/city-days');
  const trigger = page.getByRole('button', { name: 'Shop this look · 1 piece' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
