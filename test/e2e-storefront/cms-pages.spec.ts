import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';

const API_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  if (!res.ok()) throw new Error(`${label} failed: ${res.status()} ${await res.text().catch(() => '')}`);
  return res.json();
}

/**
 * specs/28-admin.md: landing pages and navigation menus change without a
 * deployment. Staff publish a page and the footer menus through the CMS API
 * (the same calls admin → Content makes); the storefront shows exactly that,
 * as plain text, and drops unsafe links.
 */
test.describe('CMS content pages and footer menus', () => {
  let api: APIRequestContext;
  let auth: Record<string, string>;
  const stamp = `${Date.now()}`;
  const slug = `e2e-our-story-${stamp}`;
  const draftSlug = `e2e-draft-${stamp}`;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: API_URL });
    const { token } = (await expectOk(await api.post('/api/v1/auth/staff/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }), 'Staff login')) as { token: string };
    auth = { authorization: `Bearer ${token}` };

    await expectOk(await api.post('/api/v1/cms/content-blocks', {
      headers: auth,
      data: {
        key: `e2e-story-block-${stamp}`,
        title: 'Where we began',
        content: 'VANYA started with three looms.\n\n<script>window.__cmsInjected = true</script> is shown as text, never run.',
      },
    }), 'Create content block');
    const page = (await expectOk(await api.post('/api/v1/cms/landing-pages', {
      headers: auth,
      data: { slug, title: 'Our Story', metaDescription: 'How VANYA began.', blockKeys: [`e2e-story-block-${stamp}`] },
    }), 'Create landing page')) as { id: string };
    await expectOk(await api.post(`/api/v1/cms/landing-pages/${page.id}/publish`, { headers: auth }), 'Publish landing page');
    await expectOk(await api.post('/api/v1/cms/landing-pages', {
      headers: auth,
      data: { slug: draftSlug, title: 'Not yet approved', blockKeys: [] },
    }), 'Create draft landing page');

    // Admin Ops Phase 1: the server refuses a link the storefront would
    // drop, naming the item (the storefront's own filter stays as a second
    // line of defence, covered by apps/storefront/test/cms-links.test.ts).
    const unsafe = await api.put('/api/v1/cms/navigation-menus/footer-about', {
      headers: auth,
      data: { items: [{ label: 'Our Story', url: `/pages/${slug}`, sortOrder: 1 }, { label: 'Unsafe link', url: 'javascript:alert(1)', sortOrder: 2 }] },
    });
    expect(unsafe.status()).toBe(400);
    await expectOk(await api.put('/api/v1/cms/navigation-menus/footer-about', {
      headers: auth,
      data: { items: [{ label: 'Our Story', url: `/pages/${slug}`, sortOrder: 1 }] },
    }), 'Set footer-about menu');
    await expectOk(await api.put('/api/v1/cms/navigation-menus/footer-social', {
      headers: auth,
      data: { items: [{ label: 'Instagram', url: 'https://instagram.com/vanya-e2e', sortOrder: 1 }] },
    }), 'Set footer-social menu');
  });

  test.afterAll(async () => {
    // Clear the menus so other tests see the default footer. The published page stays,
    // so any link another test already saw still resolves.
    for (const key of ['footer-about', 'footer-social']) {
      await api.put(`/api/v1/cms/navigation-menus/${key}`, { headers: auth, data: { items: [] } });
    }
    await api.dispose();
  });

  test('the footer shows the published About and social links, and the page renders as plain text', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('vanya_department', 'women'));
    const footer = page.locator('footer');
    // CMS changes purge the storefront cache; allow for the purge to land.
    await expect(async () => {
      await page.goto('/');
      await expect(footer.getByRole('link', { name: 'Our Story' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });

    await expect(footer.getByRole('link', { name: 'Unsafe link' })).toHaveCount(0);
    const instagram = footer.getByRole('link', { name: 'Instagram (opens in a new tab)' });
    await expect(instagram).toHaveText('IG');
    await expect(instagram).toHaveAttribute('href', 'https://instagram.com/vanya-e2e');
    await expect(instagram).toHaveAttribute('rel', 'noopener noreferrer');

    await footer.getByRole('link', { name: 'Our Story' }).click();
    await expect(page).toHaveURL(new RegExp(`/pages/${slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Our Story' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Where we began' })).toBeVisible();
    await expect(page.getByText('VANYA started with three looms.')).toBeVisible();
    // Staff text containing markup is shown literally, never executed.
    await expect(page.getByText('<script>window.__cmsInjected = true</script> is shown as text, never run.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __cmsInjected?: boolean }).__cmsInjected)).toBeUndefined();
    await expect(page).toHaveTitle(/Our Story/);
  });

  test('unpublished, unknown and legal slugs are not served as content pages', async ({ page }) => {
    for (const path of [`/pages/${draftSlug}`, `/pages/e2e-no-such-page-${stamp}`, '/pages/legal-privacy', '/pages/Bad%20Slug']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
