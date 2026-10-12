import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SearchForm } from '../components/SearchForm';
import { mockFetch, renderApp } from '../test/utils';

describe('SearchForm', () => {
  it('geocodes a ZIP and navigates to the explorer with coordinates', async () => {
    const { calls } = mockFetch([
      { path: '/api/geocode', body: { results: [{ label: 'ZIP 22204', lat: 38.860742, lon: -77.098955, source: 'census_zcta', precision: 'zip' }], unavailable_providers: [] } },
    ]);
    renderApp(<SearchForm />);
    await userEvent.type(screen.getByLabelText('Your address or ZIP code'), '22204');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/find\?/));
    const loc = new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1]);
    expect(Number(loc.get('lat'))).toBeCloseTo(38.86074, 4);
    expect(Number(loc.get('lon'))).toBeCloseTo(-77.09896, 4);
    expect(loc.get('label')).toBe('ZIP 22204');
    const geo = calls.find((c) => c.url.pathname === '/api/geocode')!;
    expect(geo.url.searchParams.get('q')).toBe('22204');
  });

  it('on the results page, searching a new place keeps the distance, needs and filters already chosen', async () => {
    mockFetch([
      { path: '/api/geocode', body: { results: [{ label: 'ZIP 20147', lat: 39.04, lon: -77.48, source: 'x', precision: 'zip' }], unavailable_providers: [] } },
    ]);
    renderApp(<SearchForm compact />, {
      route: '/find?lat=38.86&lon=-77.1&label=ZIP%2022204&radius_km=any&service_group=housing,clothing&eligibility=no_id_required&sort=name&page=3',
      path: '/find',
    });
    await userEvent.type(screen.getByLabelText('Your address or ZIP code'), '20147');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('ZIP+20147'));
    const loc = new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1]);
    expect(loc.get('lat')).toBe('39.04'); // the new place replaces the old one…
    expect(loc.get('radius_km')).toBe('any'); // …and everything else chosen stays
    expect(loc.get('service_group')).toBe('housing,clothing');
    expect(loc.get('eligibility')).toBe('no_id_required');
    expect(loc.get('sort')).toBe('name');
    expect(loc.get('page')).toBeNull(); // back to the first page of the new results
  });

  it('applies a signed-in user’s saved preferences to the new search', async () => {
    mockFetch(
      [{ path: '/api/geocode', body: { results: [{ label: 'ZIP 22204', lat: 38.86, lon: -77.1, source: 'x', precision: 'zip' }], unavailable_providers: [] } }],
      { user: { id: 1, email: 'a@example.com', role: 'user', preferred_language: 'en', preferences: { food_groups: ['produce'], eligibility: ['no_id_required'] }, has_password: true, oauth_linked: false } },
    );
    renderApp(<SearchForm />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.type(screen.getByLabelText('Your address or ZIP code'), '22204');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('food_group=produce'));
    expect(screen.getByTestId('location').textContent).toContain('eligibility=no_id_required');
  });

  it('shows a helpful message when nothing matches', async () => {
    mockFetch([{ path: '/api/geocode', body: { results: [], unavailable_providers: [] } }]);
    renderApp(<SearchForm />);
    await userEvent.type(screen.getByLabelText('Your address or ZIP code'), '99999');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/could not find that place/i)).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  it('reports geocoder outages and too-short input', async () => {
    mockFetch([{ path: '/api/geocode', status: 500, body: { detail: 'boom' } }]);
    renderApp(<SearchForm />);
    const input = screen.getByLabelText('Your address or ZIP code');
    await userEvent.type(input, '22');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument();
    await userEvent.type(input, '204');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
  });

  it('lets people choose when several places match', async () => {
    mockFetch([
      {
        path: '/api/geocode',
        body: {
          results: [
            { label: '1 Main St, Arlington', lat: 38.88, lon: -77.1, source: 'x', precision: 'address' },
            { label: '1 Main St, Fairfax', lat: 38.85, lon: -77.3, source: 'x', precision: 'address' },
          ],
          unavailable_providers: [],
        },
      },
    ]);
    renderApp(<SearchForm />);
    await userEvent.type(screen.getByLabelText('Your address or ZIP code'), '1 Main St');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Fairfax/ }));
    expect(screen.getByTestId('location').textContent).toContain('lon=-77.3');
  });
});
