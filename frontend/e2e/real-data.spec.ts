import { expect, test } from '@playwright/test';

/**
 * Read-only scenarios that work against the REAL imported listings (no [TEST] data needed). They never sign in, post,
 * report or save anything, so they cannot modify real records.
 */
test.describe('real data (read-only)', () => {
  test('R1: ZIP 22204 shows real listings labelled "From a public list; not yet verified"', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Your address or ZIP code').fill('22204');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/find\?.*lat=/);
    const list = page.getByRole('list', { name: 'Places that match' });
    await expect(list).toBeVisible();
    const reported = list.locator(':scope > li').filter({ has: page.getByTestId('verification-badge').filter({ hasText: 'From a public list; not yet verified' }) });
    expect(await reported.count()).toBeGreaterThan(0);
    // Status is never colour only: the badge is the dotted variant with its own icon + words.
    await expect(reported.first().getByTestId('verification-badge')).toHaveClass(/badge--reported/);

    await reported.first().getByRole('link', { name: 'See details' }).click();
    await expect(page).toHaveURL(/\/resource\/\d+/);
    await expect(page.getByText(/has not been checked by a Lantern reviewer yet/)).toBeVisible();
  });

  test('R2: "Mental health and crisis" builds the right URL and always shows 988 / 911', async ({ page }) => {
    await page.goto('/');
    // 988 is in the footer of every page (the desktop explorer hides the footer, so check it here)
    await expect(page.getByTestId('footer-crisis').getByRole('link', { name: 'Call 988' })).toHaveAttribute('href', 'tel:988');
    const needs = page.getByRole('navigation', { name: 'What do you need?' });
    await needs.getByRole('link', { name: /^Mental health and crisis/ }).click();
    await expect(page).toHaveURL(/\/find\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('service_group')).toBe('mental_health');
    expect(url.searchParams.get('food_group')).toBeNull();

    const callout = page.getByTestId('crisis-callout');
    await expect(callout).toContainText('In crisis? Call or text 988 (Suicide & Crisis Lifeline), available 24/7. In an emergency call 911.');
    await expect(callout.getByRole('link', { name: 'Call 988' })).toHaveAttribute('href', 'tel:988');
    await expect(callout.getByRole('link', { name: 'Text 988' })).toHaveAttribute('href', 'sms:988');
    await expect(callout.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
    // the explorer chip shows the same need as selected
    await expect(page.getByRole('group', { name: 'What do you need?' }).getByRole('button', { name: /Mental health and crisis/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('R3: a non-food need hides the food filters', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'What do you need?' }).getByRole('link', { name: /^Legal and immigration/ }).click();
    await expect(page).toHaveURL(/service_group=legal/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('crisis-callout')).toHaveCount(0);
    // Open the filters (drawer on narrow screens, sidebar on desktop) and check the food groups are gone.
    await expect(page.getByRole('group', { name: 'Type of food' })).toHaveCount(0);
    await expect(page.getByText(/Food filters are hidden/)).toBeVisible();
  });

  test("R4: Explore all of Virginia's 8th District searches by area + bbox and paginates", async ({ page }) => {
    await page.goto('/');
    const searches: URL[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/resources/search')) searches.push(new URL(r.url()));
    });
    await page.getByRole('link', { name: "Explore all of Virginia's 8th District" }).click();
    await expect(page).toHaveURL(/area=va-08/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Help in Virginia's 8th Congressional District/);
    await expect(page.locator('.results__count')).toContainText(/places? match/);
    await expect(page.getByLabel('Area')).toHaveValue('va-08');
    expect(searches.some((u) => u.searchParams.get('area') === 'va-08' && u.searchParams.get('bbox') === '-77.24,38.6,-77.03,38.97')).toBe(true);
    // the map gets the whole district (page_size=100); the list is paginated
    expect(searches.some((u) => u.searchParams.get('area') === 'va-08' && u.searchParams.get('page_size') === '100')).toBe(true);
    await expect(page.locator('.explorer__area-note')).toContainText(/The map shows (all )?\d+ place/);
    const total = Number((await page.locator('.results__count').textContent())?.match(/\d+/)?.[0] || 0);
    if (total > 25) {
      const pager = page.getByRole('navigation', { name: 'Result pages' });
      await pager.getByRole('button', { name: 'Next' }).click();
      await expect(page).toHaveURL(/page=2/);
    }
  });
});
