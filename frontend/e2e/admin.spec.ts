import { expect, request, test } from '@playwright/test';

const ADMIN = { email: process.env.E2E_ADMIN_EMAIL || 'admin@localhost.test', password: process.env.E2E_ADMIN_PASSWORD || 'dev-admin-password-1' };
const RECORD = '[TEST] Willow Mutual Aid';

/** Safety net: whatever happens in the UI test, leave the record verified and published. */
test.afterAll(async () => {
  const ctx = await request.newContext({ baseURL: 'http://localhost:5173' });
  const login = await ctx.post('/api/auth/login', { data: ADMIN });
  if (!login.ok()) return ctx.dispose();
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'nfa_csrf')?.value || '';
  const q = await (await ctx.get(`/api/admin/queue?q=${encodeURIComponent('Willow Mutual')}`)).json();
  const id = q.items?.[0]?.id;
  if (id) {
    const h = { 'X-CSRF-Token': csrf };
    await ctx.post(`/api/admin/resources/${id}/actions`, { headers: h, data: { action: 'verify', method: 'phone', notes: 'e2e cleanup' } });
    await ctx.post(`/api/admin/resources/${id}/actions`, { headers: h, data: { action: 'publish', method: 'none' } });
  }
  await ctx.dispose();
});

test('D: admin flags, verifies by phone, and publishes a record', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

  await page.getByLabel('Search name or address').fill('Willow');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: RECORD }).click();
  await expect(page.getByRole('heading', { level: 1, name: RECORD })).toBeVisible();
  await expect(page.getByRole('heading', { name: /source record/ })).toBeVisible();

  const status = page.locator('[role="status"] .form-ok');
  await page.getByRole('button', { name: 'Flag for review' }).click();
  await expect(status).toContainText('Needs review');

  // verify without a method is refused client-side
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Choose how you verified this record')).toBeVisible();
  await page.getByLabel('Verification method').selectOption('phone');
  await page.getByLabel('Notes').fill('Confirmed by phone (e2e)');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(status).toContainText('Verify done');

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(status).toContainText('Publish done');
  await expect(page.locator('.review__head')).toContainText('Published');
  await expect(page.getByRole('table').filter({ hasText: 'Confirmed by phone (e2e)' })).toBeVisible();
});
