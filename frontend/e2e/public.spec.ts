import { expect, test } from '@playwright/test';

test.describe('public site', () => {
  test('A: guest searches ZIP 22204, filters groceries, opens a resource with OSM directions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Demo data: listings marked [TEST] are fictional.')).toBeVisible();
    await page.getByLabel('Your address or ZIP code').fill('22204');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/find\?.*lat=/);
    const count = page.locator('.results__count');
    await expect(count).toContainText(/match your search|matches your search/);

    await page.getByRole('group', { name: 'Type of food' }).getByRole('checkbox', { name: 'Groceries' }).check();
    await expect(page).toHaveURL(/food_group=groceries/);
    await expect(page.getByRole('list', { name: 'Places that match' })).toBeVisible();
    // every confirmed card lists groceries among its food tags
    const cards = page.getByRole('list', { name: 'Places that match' }).locator(':scope > li');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(cards.nth(i).locator('.tags')).toContainText('Groceries');
    await expect(cards.first().getByTestId('synthetic-badge')).toBeVisible();

    await cards.first().getByRole('link', { name: 'See details' }).click();
    await expect(page).toHaveURL(/\/resource\/\d+/);
    const directions = page.getByTestId('directions-osm');
    await expect(directions).toBeVisible();
    await expect(directions).toHaveAttribute('href', /^https:\/\/www\.openstreetmap\.org\/directions/);
    await expect(page.getByRole('heading', { name: 'Who can get help' })).toBeVisible();
  });

  test('B: Spanish UI shows schedule and eligibility headings in Spanish', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Español' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lo que hay hoy en los estantes, cerca de usted');
    await page.getByLabel('Su dirección o código postal').fill('22204');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const cards = page.getByRole('list', { name: 'Lugares que coinciden' }).locator(':scope > li');
    await cards.first().getByRole('link', { name: 'Ver detalles' }).click();
    await expect(page.getByRole('heading', { name: 'Horario', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quién puede recibir ayuda' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    // choice persists across reloads
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Horario', exact: true })).toBeVisible();
  });

  test('F: "No ID required" excludes listings whose ID requirement is unknown', async ({ page }) => {
    await page.goto('/find?lat=38.86&lon=-77.099&label=ZIP%2022204&radius_km=40.23');
    await expect(page.locator('.results__count')).toBeVisible();
    await page.getByRole('checkbox', { name: 'No ID required (confirmed)' }).check();
    await expect(page).toHaveURL(/eligibility=no_id_required/);
    const confirmed = page.getByRole('list', { name: 'Places that match' });
    await expect(confirmed).toBeVisible();
    await expect(confirmed.getByRole('link', { name: '[TEST] Birch Hill Church Pantry' })).toHaveCount(0);
    // every confirmed result explains the confirmed match
    const cards = confirmed.locator(':scope > li');
    const n = await cards.count();
    for (let i = 0; i < n; i++) await expect(cards.nth(i)).toContainText('No ID required (confirmed)');
    // Birch Hill may only appear in the clearly-labelled uncertain section
    const uncertain = page.getByTestId('uncertain-section');
    await expect(uncertain.getByRole('heading', { name: 'May match — information not confirmed' })).toBeVisible();
    const birch = uncertain.locator('li', { has: page.getByRole('link', { name: '[TEST] Birch Hill Church Pantry' }) });
    await expect(birch).toContainText('Whether ID is required');
  });
});
