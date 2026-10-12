import { expect, request, test } from '@playwright/test';
import { BASE, requireSyntheticData, session } from './support';

const RECORD = '[TEST] Willow Mutual Aid';

test.describe('admin (synthetic data)', () => {
  requireSyntheticData();

  /** Safety net: whatever happens in the UI test, leave the [TEST] record verified and published. */
  test.afterAll(async () => {
    let state: string;
    try {
      state = session('admin');
    } catch {
      return;
    }
    const ctx = await request.newContext({ baseURL: BASE, storageState: state });
    const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'nfa_csrf')?.value || '';
    const q = await (await ctx.get(`/api/admin/queue?q=${encodeURIComponent('Willow Mutual')}`)).json();
    const hit = (q.items || []).find((r: { name: string }) => r.name === RECORD);
    if (hit) {
      const h = { 'X-CSRF-Token': csrf };
      await ctx.post(`/api/admin/resources/${hit.id}/actions`, { headers: h, data: { action: 'verify', method: 'phone', notes: 'e2e cleanup' } });
      await ctx.post(`/api/admin/resources/${hit.id}/actions`, { headers: h, data: { action: 'publish', method: 'none' } });
    }
    await ctx.dispose();
  });

  test('D: admin flags, verifies by phone, and publishes a record', async ({ page, browser }) => {
    // Signed out, /admin asks to sign in (no sign-in is submitted: the saved session is used below).
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

    const ctx = await browser.newContext({ storageState: session('admin'), locale: 'en-US' });
    const a = await ctx.newPage();
    await a.goto(`${BASE}/admin`);
    await expect(a.getByRole('heading', { name: 'Review queue' })).toBeVisible();

    await a.getByLabel('Search name or address').fill('Willow');
    await a.getByRole('button', { name: 'Search', exact: true }).click();
    await a.getByRole('link', { name: RECORD }).click();
    await expect(a.getByRole('heading', { level: 1, name: RECORD })).toBeVisible();
    await expect(a.getByRole('heading', { name: /source record/ })).toBeVisible();

    const status = a.locator('[role="status"] .form-ok');
    await a.getByRole('button', { name: 'Flag for review' }).click();
    await expect(status).toContainText('Needs review');

    // verify without a method is refused client-side
    await a.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(a.getByText('Choose how you verified this record')).toBeVisible();
    await a.getByLabel('Verification method').selectOption('phone');
    await a.getByLabel('Notes').fill('Confirmed by phone (e2e)');
    await a.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(status).toContainText('Verify done');

    await a.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(status).toContainText('Publish done');
    await expect(a.locator('.review__head')).toContainText('Published');
    await expect(a.getByRole('table').filter({ hasText: 'Confirmed by phone (e2e)' })).toBeVisible();
    await ctx.close();
  });
});
