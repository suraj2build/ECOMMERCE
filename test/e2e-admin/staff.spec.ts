import { test, expect, type Page } from '@playwright/test';
import { RUN, prisma } from './p1-fixtures';

/**
 * Staff management (AO-D7) in the browser: the owner adds a person, the
 * temporary password is shown once, the person must choose their own
 * before anything else, a password reset signs them out, and a
 * deactivated person cannot sign in.
 */
const OWNER_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@example.com';
const OWNER_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('AO-12 staff: add a person, temporary password shown once, forced change, reset signs them out, deactivation blocks sign-in', async ({ page, browser }) => {
  const email = `staff-${RUN}@example.com`.toLowerCase();
  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
  await page.waitForURL('**/dashboard');
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff', exact: true })).toBeVisible();

  // Add: the button stays off until a role is chosen.
  const add = page.getByRole('region', { name: 'Add a person' });
  await add.getByLabel('Full name').fill('Meera Shah');
  await add.getByLabel('Email').fill(email);
  await expect(add.getByRole('button', { name: 'Add person' })).toBeDisabled();
  await add.getByLabel('Warehouse Manager').check();
  await add.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Meera Shah was added.')).toBeVisible();
  const temporary = (await page.getByLabel('Temporary password').textContent())!.trim();
  expect(temporary).toMatch(/^[A-Za-z2-9]{16}$/);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Temporary password not changed yet')).toBeVisible();
  // Hidden once dismissed, and never shown again.
  await page.getByRole('button', { name: /I have passed it on/ }).click();
  await expect(page.getByText(temporary)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(temporary)).toHaveCount(0);

  // The person signs in with it and can only choose a new password.
  const theirs = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const person = await theirs.newPage();
  await signIn(person, email, temporary);
  await person.waitForURL('**/change-password');
  await expect(person.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
  await person.goto('/dashboard/orders');
  await person.waitForURL('**/change-password');
  await person.getByLabel('Temporary password').fill(temporary);
  // Long enough for the field's own length check, but refused by the server's rule.
  await person.getByLabel('New password', { exact: true }).fill('onlylettershere');
  await person.getByLabel('New password again').fill('onlylettershere');
  await person.getByRole('button', { name: 'Save new password' }).click();
  await expect(person.getByRole('alert').filter({ hasText: 'Use letters and at least one number' })).toBeVisible();
  expect((await prisma.staffUser.findUniqueOrThrow({ where: { email } })).mustChangePassword).toBe(true);
  await person.getByLabel('New password', { exact: true }).fill(`Meera${RUN}Godown9`);
  await person.getByLabel('New password again').fill(`Meera${RUN}Godown9`);
  await person.getByRole('button', { name: 'Save new password' }).click();
  await person.waitForURL('**/dashboard');
  await expect(person.getByRole('heading', { name: 'Overview' })).toBeVisible();
  expect((await prisma.staffUser.findUniqueOrThrow({ where: { email } })).mustChangePassword).toBe(false);

  // The owner resets the password: a new one is shown once, and the person is signed out.
  await page.reload();
  await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Reset password' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText("Meera Shah's password was reset and they were signed out.")).toBeVisible();
  const second = (await page.getByLabel('Temporary password').textContent())!.trim();
  expect(second).not.toBe(temporary);
  await person.goto('/dashboard/orders');
  await expect(person.getByText('Your session has expired. Please sign in again.').first()).toBeVisible();

  // Deactivated: the person cannot sign in at all.
  await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText('Meera Shah was deactivated and signed out. They can no longer sign in.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: email }).getByText('Deactivated')).toBeVisible();
  await signIn(person, email, second);
  await expect(person.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
  await theirs.close();

  // The owner's own row offers no actions on themselves.
  await expect(page.getByRole('row').filter({ hasText: OWNER_EMAIL }).getByText('Change your own password from the sidebar')).toBeVisible();
});
