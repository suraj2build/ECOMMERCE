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
    for (const image of await page.locator('main img').all()) await image.scrollIntoViewIfNeeded();
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

const edition = '/women/lookbook/issues/a-city-three-moods';
test('complete book has every page, links, full images and a downloadable PDF', async ({
  page,
  request,
}) => {
  await page.goto('/women/lookbook');
  await page.getByRole('link', { name: 'Open the complete lookbook →', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A City, Three Moods', exact: true, level: 1 }),
  ).toBeVisible();
  const chooser = page.getByRole('combobox', { name: 'Go to page' });
  await expect(chooser.locator('option')).toHaveCount(32);
  await page.screenshot({
    path: 'lookbook-test-results/complete-book-desktop.png',
    fullPage: true,
  });
  for (let number = 1; number <= 32; number++) {
    await chooser.selectOption(String(number));
    await expect(page.locator('#book-page-' + number)).toBeVisible();
    for (const summary of await page
      .getByRole('region', { name: 'Lookbook reader' })
      .locator('details:not([open]) summary')
      .all())
      await summary.click();
    for (const image of await page
      .getByRole('region', { name: 'Lookbook reader' })
      .locator('img')
      .all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate(
            (img) =>
              (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const pdf = await request.get('/lookbooks/a-city-three-moods.pdf');
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await chooser.selectOption('22');
  await page.screenshot({ path: 'lookbook-test-results/heena-book-spread.png', fullPage: true });
  await page.reload();
  await expect(chooser).toHaveValue('22');
  await page.goto('/men/lookbook/issues/a-city-three-moods');
  await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
});
test('complete book shops both exact pieces and refuses changed stock', async ({
  page,
  request,
}) => {
  await page.goto(edition + '#page=6');
  await expect(page.locator('#book-page-5')).toBeVisible();
  await expect(page.locator('#book-page-7')).toHaveCount(0);
  await expect(page.locator('#book-page-5 img')).toHaveAttribute(
    'alt',
    'Riya wearing Blush Pink Relaxed Cotton Top, Mid Blue High-Rise Straight Denim',
  );
  await page.getByRole('button', { name: 'Shop this look · 2 pieces' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('Blush Pink');
  await expect(panel).toContainText('Mid Blue');
  const sizes = panel.getByLabel('Choose size');
  await sizes.nth(0).selectOption('small');
  await sizes.nth(1).selectOption('small');
  await panel.getByRole('button', { name: 'Add this piece', exact: true }).nth(0).click();
  await expect(panel.getByRole('status')).toContainText('added to your bag');
  await panel.getByRole('button', { name: 'Add this piece', exact: true }).nth(1).click();
  await expect
    .poll(
      async () =>
        (await (await request.get('http://127.0.0.1:4000/_test/additions')).json()).length,
    )
    .toBe(2);
  const adds = await (await request.get('http://127.0.0.1:4000/_test/additions')).json();
  expect(adds.map((a: { skuId: string }) => a.skuId)).toEqual([
    'book-women-tp-02-Blush Pink-small',
    'book-women-dn-01-Mid Blue-small',
  ]);
  await page.screenshot({ path: 'lookbook-test-results/complete-book-shopping.png' });
  await request.get('http://127.0.0.1:4000/_test/sold-out');
  await panel.getByRole('button', { name: 'Add this piece', exact: true }).nth(0).click();
  await expect(panel.getByRole('status')).toContainText('no longer available');
  expect((await (await request.get('http://127.0.0.1:4000/_test/additions')).json()).length).toBe(
    2,
  );
});
test('mobile book reads continuously and zoom closes with restored focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(edition + '#page=21');
  await expect(page.locator('#book-page-21')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Lookbook reader' }).locator('section'),
  ).toHaveCount(1);
  const zoom = page.getByRole('button', { name: 'Enlarge photo' });
  await zoom.click();
  await expect(page.getByRole('dialog', { name: 'Enlarged editorial photo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(zoom).toBeFocused();
  await page.screenshot({ path: 'lookbook-test-results/complete-book-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Read continuously' }).click();
  await expect(
    page.getByRole('region', { name: 'Lookbook reader' }).locator('section'),
  ).toHaveCount(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Book view', exact: true }).click();
  await page.getByRole('button', { name: 'Page overview' }).click();
  await page.getByRole('navigation', { name: 'Page overview' }).getByRole('button').last().click();
  await expect(page.getByRole('combobox', { name: 'Go to page' })).toHaveValue('32');
  await expect(page.getByRole('button', { name: 'Next →', exact: true })).toBeDisabled();
});
