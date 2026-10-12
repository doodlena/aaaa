import { expect, test } from '@playwright/test';
import { demoMode, SYNTHETIC_SKIP } from './support';

// Creates an account and saves a place: only run against demo data, never on a database with real users.
test('C: register, save a favorite, sign out, sign in, favorite is still there', async ({ page }) => {
  test.skip(!(await demoMode()), SYNTHETIC_SKIP);
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'e2e-password-123';

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Type your password again').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.goto('/find?lat=38.86&lon=-77.099&label=ZIP%2022204');
  const first = page.getByRole('list', { name: 'Places that match' }).locator(':scope > li').first();
  const name = (await first.locator('h3 a').textContent())!.trim();
  await first.getByRole('link', { name: 'See details' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Saved places' }).click();
  await expect(page.getByRole('heading', { name: 'Saved places' })).toBeVisible();
  await expect(page.getByRole('link', { name })).toBeVisible();
});
