import { expect, request, test, type APIRequestContext } from '@playwright/test';

/**
 * Open Shelf scenarios against the REAL backend. They only ever touch fictional "[TEST]" listings.
 */
const BASE = 'http://localhost:5173';
const STAFF = { email: process.env.E2E_PANTRY_EMAIL || 'pantry@localhost.test', password: process.env.E2E_PANTRY_PASSWORD || 'demo-pantry-password' };
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL || 'admin@localhost.test', password: process.env.E2E_ADMIN_PASSWORD || 'dev-admin-password-1' };
const MAPLE = '[TEST] Maple Community Pantry — Main Site';
const ORIGINAL_SHELF = {
  status: 'open',
  message: 'Fresh greens and eggs just arrived!',
  items: [
    { food_type: 'fresh_vegetables', level: 'plenty' },
    { food_type: 'eggs', level: 'some' },
    { food_type: 'dairy', level: 'low' },
  ],
  expires_at: null,
  ai_assisted: false,
};
const REPORT_NOTE = `e2e test report ${Date.now()}`;

async function testListingId(ctx: APIRequestContext, name: string): Promise<number> {
  const res = await (await ctx.get('/api/resources/search?sort=name&page_size=100&include_uncertain=false')).json();
  const hit = res.items.find((r: { name: string; is_synthetic: boolean }) => r.name === name && r.is_synthetic && r.name.startsWith('[TEST]'));
  if (!hit) throw new Error(`fixture listing not found: ${name}`);
  return hit.id;
}

async function signedIn(who: { email: string; password: string }) {
  const ctx = await request.newContext({ baseURL: BASE });
  const r = await ctx.post('/api/auth/login', { data: who });
  if (!r.ok()) throw new Error(`login failed for ${who.email}`);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'nfa_csrf')?.value || '';
  return { ctx, h: { 'X-CSRF-Token': csrf } };
}

test.afterAll(async () => {
  // Safety net: put Maple's live shelf back to the demo state, and resolve the e2e report.
  try {
    const { ctx, h } = await signedIn(STAFF);
    const id = await testListingId(ctx, MAPLE);
    await ctx.post(`/api/provider/locations/${id}/shelf`, { headers: h, data: ORIGINAL_SHELF });
    await ctx.dispose();
  } catch {
    /* reported by the test itself */
  }
  try {
    const { ctx, h } = await signedIn(ADMIN);
    const reports = await (await ctx.get('/api/admin/reports?status=open')).json();
    for (const r of reports.items || []) {
      if (r.note === REPORT_NOTE && String(r.location_name).startsWith('[TEST]')) {
        await ctx.post(`/api/admin/reports/${r.id}/decision`, { headers: h, data: { decision: 'resolve', notes: 'e2e cleanup' } });
      }
    }
    await ctx.dispose();
  } catch {
    /* ignore */
  }
});

test('G: pantry staff posts "Open" with produce; a guest sees "Posted by the pantry"', async ({ page, browser }) => {
  await page.goto('/pantry');
  await expect(page).toHaveURL(/\/login\?next=%2Fpantry/);
  await page.getByLabel('Email').fill(STAFF.email);
  await page.getByLabel('Password').fill(STAFF.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'For pantries' })).toBeVisible();

  await page.getByRole('link', { name: MAPLE, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: MAPLE })).toBeVisible();

  // Post exactly the demo state (so the fixture is restored by the test itself).
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  for (const [food, level] of [
    ['Fresh vegetables', 'plenty'],
    ['Eggs', 'some'],
    ['Dairy', 'low'],
  ] as const) {
    const box = page.getByRole('checkbox', { name: food, exact: true });
    if (!(await box.isChecked())) await box.check();
    await page.getByLabel(`How much ${food}`).selectOption(level);
  }
  await page.getByLabel(/Short message for families/).fill(ORIGINAL_SHELF.message);
  await expect(page.locator('.preview')).toContainText('Posted by the pantry');
  await page.getByRole('button', { name: 'Post to families' }).click();
  await expect(page.getByText('Posted. Families can see it now.')).toBeVisible();

  // A guest (fresh context, not signed in) sees the live post on the public detail page.
  const guest = await browser.newContext({ locale: 'en-US' });
  const g = await guest.newPage();
  const id = await testListingId(guest.request, MAPLE);
  await g.goto(`${BASE}/resource/${id}`);
  const today = g.getByTestId('today-section');
  await expect(today.getByText('Posted by the pantry')).toBeVisible();
  await expect(today.getByText('Open today')).toBeVisible();
  await expect(today.getByText('Fresh vegetables')).toBeVisible();
  await expect(today.getByText('Plenty')).toBeVisible();
  await guest.close();
});

test('H: a guest reports a problem on a [TEST] pantry and sees a confirmation', async ({ page }) => {
  const id = await testListingId(page.request, MAPLE);
  await page.goto(`/resource/${id}`);
  await page.getByRole('button', { name: 'Report a problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog.getByText(/No name, account or location is stored/)).toBeVisible();
  await dialog.getByRole('radio', { name: 'Something else' }).check();
  await dialog.getByLabel(/Tell us more/).fill(REPORT_NOTE);
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByText('Thank you. Your report was sent.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toHaveCount(0);
});

test('I: the visit planner shows a checklist and a calendar link', async ({ page }) => {
  const id = await testListingId(page.request, MAPLE);
  await page.goto(`/resource/${id}`);
  const planner = page.getByTestId('visit-planner');
  await expect(planner.getByRole('heading', { name: 'Plan your visit' })).toBeVisible();
  const list = planner.getByRole('list', { name: 'What to bring' });
  await expect(list.locator('li')).toHaveCount(7);
  // unknown requirements are "ask", never "not needed"
  for (const row of await list.locator('li[data-action="ask"]').all()) {
    await expect(row).toContainText('Ask the pantry — not confirmed');
    await expect(row).not.toContainText('Not needed');
  }
  const cal = planner.getByTestId('calendar-link');
  await expect(cal).toHaveAttribute('href', /\/calendar\.ics$/);
  const res = await page.request.get(`${BASE}${await cal.getAttribute('href')}`);
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('BEGIN:VCALENDAR');
});
