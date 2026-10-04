import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { acquireFooterMenuLock } from '../e2e-storefront/footer-menu-lock';
import { API_URL, ROLE_EMAILS, RUN, confirmDialog, ensureStaff, expectOk, loginAs, prisma, provisionStyle, type Fixture, type ProvisionedStyle } from './p1-fixtures';

/**
 * Admin Ops Phase 1 (docs/admin/ADMIN_OPS_PHASE1.md), desktop browser
 * flows. Each flow drives the real admin UI against the real API and checks
 * the outcome in the database and, where it matters, on the storefront.
 *
 * WALKTHROUGH_DIR=<dir> also saves a screenshot of each screen for the
 * desktop walkthrough (docs/admin/screenshots/).
 */
const STOREFRONT_URL = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);

async function shot(page: Page, name: string) {
  const dir = process.env.WALKTHROUGH_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function loginAsOwner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

const stepButton = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Product steps' }).getByRole('button', { name });

let fx: Fixture;

/**
 * This spec's own prerequisites (its own brand and sizes, the shared
 * merchandising login), so it never collides with p1-console's fixture
 * when both run in one worker.
 */
async function setUpOwnFixture(): Promise<Fixture> {
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  const { token } = await expectOk<{ token: string }>(await api.post('/api/v1/auth/staff/login', { data: { email: OWNER_EMAIL, password: OWNER_PASSWORD } }), 'Owner login');
  const auth = { authorization: `Bearer ${token}` };
  await ensureStaff(ROLE_EMAILS.MERCHANDISING, 'MERCHANDISING', 'E2E P1 merchandising');
  const category = await prisma.category.upsert({ where: { slug: 'e2e-p1-category' }, update: {}, create: { name: 'E2E P1 Category', slug: 'e2e-p1-category' } });
  const sizes = [];
  for (const [i, label] of ['P1-S', 'P1-M'].entries()) sizes.push(await prisma.size.upsert({ where: { label }, update: {}, create: { label, sortOrder: 100 + i } }));
  const brand = await expectOk<{ id: string; code: string; name: string }>(
    await api.post('/api/v1/organization/brands', { headers: auth, data: { code: `AOB${RUN}`, name: `AO Brand ${RUN}` } }),
    'Brand',
  );
  const none = { id: '', code: '', name: '' };
  return { api, auth, brand, categoryId: category.id, sizes, locationA: none, locationB: none };
}
let published: ProvisionedStyle;

test.describe('Admin Ops Phase 1: owner workflows', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    fx = await setUpOwnFixture();
    published = await provisionStyle(fx, `AO Linen Shirt ${RUN}`, 1299);
    await prisma.category.upsert({ where: { slug: 'e2e-ao-shoes' }, update: { productType: 'FOOTWEAR' }, create: { name: 'E2E AO Shoes', slug: 'e2e-ao-shoes', productType: 'FOOTWEAR' } });
    await prisma.category.upsert({ where: { slug: 'e2e-ao-perfume' }, update: { productType: 'FRAGRANCE' }, create: { name: 'E2E AO Perfume', slug: 'e2e-ao-perfume', productType: 'FRAGRANCE' } });
    for (const [i, label] of ['UK8', 'UK9', '50ml'].entries()) await prisma.size.upsert({ where: { label }, update: {}, create: { label, sortOrder: 100 + i } });
  });

  test.afterAll(async () => {
    for (const key of ['footer-about', 'footer-social']) {
      await fx.api.put(`/api/v1/cms/navigation-menus/${key}`, { headers: fx.auth, data: { items: [] } });
    }
    await fx.api.dispose();
  });

  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test('AO-01 category-appropriate onboarding: shoes ask for material, closure and shoe sizes; perfume for scent and volume', async ({ page }) => {
    const code = `AO-SHOE-${RUN}`;
    await loginAs(page, 'MERCHANDISING');
    await page.evaluate(() => localStorage.removeItem('fcp_admin_new_product_draft'));
    await page.goto('/dashboard/products/new');
    await page.getByLabel('Style code').fill(code);
    await page.getByLabel('Product name').fill('AO Derby Shoe');
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'E2E AO Shoes (shoes)' });
    await expect(page.getByRole('group', { name: 'Shoes details' })).toBeVisible();
    await expect(page.getByLabel('Material')).toBeVisible();
    await expect(page.getByLabel('Fit', { exact: true })).toHaveCount(0);
    await page.getByLabel('Closure').fill('Lace-up');
    await page.getByLabel('Material').fill('Genuine leather upper');
    await page.getByLabel('Department').selectOption('Men');
    await page.getByLabel('Brand', { exact: true }).selectOption({ label: fx.brand.name });
    await page.getByLabel('Season', { exact: true }).fill('SS26');
    await page.getByLabel('Collection', { exact: true }).fill('Business Casual');
    await shot(page, '01-new-product-shoes');
    await page.getByRole('button', { name: 'Save draft and continue' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Shoe sizes you sell' })).toBeVisible();
    await expect(page.getByLabel('UK8')).toBeVisible();
    await expect(page.getByLabel('XL', { exact: true })).toHaveCount(0); // clothing sizes are not offered for shoes
    await page.getByLabel('New colour').fill('Tan');
    await page.getByRole('button', { name: 'Add colour' }).click();
    await expect(page.getByText('Tan added.')).toBeVisible();
    await page.getByLabel('UK8').check();
    await page.getByLabel('UK9').check();
    await page.getByRole('button', { name: 'Add 2 sizes (2 SKUs)' }).click();
    await expect(page.getByText('Added 2 sizes.')).toBeVisible();
    await shot(page, '02-variants-shoes');

    const style = await prisma.style.findUniqueOrThrow({ where: { styleCode: code }, include: { skus: { orderBy: { skuCode: 'asc' } } } });
    expect(style).toMatchObject({ fabric: 'Genuine leather upper', gender: 'Men', lifecycleState: 'DRAFT' });
    expect(style.customAttributes).toMatchObject({ productType: 'footwear', closureType: 'Lace-up' });
    expect(style.skus.map((s) => s.skuCode)).toEqual([`${code}-TAN-UK8`, `${code}-TAN-UK9`]);

    // Perfume: the same steps speak of fragrances and volumes.
    await page.evaluate(() => localStorage.removeItem('fcp_admin_new_product_draft'));
    await page.goto('/dashboard/products/new');
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'E2E AO Perfume (perfume)' });
    await expect(page.getByLabel('Top notes')).toBeVisible();
    await expect(page.getByLabel('Concentration')).toBeVisible();
    await expect(page.getByLabel('Category', { exact: true }).locator('xpath=..').getByText('ask for fragrance and volume')).toBeVisible();
  });

  test('AO-02 an unsaved draft survives a reload, errors keep what was typed, and editing a live product reaches the storefront', async ({ page }) => {
    await loginAs(page, 'MERCHANDISING');
    await page.evaluate(() => localStorage.removeItem('fcp_admin_new_product_draft'));
    await page.goto('/dashboard/products/new');
    await page.getByLabel('Style code').fill(`AO-DRAFT-${RUN}`);
    await page.getByLabel('Product name').fill('Half-typed Kurti');
    await page.reload();
    await expect(page.getByText('Restored what you typed last time.')).toBeVisible();
    await expect(page.getByLabel('Product name')).toHaveValue('Half-typed Kurti');
    await page.getByRole('button', { name: 'Save draft and continue' }).click();
    await expect(page.getByText('Category is required.')).toBeVisible();
    await expect(page.getByLabel('Style code')).toHaveValue(`AO-DRAFT-${RUN}`);
    expect(await prisma.style.findUnique({ where: { styleCode: `AO-DRAFT-${RUN}` } })).toBeNull();

    // Edit a published product from the list.
    await page.goto('/dashboard/products');
    await page.getByLabel('Search').fill(published.styleCode);
    await page.getByRole('link', { name: new RegExp(published.styleCode) }).click();
    await stepButton(page, /Basics/).click();
    const newName = `AO Linen Shirt Relaxed ${RUN}`;
    await page.getByLabel('Product name').fill(newName);
    await page.getByLabel('Short description').fill('Breathable linen for warm days');
    await page.getByRole('button', { name: 'Save basics' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await shot(page, '03-basics-edit');
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();

    const storefront = await playwrightRequest.newContext({ baseURL: STOREFRONT_URL });
    await expect.poll(async () => (await (await storefront.get(`/product/${published.styleId}`)).text()).includes(newName), { timeout: 15_000 }).toBe(true);
    await storefront.dispose();
  });

  test('AO-03 photos: upload, listing photo, order, replace and remove, with a bad file refused', async ({ page }) => {
    await loginAs(page, 'MERCHANDISING');
    await page.goto(`/dashboard/products/${published.styleId}?step=photos`);
    await page.getByLabel('Choose photos to upload').setInputFiles([
      { name: 'front.png', mimeType: 'image/png', buffer: PNG },
      { name: 'back.png', mimeType: 'image/png', buffer: PNG },
      { name: 'not-a-photo.png', mimeType: 'image/png', buffer: Buffer.from('<html>not an image</html>') },
    ]);
    await expect(page.getByText('2 of 3 uploaded.')).toBeVisible();
    await expect(page.getByText(/not-a-photo\.png: Upload a JPEG, PNG or WebP photo/)).toBeVisible();

    const uploaded = await prisma.productMedia.findMany({ where: { styleId: published.styleId, storageKey: { not: null } }, orderBy: { sortOrder: 'asc' } });
    expect(uploaded).toHaveLength(2);
    const back = uploaded[1]!;
    const photos = page.getByRole('list', { name: 'Product photos in display order' }).getByRole('listitem');
    const backCard = photos.filter({ has: page.locator(`img[src$="${back.storageKey}"]`) });
    await backCard.getByRole('button', { name: 'Use as listing photo' }).click();
    await expect(page.getByText('Listing photo set.')).toBeVisible();
    await expect(backCard.getByText('Listing photo')).toBeVisible();
    // The admin really displays the uploaded photo (served by the API, another origin).
    await expect.poll(() => backCard.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await shot(page, '04-photos');

    // Storefront listings (search results) show the chosen photo.
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    await expect
      .poll(async () => JSON.stringify(await (await api.get(`/api/v1/storefront/search?q=${encodeURIComponent(published.name)}`)).json()).includes(`"thumbnailUrl":"${back.url}"`), { timeout: 15_000 })
      .toBe(true);
    await api.dispose();

    // Move it to the front, replace the other, then remove one.
    await backCard.getByRole('button', { name: /earlier/ }).click();
    await expect.poll(async () => (await prisma.productMedia.findUniqueOrThrow({ where: { id: back.id } })).sortOrder).toBeLessThan(uploaded[0]!.sortOrder + 1);
    const frontCard = photos.filter({ has: page.locator(`img[src$="${uploaded[0]!.storageKey}"]`) });
    await frontCard.getByLabel(/Choose a replacement/).setInputFiles({ name: 'front-v2.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(page.getByText('Photo replaced.')).toBeVisible();
    const replaced = await prisma.productMedia.findUniqueOrThrow({ where: { id: uploaded[0]!.id } });
    expect(replaced.mimeType).toBe('image/jpeg');
    expect(replaced.url).not.toBe(uploaded[0]!.url);

    const storefront = await playwrightRequest.newContext({ baseURL: STOREFRONT_URL });
    expect((await storefront.get(replaced.url)).status()).toBe(200);
    expect((await storefront.get(uploaded[0]!.url)).status()).toBe(404); // the old file is no longer served

    const replacedCard = photos.filter({ has: page.locator(`img[src$="${replaced.storageKey}"]`) });
    await replacedCard.getByRole('button', { name: 'Remove' }).click();
    await confirmDialog(page, 'Remove photo');
    await expect(page.getByText('Photo removed.')).toBeVisible();
    expect(await prisma.productMedia.findUnique({ where: { id: replaced.id } })).toBeNull();
    expect((await storefront.get(replaced.url)).status()).toBe(404);
    await storefront.dispose();
  });

  test('AO-04 import: dry run changes nothing, problem rows are explained, good rows import as drafts without stock, and a corrected file finishes the job', async ({ page }) => {
    const ok = `AO-IMP-${RUN}`;
    const bad = `AO-BAD-${RUN}`;
    const csv = (badSize: string) =>
      [
        'Style code,Product name,Brand,Category,Season,Collection,Colour,Size,MRP,Selling price,Barcode,Stock',
        `${ok},Imported Polo,${fx.brand.code},E2E P1 Category,SS26,Core,Olive,P1-S,1499,1199,AO${RUN}01,25`,
        `${ok},,,,,,Olive,P1-M,1499,1199,AO${RUN}02,25`,
        `${bad},Imported Tee,${fx.brand.code},E2E P1 Category,SS26,Core,White,${badSize},999,799,,10`,
      ].join('\n');

    await loginAs(page, 'MERCHANDISING');
    await page.goto('/dashboard/products/import');
    await page.getByLabel('CSV file').setInputFiles({ name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from(csv('XXL-NOT-SET-UP')) });
    await expect(page.getByText('Not imported: Stock.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Stock/ }).getByText('Not imported (stock)')).toBeVisible();
    await shot(page, '05-import-mapping');
    await page.getByRole('button', { name: 'Check the file (nothing is saved)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'to create' })).toContainText('2 to create');
    await expect(page.getByText(/Size "XXL-NOT-SET-UP" is not set up/)).toBeVisible();
    await shot(page, '06-import-check');
    expect(await prisma.style.count({ where: { styleCode: { in: [ok, bad] } } })).toBe(0); // the check saved nothing

    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await expect(page.getByRole('heading', { name: '6. Results' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'created' })).toContainText('2 created');
    await shot(page, '07-import-results');
    const imported = await prisma.style.findUniqueOrThrow({ where: { styleCode: ok }, include: { skus: true, prices: true } });
    expect(imported.lifecycleState).toBe('DRAFT');
    expect(imported.skus.map((s) => s.barcode).sort()).toEqual([`AO${RUN}01`, `AO${RUN}02`]);
    expect(Number(imported.prices[0]!.sellingPrice)).toBe(1199);
    expect(await prisma.inventoryBalance.count({ where: { skuId: { in: imported.skus.map((s) => s.id) } } })).toBe(0);
    expect(await prisma.style.findUnique({ where: { styleCode: bad } })).toBeNull();

    // Retry with the corrected file: finished rows stay, the fixed product goes in.
    await page.goto('/dashboard/products/import');
    await page.getByLabel('CSV file').setInputFiles({ name: 'catalogue-fixed.csv', mimeType: 'text/csv', buffer: Buffer.from(csv('P1-S')) });
    await page.getByRole('button', { name: 'Check the file (nothing is saved)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'to create' })).toContainText('1 to create');
    await expect(page.getByRole('status').filter({ hasText: 'to create' })).toContainText('2 unchanged');
    await page.getByRole('button', { name: 'Import 1 row' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'created' })).toContainText('1 created');
    expect((await prisma.style.findUniqueOrThrow({ where: { styleCode: bad } })).lifecycleState).toBe('DRAFT');
    expect(await prisma.sku.count({ where: { style: { styleCode: ok } } })).toBe(2);
  });

  test('AO-05 navigation menu: visual editing, link checks, and the footer link appearing on the storefront', async ({ page }) => {
    // test/e2e-storefront/cms-pages.spec.ts rewrites the same footer menus.
    const releaseMenus = await acquireFooterMenuLock(prisma);
    try {
      await editFooterMenu(page);
    } finally {
      await fx.api.put('/api/v1/cms/navigation-menus/footer-about', { headers: fx.auth, data: { items: [] } });
      await releaseMenus();
    }
  });

  async function editFooterMenu(page: Page) {
    const slug = `ao-story-${RUN.toLowerCase()}`;
    const created = await expectOk<{ id: string }>(await fx.api.post('/api/v1/cms/landing-pages', { headers: fx.auth, data: { slug, title: `AO Story ${RUN}` } }), 'Create page');
    await expectOk(await fx.api.post(`/api/v1/cms/landing-pages/${created.id}/publish`, { headers: fx.auth }), 'Publish page');
    await fx.api.put('/api/v1/cms/navigation-menus/footer-about', { headers: fx.auth, data: { items: [] } });

    await loginAsOwner(page);
    await page.goto('/dashboard/cms/navigation-menus');
    await expect(page.getByLabel('Menu', { exact: true })).toHaveValue('footer-about');
    await page.getByRole('button', { name: 'Add a link' }).click();
    const first = page.getByRole('list', { name: 'Menu links in order' }).getByRole('listitem').nth(0);
    await first.getByLabel('Label').fill('Our Story');
    await first.getByLabel('Page').selectOption({ label: `AO Story ${RUN}` });
    await page.getByRole('button', { name: 'Add a link' }).click();
    const second = page.getByRole('list', { name: 'Menu links in order' }).getByRole('listitem').nth(1);
    await second.getByLabel('Label').fill('Journal');
    await second.getByLabel('Links to').selectOption('web');
    await second.getByLabel('Web address').fill('http://journal.example.com');
    await page.getByRole('button', { name: 'Save menu' }).click();
    await expect(second.getByText('Web addresses must start with https://')).toBeVisible();
    await second.getByLabel('Web address').fill('https://journal.example.com');
    await second.getByRole('button', { name: 'Move Journal up' }).click();
    await page.getByRole('button', { name: 'Save menu' }).click();
    await expect(page.getByText(/^Saved\. The storefront footer shows the change/)).toBeVisible();
    await shot(page, '08-navigation-menu');

    const menu = await prisma.cmsNavigationMenu.findUniqueOrThrow({ where: { key: 'footer-about' } });
    expect(menu.items).toEqual([
      { label: 'Journal', url: 'https://journal.example.com', sortOrder: 1 },
      { label: 'Our Story', url: `/pages/${slug}`, sortOrder: 2 },
    ]);

    // The header menu is clearly marked as not read by the storefront.
    await page.getByLabel('Menu', { exact: true }).selectOption('main-nav');
    await expect(page.getByText(/does not change the header/)).toBeVisible();

    const shop = await page.context().newPage();
    await shop.addInitScript(() => localStorage.setItem('vanya_department', 'women'));
    await expect(async () => {
      await shop.goto(STOREFRONT_URL);
      await expect(shop.locator('footer').getByRole('link', { name: 'Our Story' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await expect(shop.locator('footer').getByRole('link', { name: 'Our Story' })).toHaveAttribute('href', `/pages/${slug}`);
    await shop.close();
  }

  test('AO-06 banners: a draft banner with an uploaded image is hidden until switched on', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto('/dashboard/cms/banners');
    const placement = page.getByRole('region', { name: 'Women: Home tastemakers' });
    await placement.getByRole('button', { name: 'Add banner' }).click();
    const drawer = page.getByRole('dialog', { name: 'New banner' });
    await drawer.getByLabel('Title').fill(`AO Tastemaker ${RUN}`);
    await drawer.getByLabel('Upload Image').setInputFiles({ name: 'look.png', mimeType: 'image/png', buffer: PNG });
    await expect(drawer.getByRole('img', { name: 'Chosen for this banner or page' })).toBeVisible();
    await shot(page, '09-banner-draft');
    await drawer.getByRole('button', { name: 'Save banner' }).click();
    await expect(page.getByRole('dialog', { name: 'New banner' })).toBeHidden();

    const banner = await prisma.cmsBanner.findFirstOrThrow({ where: { title: `AO Tastemaker ${RUN}` } });
    expect(banner.isActive).toBe(false);
    expect(banner.imageUrl).toMatch(/^\/media\/content\/[0-9a-f-]{36}\.png$/);
    const api = await playwrightRequest.newContext({ baseURL: API_URL });
    const live = async () => ((await (await api.get('/api/v1/storefront/cms/banners?placement=home-tastemakers-women')).json()) as Array<{ id: string }>).some((b) => b.id === banner.id);
    expect(await live()).toBe(false);
    await placement.getByRole('button', { name: 'Make live' }).click();
    await expect(page.getByText(`"AO Tastemaker ${RUN}" is live.`)).toBeVisible();
    expect(await live()).toBe(true);
    const storefront = await playwrightRequest.newContext({ baseURL: STOREFRONT_URL });
    expect((await storefront.get(banner.imageUrl)).status()).toBe(200);
    await storefront.dispose();
    await expectOk(await fx.api.patch(`/api/v1/cms/banners/${banner.id}`, { headers: fx.auth, data: { isActive: false } }), 'Switch banner off again');
    await api.dispose();
  });

  test('AO-07 setup & health and channel scope from admin', async ({ page }) => {
    const channel = await expectOk<{ id: string }>(await fx.api.post('/api/v1/channels', { headers: fx.auth, data: { key: `ao-${RUN.toLowerCase()}`, name: `AO Channel ${RUN}`, providerName: 'MOCK' } }), 'Create channel');

    await loginAsOwner(page);
    await page.getByRole('link', { name: 'Setup & health' }).click();
    await expect(page.getByRole('heading', { name: 'Setup & health', level: 1 })).toBeVisible();
    for (const title of ['Business details', 'Warehouse and pickup address', 'Photo storage', 'Online payments (Razorpay)', 'Courier', 'Publishing channels']) {
      await expect(page.getByRole('region', { name: title })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Online payments (Razorpay)' }).getByText('Incomplete')).toBeVisible();
    await page.getByRole('button', { name: 'Run storage test' }).click();
    await expect(page.getByText('Saved, read back and removed a test file.')).toBeVisible();
    await shot(page, '10-setup-health');

    await page.goto('/dashboard/channels');
    await page.getByLabel('Channel', { exact: true }).selectOption(channel.id);
    await page.getByLabel(/Every product that can be bought/).check();
    await expect(page.getByText(/now sends every product that can be bought/)).toBeVisible();
    await page.getByRole('button', { name: 'Pause channel' }).click();
    await confirmDialog(page, 'Pause');
    await expect(page.getByText(/Paused: nothing is sent/)).toBeVisible();
    await shot(page, '11-channel-settings');
    const stored = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(stored.isActive).toBe(false);
    expect(stored.config).toMatchObject({ publishAll: true });
  });

  test('AO-08 the readiness step separates published, purchasable, in stock and channel status and links to receiving', async ({ page }) => {
    await loginAs(page, 'MERCHANDISING');
    await page.goto(`/dashboard/products/${published.styleId}?step=readiness`);
    const cards = page.getByLabel('Product status');
    await expect(cards.locator('.status-label', { hasText: 'Published' })).toBeVisible();
    await expect(cards.getByText('Can be bought')).toBeVisible();
    await expect(cards.getByText('In stock')).toBeVisible();
    await expect(cards.getByText('On sales channels')).toBeVisible();
    // The fixture product is published with no stock: the stock card points to
    // receiving, which owns stock; the workspace never changes it.
    await expect(cards.getByText('0 units')).toBeVisible();
    await expect(cards.getByRole('link', { name: 'Receive goods' })).toHaveAttribute('href', '/dashboard/receiving');
    await shot(page, '12-readiness');
    await page.goto(`/dashboard/products/${published.styleId}?step=preview`);
    await shot(page, '13-preview');
  });
});
