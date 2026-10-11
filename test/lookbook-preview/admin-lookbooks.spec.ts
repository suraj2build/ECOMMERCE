import { test, expect } from '@playwright/test';
const admin = 'http://127.0.0.1:3001/dashboard/cms/lookbooks';
const session = {
  token: 'fixture-editor',
  staffUserId: 'fixture-editor',
  fullName: 'Test merchandiser',
  email: 'fixture@example.test',
  roles: ['MARKETING'],
  permissions: ['cms:read', 'cms:manage'],
};
test.beforeEach(async ({ page, request }) => {
  await request.get('http://127.0.0.1:4000/_test/reset');
  await page.addInitScript((s) => {
    localStorage.setItem('fcp_admin_session', JSON.stringify(s));
    localStorage.setItem(
      'vanya_consent_v1',
      JSON.stringify({ analytics: false, marketing: false, decidedAt: '2026-10-11T00:00:00Z' }),
    );
  }, session);
});
async function fill(page: import('@playwright/test').Page, book = false) {
  await page.goto(admin);
  await page.getByLabel('Title', { exact: true }).fill('Morning notes');
  await page.getByLabel('URL handle').fill('morning-notes');
  await page.getByLabel('Story introduction').fill('A story built in the admin editor.');
  await page.getByLabel('Model / chapter', { exact: true }).fill('Riya');
  if (book) await page.getByLabel('Reading format').selectOption('book');
  await page
    .getByLabel('Upload cover image')
    .setInputFiles('apps/storefront/public/campaigns/issue-01/look-01.webp');
  await expect(page.getByLabel('Cover image path or HTTPS URL')).toHaveValue(/lookbook-media/);
  await page.getByLabel('Look title', { exact: true }).fill('The café stop');
  await page.getByLabel('Look image path or HTTPS URL').fill('/campaigns/issue-01/look-01.webp');
  await page.getByLabel('Image description').fill('Riya in a pink top and blue denim');
}
async function link(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Link product', exact: true }).click();
  await page
    .getByLabel('Search published products by name or style code')
    .fill('VNY-LA-WOMEN-TP-02');
  await expect(page.getByLabel('Product', { exact: true }).locator('option')).toHaveCount(2);
  const id = await page
    .getByLabel('Product', { exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await page.getByLabel('Product', { exact: true }).selectOption(id!);
  await page.getByLabel('Exact pictured colour').selectOption({ label: 'Blush Pink' });
  await page.getByRole('button', { name: 'Add selected product' }).click();
}
test('admin uploads, maps, publishes, edits a private draft and unpublishes a shoppable story', async ({
  page,
  request,
  context,
}) => {
  await fill(page);
  await page.getByRole('button', { name: 'Publish lookbook' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Link an exact product' })).toContainText(
    'Link an exact product to every look',
  );
  await link(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  expect(
    (
      await (
        await request.get('http://127.0.0.1:4000/api/v1/storefront/lookbooks?department=women')
      ).json()
    ).stories,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Publish lookbook' }).click();
  await expect(page.getByRole('status')).toContainText('Published.');
  await page.screenshot({
    path: 'lookbook-test-results/admin-lookbooks-desktop.png',
    fullPage: true,
  });
  const shop = await context.newPage();
  await shop.goto('http://127.0.0.1:3000/women/lookbook');
  await shop.getByRole('link', { name: /Morning notes.*Shop the story/ }).click();
  await expect(shop.getByRole('heading', { name: 'Morning notes', exact: true })).toBeVisible();
  await shop.getByRole('button', { name: 'Shop this look · 1 piece' }).click();
  const panel = shop.getByRole('dialog');
  await expect(panel).toContainText('Blush Pink');
  await panel.getByLabel('Choose size').selectOption('small');
  await panel.getByRole('button', { name: 'Add this piece' }).click();
  await expect(panel.getByRole('status')).toContainText('added to your bag');
  const details = panel.getByRole('link', { name: 'Relaxed Cotton Top' });
  await expect(details).toHaveAttribute('href', /\?colour=/);
  await details.click();
  await expect(
    shop.getByRole('heading', { name: 'Relaxed Cotton Top', exact: true }),
  ).toBeVisible();
  await expect(shop.getByRole('button', { name: /Blush Pink/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Title', { exact: true }).fill('Private new title');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await shop.goto('http://127.0.0.1:3000/women/lookbook/morning-notes');
  await expect(shop.getByRole('heading', { name: 'Morning notes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Unpublished.');
  expect((await shop.goto('http://127.0.0.1:3000/women/lookbook/morning-notes'))?.status()).toBe(
    404,
  );
  expect((await (await request.get('http://127.0.0.1:4000/_test/uploads')).json()).uploads).toBe(1);
});
test('admin-created complete books have their own page count and a route to their exact product', async ({
  page,
  context,
}) => {
  await fill(page, true);
  await link(page);
  await page.getByRole('button', { name: 'Publish lookbook' }).click();
  await expect(page.getByRole('status')).toContainText('Published.');
  const shop = await context.newPage();
  await shop.goto('http://127.0.0.1:3000/women/lookbook/issues/morning-notes');
  await expect(
    shop.getByRole('heading', { name: 'Morning notes', exact: true }).first(),
  ).toBeVisible();
  await expect(shop.locator('main')).toContainText('8 pages / 1 look');
  await shop.getByLabel('Go to page').selectOption('6');
  await shop.getByRole('button', { name: 'Shop this look · 1 piece' }).click();
  await expect(shop.getByRole('dialog')).toContainText('Blush Pink');
  expect(
    (await shop.goto('http://127.0.0.1:3000/men/lookbook/issues/morning-notes'))?.status(),
  ).toBe(404);
});
test('men’s unmapped inspirations retain an honest route to the men’s shop', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/men/lookbook/the-working-week');
  await expect(page.getByRole('link', { name: 'Shop men’s collection →' })).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Shop men’s collection →' }).first()).toHaveAttribute(
    'href',
    '/men',
  );
});
test('read-only staff see the editor without being allowed to change or publish', async ({
  page,
}) => {
  await page.goto(admin);
  await page.addInitScript((s) => localStorage.setItem('fcp_admin_session', JSON.stringify(s)), {
    ...session,
    permissions: ['cms:read'],
  });
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Publish lookbook' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'lookbook-test-results/admin-lookbooks-mobile.png',
    fullPage: true,
  });
});

test('the existing complete book imports without JSON and can be published with all exact links', async ({ page, context, request }) => {
  await page.goto(admin);
  await page.getByRole('button', { name: 'Configure A City, Three Moods', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('A City, Three Moods');
  await expect(page.getByRole('region', { name: /^Look \d+$/ })).toHaveCount(12);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  const before = await (await request.get('http://127.0.0.1:4000/api/v1/storefront/lookbooks?department=women')).json();
  expect(before.hiddenBuiltins).toEqual([]);
  await page.getByRole('button', { name: 'Publish lookbook' }).click();
  await expect(page.getByRole('status')).toContainText('Published.');
  const shop = await context.newPage();
  await shop.goto('http://127.0.0.1:3000/women/lookbook/issues/a-city-three-moods');
  await expect(shop.locator('main')).toContainText('32 pages / 12 looks');
  await shop.getByLabel('Go to page').selectOption('6');
  await shop.getByRole('button', { name: 'Shop this look · 2 pieces' }).click();
  await expect(shop.getByRole('dialog')).toContainText('Blush Pink');
  await expect(shop.getByRole('dialog')).toContainText('Mid Blue');
});
