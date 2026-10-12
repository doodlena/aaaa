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

  test('R5: on desktop the explorer fits the window — the list scrolls inside its panel, the page does not', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/find?lat=38.86&lon=-77.1&label=ZIP%2022204');
    await expect(page.locator('.results__count')).toBeVisible();
    await expect(page.locator('.explorer__list li').first()).toBeVisible();
    const m = await page.evaluate(() => {
      const list = document.querySelector('.explorer__list')!;
      return { page: document.documentElement.scrollHeight, window: innerHeight, list: list.scrollHeight, listBox: list.clientHeight };
    });
    expect(m.list).toBeGreaterThan(m.listBox); // there is more list than fits…
    expect(m.page).toBeLessThanOrEqual(m.window); // …but only the list panel scrolls
    // folding the search options away gives the list and map at least three quarters of the window
    await page.getByRole('button', { name: 'Hide search options' }).click();
    const share = await page.evaluate(() => document.querySelector('.explorer__body')!.getBoundingClientRect().height / innerHeight);
    expect(share).toBeGreaterThanOrEqual(0.75);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  });
});
